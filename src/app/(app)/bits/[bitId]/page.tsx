"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, TextArea, TextInput, VersionChip, cx } from "@/components/ui/primitives";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { useCardActions } from "@/components/cards/hooks";
import { CardChips } from "@/components/cards/CardChips";
import { SplitDialog } from "@/components/cards/CardDialogs";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { dateOnly, formatMmSs, shortDate } from "@/lib/format";
import { joinTitle, splitTitle } from "@/domain/title-split";
import { toast } from "@/components/ui/toast";
import { announce } from "@/app/providers";
import type { BitDTO, BitItemDTO, CardSummaryDTO } from "@/types/dto";
import { useShell } from "@/components/shell/AppShell";

function useBit(id: string) {
  return useQuery({ queryKey: qk.bit(id), queryFn: () => api.get<BitDTO>(`/bits/${id}`) });
}

/** D3 — Bit editor. */
export default function BitPage() {
  const { bitId } = useParams<{ bitId: string }>();
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const qc = useQueryClient();
  const a = useCardActions();
  const setPalette = useShell((s) => s.setPalette);
  const { data: bit, isLoading, error } = useBit(bitId);
  const [selected, setSelected] = useState<string | null>(null);
  const [readMode, setReadMode] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<BitItemDTO | null>(null);
  const [split, setSplit] = useState(false);
  const [newBridge, setNewBridge] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.bit(bitId) });
    qc.invalidateQueries({ queryKey: qk.bits });
    qc.invalidateQueries({ queryKey: ["set"] });
    qc.invalidateQueries({ queryKey: ["cards"] });
  };
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put<BitDTO>(`/bits/${bitId}/order`, { item_ids: ids }), onSuccess: (r) => { qc.setQueryData(qk.bit(bitId), r); refresh(); } });
  const addBridge = useMutation({ mutationFn: (text: string) => api.post(`/bits/${bitId}/items`, { kind: "bridge", bridge_text: text }), onSuccess: () => { setNewBridge(""); refresh(); } });
  const addJoke = useMutation({ mutationFn: (n: number) => api.post(`/bits/${bitId}/items`, { kind: "joke", card_number: n }), onSuccess: refresh, onError: (e) => toast(e instanceof ApiRequestError && e.code === "ALREADY_IN_BIT" ? "Already in this bit." : e.message) });
  const patchItem = useMutation({ mutationFn: ({ id, body }: { id: string; body: { bridge_text?: string; use_latest?: true } }) => api.patch(`/bit-items/${id}`, body), onSuccess: refresh });
  const removeItem = useMutation({ mutationFn: (id: string) => api.delete(`/bit-items/${id}`), onSuccess: () => { refresh(); setSelected(null); } });
  const patchBit = useMutation({ mutationFn: (body: { name?: string; duration_override_seconds?: number | null; archived?: boolean }) => api.patch<BitDTO>(`/bits/${bitId}`, body), onSuccess: (r) => { qc.setQueryData(qk.bit(bitId), r); refresh(); } });

  useEffect(() => {
    if (readMode) {
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && setReadMode(false);
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [readMode]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  if (!mounted) return null;
  if (error instanceof ApiRequestError && error.status === 404) return <EmptyState title="That bit doesn't exist or was deleted." action={<Link href="/sets" className="text-accent-dark">Go to Sets</Link>} />;
  if (isLoading || !bit) return <SkeletonRows n={4} />;

  const items = bit.items;
  const selectedItem = items.find((i) => i.id === selected) ?? null;
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    reorder.mutate(next);
    announce(`Block moved to position ${next.indexOf(String(active.id)) + 1} of ${next.length}`);
  };

  const column = (
    <div className={cx("mx-auto w-full max-w-[640px] px-8 py-6", readMode && "max-w-[720px] text-[18px]")}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2.5">
            {items.map((it) => (
              <Block key={it.id} item={it} bitId={bitId} selected={selected === it.id} readMode={readMode} onSelect={() => setSelected(it.id)} onBridgeChange={(text) => patchItem.mutate({ id: it.id, body: { bridge_text: text } })} onJokeChange={async (text) => {
                if (!it.card) return;
                const { card } = await api.get<{ card: { rev: number } }>(`/cards/${it.card.number}`);
                a.edit.mutate({ n: it.card.number, input: { rev: card.rev, context: { type: "bit", id: bitId }, version_label: it.pinned_version?.label, ...splitTitle(text) } }, { onSuccess: refresh, onError: (e) => { toast(e.message); refresh(); } });
              }} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {!readMode && (
        <div className="mt-3 rounded-lg border border-dashed border-dashed p-3">
          <TextArea aria-label="New bridge" placeholder={items.length ? "Drop a card here, or start typing a bridge" : "This bit is empty. Drag jokes in from the tray or search with ⌘K. Or type a bridge here."} value={newBridge} onChange={(e) => setNewBridge(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && newBridge.trim()) { e.preventDefault(); addBridge.mutate(newBridge.trim()); } }} className="min-h-[44px] border-0 bg-transparent italic" />
          <div className="mt-1 flex items-center justify-between">
            <span className="meta">Enter adds the bridge · Shift+Enter for a line break</span>
            <Button size="sm" onClick={() => setPalette(true)}>Add a card ⌘K</Button>
          </div>
        </div>
      )}
    </div>
  );

  const inspector = (
    <Inspector>
      {bit.unplaced_from_cluster.length > 0 && (
        <InspectorSection title={`Unplaced from cluster (${bit.unplaced_from_cluster.length})`}>
          <div className="flex flex-col gap-1.5">
            {bit.unplaced_from_cluster.map((c) => (
              <button key={c.id} type="button" className="rounded-md border border-border bg-card px-2.5 py-2 text-left text-[12px] hover:border-accent" onClick={() => addJoke.mutate(c.number)}>
                <span className="meta mr-1">{c.display_number}</span>{c.display_title}
              </button>
            ))}
          </div>
          <p className="meta mt-1">Tap to add to the column. Other cards: search or ⌘K.</p>
        </InspectorSection>
      )}
      {selectedItem?.kind === "joke" && selectedItem.card && selectedItem.pinned_version ? (
        <>
          <div className="flex items-center justify-between"><span className="label">Selected block</span><span className="meta"><VersionChip label={selectedItem.pinned_version.label} /> of {selectedItem.card.display_number}</span></div>
          <div className="rounded-md border border-accent bg-accent-wash p-3 text-[12px] text-ink-body">
            Editing this text creates a new version and keeps the chain. The board still shows its own pinned version until you push the change back.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={!bit.items.length} onClick={() => a.pin.mutate({ n: selectedItem.card!.number, label: selectedItem.pinned_version!.label })}>Push {selectedItem.pinned_version.label} to board</Button>
              <Button size="sm" onClick={() => a.detach.mutate({ n: selectedItem.card!.number, version_label: selectedItem.pinned_version!.label, container: { type: "bit", id: bitId } })}>Detach a copy</Button>
              {selectedItem.latest_version_label && selectedItem.latest_version_label !== selectedItem.pinned_version.label && <Button size="sm" onClick={() => patchItem.mutate({ id: selectedItem.id, body: { use_latest: true } })}>Use latest ({selectedItem.latest_version_label})</Button>}
            </div>
          </div>
          <InspectorSection title="Chain">
            <VersionChain number={selectedItem.card.number} current={selectedItem.pinned_version.label} />
          </InspectorSection>
          <InspectorSection title="Performed">
            {bit.performed.length === 0 ? <p className="text-[12px] text-ink-2">Not performed yet.</p> : (
              <ul className="space-y-1 text-[12px]">{bit.performed.map((p, i) => <li key={i} className="flex justify-between"><span>{dateOnly(p.performed_on)} · {p.venue_label ?? p.set_name} · v{p.anchor_number}</span><Chip variant={p.result === "landed" ? "success" : p.result === "cut" ? "danger" : "status"}>{p.result}</Chip></li>)}</ul>
            )}
          </InspectorSection>
          <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
            <Button onClick={() => setRemoveConfirm(selectedItem)}>Remove from bit</Button>
            <Button onClick={() => setSplit(true)}>Split into two cards</Button>
          </div>
        </>
      ) : selectedItem?.kind === "bridge" ? (
        <>
          <div className="label">Selected bridge</div>
          <p className="text-[12px] text-ink-2">Bridges are prose between jokes. Click the text to edit it.</p>
          <Button onClick={() => setRemoveConfirm(selectedItem)}>Remove bridge</Button>
        </>
      ) : (
        <>
          <div className="label">Bit</div>
          <p className="text-[12px] text-ink-2">Select a block to see its version chain and where it has been performed.</p>
          <InspectorSection title="Used in sets">
            {bit.used_in_sets.length === 0 ? <p className="text-[12px] text-ink-2">Not in a set yet.</p> : <ul className="space-y-1 text-[12px]">{bit.used_in_sets.map((s) => <li key={s.id}><Link href={`/sets/${s.id}`} className="hover:underline">{s.name}</Link> <span className="meta">{s.in_working ? "working copy" : ""}{s.anchors.length ? ` · anchors ${s.anchors.map((n) => `v${n}`).join(", ")}` : ""}</span></li>)}</ul>}
          </InspectorSection>
          <InspectorSection title="Duration">
            <DurationOverride value={bit.bit.duration_override_seconds} onChange={(v) => patchBit.mutate({ duration_override_seconds: v })} />
          </InspectorSection>
        </>
      )}
    </Inspector>
  );

  const header = (
    <CenterHeader title={<button type="button" onClick={() => setRename(bit.bit.name)} className="hover:underline">{bit.bit.name}</button>} meta={`~${formatMmSs(bit.duration_seconds)} read aloud · ${items.filter((i) => i.kind === "joke").length} jokes · ${items.filter((i) => i.kind === "bridge").length} bridges`}>
      <Button size="sm" onClick={() => setReadMode((v) => !v)}>{readMode ? "Exit read mode" : "Read mode"}</Button>
      <Menu trigger={<Button size="sm">Export ▾</Button>} items={[{ label: "Copy as text", onSelect: () => navigator.clipboard.writeText(bitText(bit)).then(() => toast("Copied")) }, { label: "Download .md", onSelect: () => download(`${bit.bit.name}.md`, `# ${bit.bit.name}\n\n${bitText(bit)}`) }]} />
      <Menu trigger={<Button size="sm" aria-label="More">⋯</Button>} items={[{ label: "Rename", onSelect: () => setRename(bit.bit.name) }, { label: bit.bit.archived ? "Unarchive" : "Archive", onSelect: () => patchBit.mutate({ archived: !bit.bit.archived }) }]} />
    </CenterHeader>
  );

  const dialogs = (
    <>
      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)} title="Rename bit" footer={<><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" disabled={!rename?.trim()} onClick={() => { patchBit.mutate({ name: rename!.trim() }); setRename(null); }}>Rename</Button></>}>
        <TextInput autoFocus value={rename ?? ""} onChange={(e) => setRename(e.target.value)} maxLength={80} aria-label="Bit name" />
      </Dialog>
      <ConfirmDialog open={!!removeConfirm} onOpenChange={(o) => !o && setRemoveConfirm(null)} title={removeConfirm?.kind === "joke" ? "Remove this joke from the bit?" : "Remove this bridge?"} body="The card itself stays in your library." confirmLabel="Remove" danger={false} onConfirm={async () => { if (removeConfirm) await removeItem.mutateAsync(removeConfirm.id); }} />
      {selectedItem?.kind === "joke" && selectedItem.card && (
        <SplitDialog open={split} onOpenChange={setSplit} body={selectedItem.pinned_version?.body ?? selectedItem.card.body} onSplit={(at) => a.split.mutateAsync({ n: selectedItem.card!.number, split_at: at, version_label: selectedItem.pinned_version?.label, container: { type: "bit", id: bitId } }).then(() => refresh())} />
      )}
    </>
  );

  if (phone) {
    return (
      <PhonePage id="D3" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.back()}>‹</button>} title={bit.bit.name} right={<Button size="sm" onClick={() => setReadMode((v) => !v)}>{readMode ? "Edit" : "Read"}</Button>}>
        <div className="px-0">{column}</div>
        {selectedItem && !readMode && <div className="border-t border-border bg-surface">{inspector}</div>}
        {dialogs}
      </PhonePage>
    );
  }
  if (readMode) {
    return (
      <DesktopPage id="D3" noRail>
        <div className="h-full overflow-y-auto">
          <div className="sticky top-0 flex justify-end bg-bg/90 p-3"><Button size="sm" onClick={() => setReadMode(false)}>Exit read mode (Esc)</Button></div>
          {column}
        </div>
      </DesktopPage>
    );
  }
  return (
    <DesktopPage id="D3" inspector={inspector} inspectorOpen onCloseInspector={() => setSelected(null)}>
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>{column}</div>
      </div>
      {dialogs}
    </DesktopPage>
  );
}

