"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, TextInput, VersionChip, cx } from "@/components/ui/primitives";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { BoardCanvas, type ColorBy } from "@/components/board/BoardCanvas";
import { CardEditor } from "@/components/cards/CardInspector";
import { CardMenu } from "@/components/cards/CardMenu";
import { BitPickerDialog } from "@/components/cards/pickers";
import { CombineDialog } from "@/components/cards/CardDialogs";
import { useCard, useCardActions } from "@/components/cards/hooks";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { writeLocal } from "@/lib/storage";
import { toast } from "@/components/ui/toast";
import { displayTitle } from "@/lib/format";
import type { BoardClusterDTO, BoardDTO, BoardItemDTO } from "@/types/dto";

function useBoard(id: string) {
  return useQuery({ queryKey: qk.board(id), queryFn: () => api.get<BoardDTO>(`/boards/${id}`) });
}

/** D2 — Board (desktop canvas) / read-only cluster list on phone. */
export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const phone = useIsPhone();
  const mounted = useMounted();
  const { data: board, isLoading, error, refetch } = useBoard(boardId);
  useEffect(() => writeLocal("lastBoardId", boardId), [boardId]);
  if (!mounted) return null;
  if (error instanceof ApiRequestError && error.status === 404) return <EmptyState title="That board doesn't exist or was deleted." action={<Link href="/boards" className="text-accent-dark">All boards</Link>} />;
  if (error) return <EmptyState title="Couldn't load this board." action={<Button onClick={() => refetch()}>Retry</Button>} />;
  if (isLoading || !board) return <SkeletonRows n={4} />;
  if (phone) return <BoardPhone board={board} />;
  return <BoardDesktop board={board} />;
}

function BoardPhone({ board }: { board: BoardDTO }) {
  const router = useRouter();
  const loose = board.items.filter((i) => !i.cluster_id && !i.card.killed_at);
  return (
    <PhonePage id="D2" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.back()}>‹</button>} title={board.board.name}>
      <div className="bg-accent-tint px-4 py-1.5 text-center text-[12px] text-accent-dark">Arrange this board on a larger screen.</div>
      <div className="flex flex-col gap-3 p-4">
        {board.clusters.map((c) => (
          <details key={c.id} open className="rounded-[10px] border border-dashed border-cluster-outline p-3">
            <summary className="font-serif text-[15px] font-semibold">{c.name ?? <span className="text-ink-2">Unnamed</span>} <span className="meta">{c.member_count} cards</span></summary>
            <ul className="mt-2 divide-y divide-divider">
              {board.items.filter((i) => i.cluster_id === c.id).sort((a, b) => (a.cluster_position ?? 0) - (b.cluster_position ?? 0)).map((i) => (
                <li key={i.id}><Link href={`/cards/${i.card.number}`} className="block py-2 text-[15px]">{displayTitle(i.pinned_title, i.pinned_body)}</Link></li>
              ))}
            </ul>
          </details>
        ))}
        <div><div className="label mb-1">Loose cards</div><ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">{loose.map((i) => <li key={i.id}><Link href={`/cards/${i.card.number}`} className="block px-3 py-2.5 text-[15px]">{displayTitle(i.pinned_title, i.pinned_body)}</Link></li>)}{loose.length === 0 && <li className="px-3 py-2.5 text-[13px] text-ink-2">None.</li>}</ul></div>
      </div>
    </PhonePage>
  );
}

function BoardDesktop({ board }: { board: BoardDTO }) {
  const qc = useQueryClient();
  const router = useRouter();
  const a = useCardActions();
  const id = board.board.id;
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("none");
  const [showKilled, setShowKilled] = useState(false);
  const [listView, setListView] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rename, setRename] = useState<string | null>(null);
  const [trayAll, setTrayAll] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.board(id) }); qc.invalidateQueries({ queryKey: qk.boards }); qc.invalidateQueries({ queryKey: ["cards"] }); qc.invalidateQueries({ queryKey: qk.me }); };

  const patchItem = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: Record<string, unknown> }) => api.patch<{ item: BoardItemDTO; deleted_cluster_id: string | null; created_cluster_id: string | null }>(`/board-items/${itemId}`, body),
    onSuccess: (r, vars) => {
      // A plain nudge only needs the board back; cluster changes touch counts elsewhere too.
      if ("cluster_id" in vars.body || "cluster_with_item_id" in vars.body || r.created_cluster_id || r.deleted_cluster_id) refresh();
      else qc.invalidateQueries({ queryKey: qk.board(id) });
      if (r.created_cluster_id) setSelectedCluster(r.created_cluster_id);
    },
    onError: (e) => { toast(`Couldn't move card. ${e.message}`); refresh(); },
  });
  const addItem = useMutation({ mutationFn: ({ n, x, y }: { n: number; x?: number; y?: number }) => api.post(`/boards/${id}/items`, { card_number: n, x, y }), onSuccess: refresh, onError: (e) => toast(e.message) });
  const patchBoard = useMutation({ mutationFn: (body: { name?: string; archived?: boolean }) => api.patch(`/boards/${id}`, body), onSuccess: refresh, onError: (e) => toast(e.message) });
  const tidy = useMutation({ mutationFn: () => api.post(`/boards/${id}/tidy`), onSuccess: refresh });
  const group = useMutation({ mutationFn: (itemIds: string[]) => api.post<{ cluster: BoardClusterDTO }>(`/boards/${id}/clusters`, { item_ids: itemIds }), onSuccess: (r) => { refresh(); setSelectedCluster(r.cluster.id); } });

  const cluster = board.clusters.find((c) => c.id === selectedCluster) ?? null;
  const item = board.items.find((i) => i.id === selectedItem) ?? null;
  const trayCards = useMemo(() => (trayAll ? board.tray : board.tray.slice(0, 8)), [board.tray, trayAll]);

  const inspector = cluster ? (
    <ClusterInspector board={board} cluster={cluster} selectedItemId={selectedItem} onSelectItem={setSelectedItem} onChanged={refresh} />
  ) : item ? (
    <ItemInspector item={item} boardId={id} onChanged={refresh} onUseLatest={() => patchItem.mutate({ itemId: item.id, body: { use_latest: true } })} onRemove={() => api.delete(`/board-items/${item.id}`).then(() => { refresh(); setSelectedItem(null); toast("Removed from board", { action: { label: "Undo", onClick: () => addItem.mutate({ n: item.card.number, x: item.x, y: item.y }) } }); })} />
  ) : (
    <Inspector><p className="text-[13px] text-ink-2">Drag cards from the tray. Drop one card on another to start a cluster.</p><p className="meta mt-2">Lasso with drag · ⌘G groups selection · arrows nudge a card</p></Inspector>
  );

  return (
    <DesktopPage id="D2" inspector={inspector} inspectorOpen onCloseInspector={() => { setSelectedItem(null); setSelectedCluster(null); }}>
      <div className="flex h-full flex-col">
        <CenterHeader title={<button type="button" className="hover:underline" onClick={() => setRename(board.board.name)}>{board.board.name}</button>} meta={`${board.items.length} cards · ${board.clusters.length} clusters · ${board.items.filter((i) => !i.cluster_id).length} loose`}>
          <Button size="sm" variant={showKilled ? "primary" : "secondary"} onClick={() => setShowKilled((v) => !v)}>Show killed</Button>
          <Menu trigger={<Button size="sm">Color by: {colorBy} ▾</Button>} items={(["none", "form", "subject", "theme", "status"] as ColorBy[]).map((c) => ({ label: c[0].toUpperCase() + c.slice(1), onSelect: () => setColorBy(c) }))} />
          <Button size="sm" onClick={() => tidy.mutate()}>Tidy</Button>
          <Button size="sm" variant={listView ? "primary" : "secondary"} onClick={() => setListView((v) => !v)}>List view</Button>
          <span className="meta w-[44px] text-right">{Math.round(zoom * 100)}%</span>
          <Menu trigger={<Button size="sm" aria-label="More">⋯</Button>} items={[{ label: "Rename", onSelect: () => setRename(board.board.name) }, { label: board.board.archived ? "Unarchive" : "Archive board", onSelect: () => patchBoard.mutate({ archived: !board.board.archived }) }]} />
        </CenterHeader>
        <div className="relative min-h-0 flex-1">
          {board.items.length === 0 && !listView && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><EmptyState title="This board is empty." body={board.tray.length ? "Drag cards up from the inbox tray." : "Capture some notes first, then come back to arrange them."} /></div>
          )}
          {listView ? (
            <BoardListView board={board} onMove={(itemId, clusterId) => patchItem.mutate({ itemId, body: { cluster_id: clusterId } })} onSelect={(i) => { setSelectedItem(i); setSelectedCluster(null); }} />
          ) : (
            <BoardCanvas
              board={board}
              colorBy={colorBy}
              showKilled={showKilled}
              selectedItemId={selectedItem}
              selectedClusterId={selectedCluster}
              onSelectItem={setSelectedItem}
              onSelectCluster={setSelectedCluster}
              onMove={(itemId, x, y, clusterId) => patchItem.mutate({ itemId, body: { x, y, ...(clusterId !== undefined ? { cluster_id: clusterId } : {}) } })}
              onDropOnCard={(itemId, targetId) => patchItem.mutate({ itemId, body: { cluster_with_item_id: targetId } })}
              onDoubleClickCard={(it) => { setSelectedItem(it.id); setSelectedCluster(null); }}
              onDropFromTray={(n, x, y) => addItem.mutate({ n, x, y })}
              onGroupSelected={(ids) => group.mutate(ids)}
              onZoom={setZoom}
            />
          )}
        </div>
        <div className="flex h-[92px] shrink-0 items-center gap-3 border-t border-border bg-surface px-4">
          <div className="w-[90px] shrink-0"><div className="label">From inbox</div><div className="meta">drag onto board</div></div>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-2">
            {trayCards.map((c) => (
              <div key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-card-number", String(c.number)); e.dataTransfer.effectAllowed = "move"; }} onDoubleClick={() => addItem.mutate({ n: c.number })} className="canvas-card w-[150px] shrink-0 cursor-grab rounded-md border border-border bg-card p-2 text-[11px] leading-[1.35]" title="Drag onto the board, or double-click to place">
                <p className="line-clamp-3">{c.display_title}</p>
                <span className="meta">{c.display_number}</span>
              </div>
            ))}
            {board.tray.length === 0 && <span className="text-[12px] text-ink-2">Inbox is empty.</span>}
            {!trayAll && board.tray_total > 8 && <button type="button" className="shrink-0 self-center rounded-full border border-dashed border-dashed px-3 py-1 text-[12px] text-ink-2" onClick={() => setTrayAll(true)}>+ {board.tray_total - 8} more</button>}
          </div>
        </div>
      </div>
      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)} title="Rename board" footer={<><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" disabled={!rename?.trim()} onClick={() => { patchBoard.mutate({ name: rename!.trim() }); setRename(null); }}>Rename</Button></>}>
        <TextInput autoFocus value={rename ?? ""} onChange={(e) => setRename(e.target.value)} maxLength={80} aria-label="Board name" />
      </Dialog>
      {board.board.archived && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-[12px] text-white">Archived board · <button type="button" className="underline" onClick={() => patchBoard.mutate({ archived: false })}>restore</button> · <button type="button" className="underline" onClick={() => api.delete(`/boards/${id}`).then(() => router.push("/boards"))}>delete</button></div>}
    </DesktopPage>
  );
}