function Block({ item, bitId, selected, readMode, onSelect, onBridgeChange, onJokeChange }: { item: BitItemDTO; bitId: string; selected: boolean; readMode: boolean; onSelect: () => void; onBridgeChange: (t: string) => void; onJokeChange: (t: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: readMode });
  const [editing, setEditing] = useState(false);
  const initial = item.kind === "bridge" ? (item.bridge_text ?? "") : joinTitle(item.pinned_version?.title ?? null, item.pinned_version?.body ?? "");
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const commit = () => {
    setEditing(false);
    if (text.trim() && text !== initial) (item.kind === "bridge" ? onBridgeChange : onJokeChange)(text.trim());
    else setText(initial);
  };
  void bitId;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx("group flex gap-3", isDragging && "opacity-70")}>
      {!readMode && (
        <div className="flex w-[52px] shrink-0 flex-col items-end gap-1 pt-2">
          <span className="meta">{item.kind === "joke" ? "card" : "bridge"}</span>
          {item.kind === "joke" && item.pinned_version && <VersionChip label={item.pinned_version.label} />}
          <button type="button" {...attributes} {...listeners} aria-label="Reorder block" className="cursor-grab text-ink-2 opacity-0 group-hover:opacity-100 touch-none focus:opacity-100"><GripVertical size={14} aria-hidden /></button>
        </div>
      )}
      <div className="min-w-0 flex-1">
        {item.kind === "joke" ? (
          <div onClick={onSelect} className={cx("rounded-lg border bg-card px-3.5 py-3", selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-border", readMode && "border-0 bg-transparent px-0")}>
            {editing && !readMode ? (
              <TextArea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Escape") { setText(initial); setEditing(false); } }} className="min-h-[60px] text-[15px] leading-[1.5]" />
            ) : (
              <p onClick={() => !readMode && setEditing(true)} className="whitespace-pre-wrap text-[15px] leading-[1.5]">
                {item.pinned_version?.title && <strong className="block">{item.pinned_version.title}</strong>}
                {item.pinned_version?.body}
              </p>
            )}
            {!readMode && item.card && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CardChips card={item.card} max={4} />
                <span className="meta">{item.card.display_number}{item.edited_here_count ? ` · edited here ${item.edited_here_count}×` : ""}{item.card.killed_at ? " · killed" : ""}</span>
              </div>
            )}
          </div>
        ) : editing && !readMode ? (
          <TextArea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Escape") { setText(initial); setEditing(false); } }} className="min-h-[40px] italic" />
        ) : (
          <p onClick={() => { onSelect(); if (!readMode) setEditing(true); }} className={cx("whitespace-pre-wrap border-l-2 py-1 pl-3 text-[15px] italic leading-[1.5] text-ink-body", selected ? "border-accent" : "border-divider")}>{item.bridge_text}</p>
        )}
      </div>
    </li>
  );
}