function ClusterInspector({ board, cluster, selectedItemId, onSelectItem, onChanged }: { board: BoardDTO; cluster: BoardClusterDTO; selectedItemId: string | null; onSelectItem: (id: string) => void; onChanged: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(cluster.name ?? "");
  const [bitPicker, setBitPicker] = useState(false);
  const [combine, setCombine] = useState(false);
  const [ungroup, setUngroup] = useState(false);
  useEffect(() => setName(cluster.name ?? ""), [cluster.id, cluster.name]);
  const members = board.items.filter((i) => i.cluster_id === cluster.id).sort((a, b) => (a.cluster_position ?? 0) - (b.cluster_position ?? 0));
  const patch = useMutation({ mutationFn: (body: { name?: string | null; use_as_theme?: boolean; order?: string[] }) => api.patch(`/clusters/${cluster.id}`, body), onSuccess: onChanged, onError: (e) => toast(e.message) });
  const startBit = useMutation({ mutationFn: () => api.post<{ bit: { bit: { id: string } } }>(`/clusters/${cluster.id}/bit`, {}), onSuccess: (r) => { onChanged(); router.push(`/bits/${r.bit.bit.id}`); }, onError: (e) => toast(e.message) });
  const addToBit = useMutation({ mutationFn: async (bitId: string) => { for (const m of members) await api.post(`/bits/${bitId}/items`, { kind: "joke", card_number: m.card.number }).catch(() => null); return bitId; }, onSuccess: (bitId) => { onChanged(); toast("Added to bit", { action: { label: "Open", onClick: () => router.push(`/bits/${bitId}`) } }); } });
  const move = (i: number, d: -1 | 1) => {
    const ids = members.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    patch.mutate({ order: ids });
  };
  return (
    <Inspector title="Cluster" meta={`${members.length} cards`}>
      <div>
        <TextInput aria-label="Cluster name" placeholder="Name this cluster" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => (name.trim() || null) !== cluster.name && patch.mutate({ name: name.trim() || null })} className="font-serif text-[16px] font-semibold" maxLength={80} />
        <label className="mt-1.5 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={cluster.use_as_theme} onChange={(e) => patch.mutate({ use_as_theme: e.target.checked })} /> Use as theme</label>
      </div>
      <InspectorSection title="Tags in this cluster">
        <div className="flex flex-wrap gap-1">{cluster.aggregated_subjects.map((s) => <Chip key={s.name}>{s.name} ×{s.count}</Chip>)}{cluster.aggregated_subjects.length === 0 && <span className="text-[12px] text-ink-2">No tags yet.</span>}</div>
      </InspectorSection>
      <InspectorSection title="Suggested order">
        <ol className="divide-y divide-divider rounded-md border border-border bg-card">
          {members.map((m, i) => (
            <li key={m.id} className={cx("flex items-center gap-2 px-2 py-1.5 text-[12px]", selectedItemId === m.id && "bg-accent-wash")}>
              <span className="meta w-4">{i + 1}</span>
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelectItem(m.id)}>{displayTitle(m.pinned_title, m.pinned_body, 40)}</button>
              <VersionChip label={m.pinned_version_label} />
              <button type="button" aria-label="Move up" className="text-ink-2" onClick={() => move(i, -1)}>↑</button>
              <button type="button" aria-label="Move down" className="text-ink-2" onClick={() => move(i, 1)}>↓</button>
            </li>
          ))}
        </ol>
        <p className="meta mt-1">Order here becomes the starting sequence in a bit.</p>
      </InspectorSection>
      <InspectorSection title="Already used in">
        {cluster.used_in.length === 0 ? <p className="text-[12px] text-ink-2">Not used anywhere yet.</p> : <ul className="space-y-1 text-[12px]">{cluster.used_in.map((u) => <li key={`${u.type}-${u.id}`} className="flex justify-between"><Link href={u.type === "bit" ? `/bits/${u.id}` : `/sets/${u.id}`} className="hover:underline"><span className="capitalize">{u.type}</span> · {u.name}</Link><span className="meta">{u.count} of {members.length} cards</span></li>)}</ul>}
      </InspectorSection>
      <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
        <Button variant="primary" onClick={() => startBit.mutate()} disabled={members.length === 0}>Start a bit from this cluster</Button>
        <Button onClick={() => setBitPicker(true)}>Add to bit ▾</Button>
        <Button onClick={() => setCombine(true)} disabled={members.length < 2}>Combine ▾</Button>
        <Button onClick={() => setUngroup(true)}>Ungroup</Button>
      </div>
      <BitPickerDialog open={bitPicker} onOpenChange={setBitPicker} onPick={(bitId) => addToBit.mutate(bitId)} />
      {members[0] && <CombineDialog open={combine} onOpenChange={setCombine} seed={members[0].card} candidates={members.slice(1).map((m) => m.card)} onCombine={(numbers) => api.post<{ card: { display_number: string } }>("/cards/combine", { card_numbers: numbers }).then((r) => { onChanged(); toast(`Combined into ${r.card.display_number}`); })} />}
      <ConfirmDialog open={ungroup} onOpenChange={setUngroup} title="Ungroup this cluster?" body="Cards stay on the board." confirmLabel="Ungroup" danger={false} onConfirm={() => api.delete(`/clusters/${cluster.id}`).then(onChanged)} />
    </Inspector>
  );
}

function ItemInspector({ item, boardId, onChanged, onUseLatest, onRemove }: { item: BoardItemDTO; boardId: string; onChanged: () => void; onUseLatest: () => void; onRemove: () => void }) {
  const card = useCard(item.card.number);
  const differs = item.pinned_version_label !== item.latest_version_label;
  return (
    <Inspector>
      {card.data ? <CardEditor card={card.data} context={{ type: "board", id: boardId }} versionLabel={item.pinned_version_label} compact /> : <SkeletonRows n={2} />}
      <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-[12px]">
        <span>Pinned version: <VersionChip label={item.pinned_version_label} />{differs && <span className="meta ml-1">(latest is {item.latest_version_label})</span>}</span>
        {differs && <Button size="sm" onClick={onUseLatest}>Use latest</Button>}
      </div>
      <div className="flex items-center gap-2 border-t border-divider pt-3">
        <Button onClick={onRemove}>Remove from board</Button>
        <div className="flex-1" />
        {card.data && <CardMenu card={card.data} body={card.data.current_version.body} container={{ type: "board", id: boardId }} />}
      </div>
      <span className="hidden">{String(onChanged)}</span>
    </Inspector>
  );
}

/** Accessible alternative: nested lists with "Move to cluster" menus. */
function BoardListView({ board, onMove, onSelect }: { board: BoardDTO; onMove: (itemId: string, clusterId: string | null) => void; onSelect: (itemId: string) => void }) {
  const groups: { id: string | null; name: string; items: BoardItemDTO[] }[] = [
    ...board.clusters.map((c) => ({ id: c.id, name: c.name ?? "Unnamed", items: board.items.filter((i) => i.cluster_id === c.id).sort((a, b) => (a.cluster_position ?? 0) - (b.cluster_position ?? 0)) })),
    { id: null, name: "Loose cards", items: board.items.filter((i) => !i.cluster_id) },
  ];
  return (
    <div className="h-full overflow-y-auto p-5">
      {groups.map((g) => (
        <section key={g.id ?? "loose"} className="mb-4">
          <h3 className="label mb-1.5">{g.name} · {g.items.length}</h3>
          <ul className="divide-y divide-divider rounded-md border border-border bg-card">
            {g.items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(i.id)}>{displayTitle(i.pinned_title, i.pinned_body)}</button>
                <VersionChip label={i.pinned_version_label} />
                <Menu trigger={<Button size="sm">Move to cluster ▾</Button>} items={[...board.clusters.filter((c) => c.id !== i.cluster_id).map((c) => ({ label: c.name ?? "Unnamed", onSelect: () => onMove(i.id, c.id) })), ...(i.cluster_id ? [{ label: "Loose", onSelect: () => onMove(i.id, null) }] : [])]} />
              </li>
            ))}
            {g.items.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-2">Empty.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