function VersionChain({ number, current }: { number: number; current: string }) {
  const { data } = useQuery({ queryKey: qk.lineage(number), queryFn: () => api.get<{ versions: { label: string; created_context_label: string | null; created_context: string; created_at: string }[] }>(`/cards/${number}/lineage`) });
  return (
    <div>
      <ul className="space-y-1 border-l-2 border-wire-soft pl-3 text-[12px]">
        {(data?.versions ?? []).map((v) => (
          <li key={v.label} className={cx("flex items-center justify-between", v.label === current && "font-semibold")}><span><VersionChip label={v.label} /> {v.created_context_label ?? v.created_context}</span><span className="meta">{shortDate(v.created_at)}</span></li>
        ))}
      </ul>
      <Link href={`/cards/${number}/lineage`} className="mt-1 block text-[12px] font-semibold text-accent-dark hover:underline">Open full lineage →</Link>
    </div>
  );
}

function DurationOverride({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value ? formatMmSs(value) : "");
  useEffect(() => setText(value ? formatMmSs(value) : ""), [value]);
  return (
    <div className="flex items-center gap-2">
      <TextInput placeholder="auto" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { const s = text.trim() ? (text.includes(":") ? text.split(":").reduce((m, p) => m * 60 + Number(p), 0) : Number(text)) : null; onChange(s && s > 0 ? Math.round(s) : null); }} className="w-[90px]" aria-label="Duration override (m:ss)" />
      <span className="meta">override · blank = words ÷ reading speed</span>
    </div>
  );
}

function bitText(bit: BitDTO) {
  return bit.items.map((i) => (i.kind === "bridge" ? `*${i.bridge_text}*` : joinTitle(i.pinned_version?.title ?? null, i.pinned_version?.body ?? ""))).join("\n\n");
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name;
  a.click();
}
