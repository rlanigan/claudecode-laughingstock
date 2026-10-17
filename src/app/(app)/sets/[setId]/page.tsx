"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { RailItem, RailSection } from "@/components/shell/LeftRail";
import { Button, Chip, EmptyState, SegmentedControl, SkeletonRows, TextArea, TextInput, cx } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { formatMmSs, parseMmSs, shortDate } from "@/lib/format";
import { readLocal, writeLocal } from "@/lib/storage";
import { toast } from "@/components/ui/toast";
import { AnchorDialog, BitRow, LogPerformanceDialog, MarkPanel, NotesList, RuntimeLine, ScriptView, TransitionSlot, downloadText, padNum, revisionMarkdown, transitionFor, useWorkingCopyResolution } from "@/components/sets/SetParts";
import type { BitSummaryDTO, RevisionDTO, RevisionItemDTO, SetDTO, SetStatus } from "@/types/dto";

function useSet(id: string) {
  return useQuery({ queryKey: qk.set(id), queryFn: () => api.get<SetDTO>(`/sets/${id}`) });
}

const STATUS: { value: SetStatus; label: string }[] = [{ value: "idea", label: "Idea" }, { value: "wip", label: "In progress" }, { value: "workshopping", label: "Workshopping" }, { value: "ready", label: "Ready" }, { value: "retired", label: "Retired" }];

/** D6 (desktop) / P6 (phone) — one set. */
export default function SetPage() {
  const { setId } = useParams<{ setId: string }>();
  const phone = useIsPhone();
  const mounted = useMounted();
  const { data, error } = useSet(setId);
  useEffect(() => { if (data) writeLocal("lastSetId", data.set.id); }, [data]);
  if (!mounted) return null;
  if (error instanceof ApiRequestError && error.status === 404) return <EmptyState title="That set isn't here." action={<Link href="/sets" className="text-accent-dark">All sets</Link>} />;
  if (!data) return <SkeletonRows n={4} />;
  return phone ? <SetPhone data={data} /> : <SetDesktop data={data} />;
}

function useSetMutations(data: SetDTO) {
  const qc = useQueryClient();
  const id = data.set.id;
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.set(id) }); qc.invalidateQueries({ queryKey: qk.sets }); qc.invalidateQueries({ queryKey: ["bit"] }); qc.invalidateQueries({ queryKey: ["cards"] }); };
  const onConflict = (e: Error) => { if (e instanceof ApiRequestError && e.code === "CONFLICT") { toast("This set changed elsewhere. Reloaded."); refresh(); } else toast(e.message); };
  const order = useMutation({ mutationFn: (bitIds: string[]) => api.put<{ working: RevisionDTO }>(`/sets/${id}/working`, { rev: data.working.rev, bit_ids: bitIds }), onSuccess: (r) => { qc.setQueryData<SetDTO>(qk.set(id), (old) => (old ? { ...old, working: r.working } : old)); refresh(); }, onError: onConflict });
  const patch = useMutation({ mutationFn: (body: { name?: string; status?: SetStatus; target_duration_seconds?: number | null; archived?: boolean }) => api.patch(`/sets/${id}`, body), onSuccess: refresh, onError: (e) => toast(e.message) });
  const transition = useMutation({ mutationFn: (body: { from_bit_id: string; to_bit_id: string; kind: "written" | "hard_cut"; text?: string; callback_to_card_number?: number | null }) => api.put(`/sets/${id}/transitions`, body), onSuccess: refresh, onError: (e) => toast(e.message) });
  const clearTransition = useMutation({ mutationFn: ({ from, to }: { from: string; to: string }) => api.delete(`/sets/${id}/transitions?from_bit_id=${from}&to_bit_id=${to}`), onSuccess: refresh });
  const fork = useMutation({ mutationFn: (body: { base_revision_id: string; mode: "insert_all_positions" | "duplicate"; bit_id?: string }) => api.post<{ fork_group_id: string }>(`/sets/${id}/forks`, body), onSuccess: refresh, onError: (e) => toast(e.message) });
  return { refresh, order, patch, transition, clearTransition, fork };
}

type Sel = { kind: "bit"; bitId: string } | { kind: "transition"; from: string; to: string } | null;

function SetDesktop({ data }: { data: SetDTO }) {
  const router = useRouter();
  const m = useSetMutations(data);
  const { set, working } = data;
  const [view, setView] = useState<"flow" | "script">("flow");
  const [sel, setSel] = useState<Sel>(null);
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [insertFor, setInsertFor] = useState<BitSummaryDTO | null>(null);
  const [removeBit, setRemoveBit] = useState<RevisionItemDTO | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  useEffect(() => setView(readLocal(`setView:${set.id}`, "flow")), [set.id]);
  const items = working.items;
  const bitIds = useMemo(() => items.map((i) => i.bit_id), [items]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = bitIds.indexOf(String(active.id));
    const to = bitIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    m.order.mutate(arrayMove(bitIds, from, to));
  };
  const nextAnchor = (data.anchors.length ? Math.max(...data.anchors.map((a) => Number(a.label.slice(1)))) : 0) + 1;
  const currentAnchor = data.anchors.find((a) => a.is_current) ?? null;
  const hasAnchor = set.current_anchor_id !== null;
  const forkFrom = (mode: "duplicate" | "insert_all_positions", bitId?: string) => {
    if (!set.current_anchor_id) { toast("Anchor the set first — forks start from an anchor."); setAnchorOpen(true); return; }
    m.fork.mutate({ base_revision_id: set.current_anchor_id, mode, bit_id: bitId }, { onSuccess: (r) => router.push(`/sets/${set.id}/compare/${r.fork_group_id}`) });
  };

  const rail = (
    <>
      <RailSection title="Set">
        <div className="rounded-md border border-border bg-card p-2.5">
          <SetName name={set.name} onSave={(name) => m.patch.mutate({ name })} />
          <select className="field mt-1.5 text-[12px]" value={set.status} onChange={(e) => m.patch.mutate({ status: e.target.value as SetStatus })} aria-label="Status">{STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <TargetField value={set.target_duration_seconds} onSave={(v) => m.patch.mutate({ target_duration_seconds: v })} />
          <div className="meta mt-1.5">{currentAnchor ? `Current anchor ${currentAnchor.label}${currentAnchor.name ? ` · ${currentAnchor.name}` : ""}` : "Not anchored yet"}</div>
        </div>
      </RailSection>
      <RailSection title="Bench" action={<Link href="/sets?newBit=1" className="text-[10px] normal-case tracking-normal text-accent-dark hover:underline">+ New bit</Link>}>
        {data.bench.length === 0 && <p className="meta px-2">Every bit is in this set.</p>}
        {data.bench.map((b) => (
          <div key={b.id} className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-card">
            <Link href={`/bits/${b.id}`} className="min-w-0 flex-1 truncate text-[12px]" title={b.name}>{b.name}<span className="meta ml-1">{formatMmSs(b.duration_seconds)}</span></Link>
            <button type="button" className="text-[11px] font-semibold text-accent-dark opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => m.order.mutate([...bitIds, b.id])} title="Add to the end">+ Add</button>
            <button type="button" className="text-[11px] text-ink-2 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setInsertFor(b)} title="Try it in every position">Try all</button>
          </div>
        ))}
      </RailSection>
      <RailSection title="Anchors">
        {data.anchors.length === 0 && <p className="meta px-2">Anchor the set to freeze a version.</p>}
        {[...data.anchors].reverse().map((a) => <RailItem key={a.revision_id} href={`/sets/${set.id}/revisions/${a.revision_id}`} active={false} count={a.performance_summary ?? `${a.bit_count} bits`}><span className={cx(a.is_current && "font-semibold")}>{a.label}{a.name ? ` · ${a.name}` : ""}</span></RailItem>)}
      </RailSection>
      {data.variants.length > 0 && (
        <RailSection title="Variants">
          {Object.entries(groupBy(data.variants, (v) => v.fork_group_id ?? "")).map(([gid, vs]) => <RailItem key={gid} href={`/sets/${set.id}/compare/${gid}`} count={`${vs.length}`}>{vs.some((v) => v.variant_state === "open") ? "Open comparison" : "Past comparison"} · {shortDate(vs[0].created_at)}</RailItem>)}
        </RailSection>
      )}
    </>
  );

  const selectedItem = sel?.kind === "bit" ? items.find((i) => i.bit_id === sel.bitId) ?? null : null;
  const selectedTransition = sel?.kind === "transition" ? sel : null;
  const inspector = selectedTransition ? (
    <TransitionInspector data={data} from={selectedTransition.from} to={selectedTransition.to} onSave={(body) => m.transition.mutate({ from_bit_id: selectedTransition.from, to_bit_id: selectedTransition.to, ...body })} onClear={() => m.clearTransition.mutate({ from: selectedTransition.from, to: selectedTransition.to })} />
  ) : selectedItem ? (
    <Inspector title="Bit" meta={`${selectedItem.position + 1} of ${items.length}`}>
      <p className="font-serif text-[16px] font-semibold">{selectedItem.bit_name}</p>
      <p className="meta">{selectedItem.joke_count} jokes · {formatMmSs(selectedItem.duration_seconds)}{selectedItem.primary_subject ? ` · mostly ${selectedItem.primary_subject}` : ""}</p>
      {selectedItem.marked_cut_on && <p className="text-[12px] text-ink-2">Marked cut on {selectedItem.marked_cut_on}.</p>}
      <SharedWith rev={working} bitId={selectedItem.bit_id} />
      <div className="flex flex-wrap gap-2">
        <Link href={`/bits/${selectedItem.bit_id}`} className="inline-flex min-h-[30px] items-center rounded-md border border-border bg-card px-2.5 text-[12px] font-semibold hover:border-accent">Open bit</Link>
        <Button size="sm" onClick={() => setRemoveBit(selectedItem)}>Remove from set</Button>
      </div>
      <InspectorSection title="Move">
        <div className="flex gap-1">
          <Button size="sm" disabled={selectedItem.position === 0} onClick={() => m.order.mutate(arrayMove(bitIds, selectedItem.position, selectedItem.position - 1))}>↑ Earlier</Button>
          <Button size="sm" disabled={selectedItem.position === items.length - 1} onClick={() => m.order.mutate(arrayMove(bitIds, selectedItem.position, selectedItem.position + 1))}>↓ Later</Button>
        </div>
      </InspectorSection>
    </Inspector>
  ) : (
    <Inspector title="Set shape" meta={<RuntimeLine runtime={working.runtime_seconds} target={set.target_duration_seconds} />}>
      <NotesList notes={working.notes} empty="Add a couple of bits and the notes show up here." />
      {working.callbacks.length > 0 && <InspectorSection title="Callbacks"><ul className="space-y-1 text-[12px]">{working.callbacks.map((c) => <li key={`${c.card_number}-${c.label}`} className={cx(!c.valid && "text-danger-text")}>{c.label} → {padNum(c.card_number)}{!c.valid && " · that joke isn't earlier in the set"}</li>)}</ul></InspectorSection>}
      {data.active_performance && <InspectorSection title="Marking tonight's set"><MarkPanel performance={data.active_performance} setId={set.id} /></InspectorSection>}
      <InspectorSection title="Working copy">
        <p className="meta">{data.changed_since_anchor ? `Changed since ${currentAnchor?.label ?? "the last anchor"}.` : hasAnchor ? `Matches ${currentAnchor?.label}.` : "Nothing anchored yet."}</p>
        <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => downloadText(`${set.name}.md`, revisionMarkdown(set.name, working))}>Export .md</Button><Button size="sm" onClick={() => setArchiveOpen(true)}>Archive set</Button></div>
      </InspectorSection>
    </Inspector>
  );

  return (
    <DesktopPage id="D6" rail={rail} hideStandardRail inspector={inspector} inspectorOpen onCloseInspector={sel ? () => setSel(null) : undefined}>
      <div className="flex h-full flex-col">
        <CenterHeader title={set.name} chip={currentAnchor ? <Chip variant={data.changed_since_anchor ? "dashed" : "version"}>{data.changed_since_anchor ? `${currentAnchor.label} + changes` : currentAnchor.label}</Chip> : <Chip variant="dashed">unanchored</Chip>} meta={<span><RuntimeLine runtime={working.runtime_seconds} target={set.target_duration_seconds} /> · {items.length} bits{working.transitions_to_write > 0 ? ` · ${working.transitions_to_write} transition${working.transitions_to_write === 1 ? "" : "s"} to write` : ""}</span>}>
          <SegmentedControl size="sm" ariaLabel="View" value={view} options={[{ value: "flow", label: "Flow" }, { value: "script", label: "Script" }]} onChange={(v) => { setView(v); writeLocal(`setView:${set.id}`, v); }} />
          <Button size="sm" variant="primary" disabled={!items.length} onClick={() => setAnchorOpen(true)}>Anchor this</Button>
          <Menu ariaLabel="Fork" screenId="M23" trigger={<Button size="sm">Fork ▾</Button>} items={[
            { label: "Duplicate the current anchor to compare", hint: hasAnchor ? currentAnchor?.label : "needs an anchor", onSelect: () => forkFrom("duplicate") },
            { label: "Try a bench bit in every position…", hint: data.bench.length ? `${data.bench.length} on the bench` : "bench is empty", disabled: !data.bench.length, onSelect: () => setInsertFor(data.bench[0]) },
          ]} />
          <Button size="sm" disabled={!items.length} onClick={() => setLogOpen(true)}>Log performance</Button>
        </CenterHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {items.length === 0 ? (
            <EmptyState title="An empty set." body="Add bits from the bench on the left. Drag to reorder; click the gap between two bits to write the transition." action={data.bench.length ? <Button variant="primary" onClick={() => m.order.mutate([data.bench[0].id])}>Add “{data.bench[0].name}”</Button> : <Link href="/sets?newBit=1" className="text-accent-dark">Make a bit first</Link>} />
          ) : view === "script" ? (
            <ScriptView script={working.script ?? []} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={bitIds} strategy={verticalListSortingStrategy}>
                <ol className="mx-auto flex max-w-[560px] flex-col gap-1.5">
                  {items.map((it, i) => (
                    <li key={it.bit_id} className="flex flex-col gap-1.5">
                      <SortableBit item={it} selected={sel?.kind === "bit" && sel.bitId === it.bit_id} onClick={() => setSel({ kind: "bit", bitId: it.bit_id })} />
                      {i < items.length - 1 && <TransitionSlot t={transitionFor(working, it.bit_id, items[i + 1].bit_id)} selected={sel?.kind === "transition" && sel.from === it.bit_id} onClick={() => setSel({ kind: "transition", from: it.bit_id, to: items[i + 1].bit_id })} />}
                    </li>
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
      <AnchorDialog open={anchorOpen} onOpenChange={setAnchorOpen} setId={set.id} nextNumber={nextAnchor} />
      <LogPerformanceDialog open={logOpen} onOpenChange={setLogOpen} setId={set.id} anchors={data.anchors.map((a) => ({ revision_id: a.revision_id, label: a.label, name: a.name }))} changedSinceAnchor={data.changed_since_anchor || !hasAnchor} currentAnchorNumber={set.current_anchor_number} />
      <InsertPositionsDialog data={data} bit={insertFor} onClose={() => setInsertFor(null)} onPick={(b) => setInsertFor(b)} onGo={(bit) => { setInsertFor(null); forkFrom("insert_all_positions", bit.id); }} />
      <ConfirmDialog open={!!removeBit} onOpenChange={(o) => !o && setRemoveBit(null)} title={`Remove “${removeBit?.bit_name}” from the working copy?`} body="The bit goes back to the bench. Anchors that include it don't change." confirmLabel="Remove" onConfirm={() => { if (removeBit) m.order.mutate(bitIds.filter((b) => b !== removeBit.bit_id)); setSel(null); setRemoveBit(null); }} />
      <ConfirmDialog open={archiveOpen} onOpenChange={setArchiveOpen} title={`Archive “${set.name}”?`} body="It disappears from the sets list. Anchors and performances are kept." confirmLabel="Archive" onConfirm={() => m.patch.mutate({ archived: true }, { onSuccess: () => router.push("/sets") })} />
    </DesktopPage>
  );
}

function SortableBit({ item, selected, onClick }: { item: RevisionItemDTO; selected: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.bit_id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx("flex items-center gap-1", isDragging && "opacity-60")}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${item.bit_name}`} className="cursor-grab touch-none rounded p-1 text-ink-2 hover:bg-card"><GripVertical size={14} /></button>
      <div className="flex-1"><BitRow item={item} selected={selected} onClick={onClick} highlight={item.is_new_in_revision} /></div>
    </div>
  );
}

function SharedWith({ rev, bitId }: { rev: RevisionDTO; bitId: string }) {
  const rows = rev.shared.filter((s) => s.from_bit_id === bitId || s.to_bit_id === bitId);
  if (!rows.length) return null;
  const name = (id: string) => rev.items.find((i) => i.bit_id === id)?.bit_name ?? "?";
  return <InspectorSection title="Shares with neighbours"><ul className="space-y-1 text-[12px]">{rows.map((s) => <li key={`${s.from_bit_id}-${s.to_bit_id}`}>{name(s.from_bit_id === bitId ? s.to_bit_id : s.from_bit_id)}: {[...s.subjects, ...s.themes].join(", ")}</li>)}</ul></InspectorSection>;
}

function TransitionInspector({ data, from, to, onSave, onClear }: { data: SetDTO; from: string; to: string; onSave: (b: { kind: "written" | "hard_cut"; text?: string; callback_to_card_number?: number | null }) => void; onClear: () => void }) {
  const rev = data.working;
  const t = transitionFor(rev, from, to);
  const a = rev.items.find((i) => i.bit_id === from);
  const b = rev.items.find((i) => i.bit_id === to);
  const [text, setText] = useState(t?.text ?? "");
  const [callback, setCallback] = useState(t?.callback_to_card_number ? String(t.callback_to_card_number) : "");
  useEffect(() => { setText(t?.text ?? ""); setCallback(t?.callback_to_card_number ? String(t.callback_to_card_number) : ""); }, [from, to, t?.text, t?.callback_to_card_number]);
  const shared = rev.shared.find((s) => s.from_bit_id === from && s.to_bit_id === to);
  const reuse = data.reuse_candidates.filter((r) => r.from_bit_id === from && r.to_bit_id === to);
  const save = () => { if (!text.trim()) return; onSave({ kind: "written", text: text.trim(), callback_to_card_number: callback ? Number(callback) : null }); };
  return (
    <Inspector title="Transition" meta={t?.state === "written" ? "written" : t?.state === "hard_cut" ? "hard cut" : "to write"}>
      <p className="text-[12px]"><strong>{a?.bit_name}</strong> → <strong>{b?.bit_name}</strong></p>
      <TextArea aria-label="Transition text" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== (t?.text ?? "") && save()} placeholder="What do you say to get from one to the other?" className="min-h-[90px] text-[13px]" maxLength={1000} />
      <div className="flex items-center gap-2 text-[12px]">
        <label className="flex items-center gap-1">Callback to <TextInput value={callback} onChange={(e) => setCallback(e.target.value.replace(/\D/g, ""))} onBlur={() => t?.state === "written" && save()} placeholder="#" inputMode="numeric" className="w-[72px] !py-1 text-[12px]" aria-label="Callback card number" /></label>
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={save}>Save</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={t?.state === "hard_cut" ? "primary" : "secondary"} onClick={() => onSave({ kind: "hard_cut" })}>Hard cut</Button>
        {t && <Button size="sm" onClick={onClear}>Clear</Button>}
      </div>
      <InspectorSection title="Prompts">
        <ul className="space-y-1 text-[12px] text-ink-body">
          {shared ? <li>They share <strong>{[...shared.subjects, ...shared.themes].join(", ")}</strong>. Name it on the way out.</li> : <li>No shared subject. A hard cut is honest; a callback can stitch them.</li>}
          {a?.primary_subject && b?.primary_subject && a.primary_subject !== b.primary_subject && <li>“Speaking of {b.primary_subject}…” after {a.primary_subject}.</li>}
          <li>What does the audience know now that they didn&apos;t before the last bit?</li>
        </ul>
      </InspectorSection>
      {reuse.length > 0 && <InspectorSection title="Reuse from an earlier anchor"><ul className="space-y-1">{reuse.map((r) => <li key={r.anchor_label + r.text}><button type="button" className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-left text-[12px] hover:border-accent" onClick={() => { setText(r.text); onSave({ kind: "written", text: r.text }); }}><span className="meta mr-1">{r.anchor_label}</span>{r.text}</button></li>)}</ul></InspectorSection>}
    </Inspector>
  );
}

/** M14 — pick a bench bit and preview the positions a fork would try. */
function InsertPositionsDialog({ data, bit, onClose, onPick, onGo }: { data: SetDTO; bit: BitSummaryDTO | null; onClose: () => void; onPick: (b: BitSummaryDTO) => void; onGo: (b: BitSummaryDTO) => void }) {
  const { data: pos } = useQuery({ queryKey: ["insert-positions", data.set.id, bit?.id], queryFn: () => api.get<{ bit: { id: string; name: string }; positions: { index: number; description: string }[] }>(`/sets/${data.set.id}/insert-positions?bit_id=${bit!.id}`), enabled: !!bit });
  const hasAnchor = data.set.current_anchor_id !== null;
  return (
    <Dialog open={!!bit} onOpenChange={(o) => !o && onClose()} title="Try a bit in every position" screenId="M14" description={hasAnchor ? `Forks ${data.set.current_anchor_name ? `v${data.set.current_anchor_number} · ${data.set.current_anchor_name}` : `v${data.set.current_anchor_number}`} into one variant per position, then you compare and pick.` : "Forks start from an anchor. Anchor the working copy first, then try this."} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!bit || !hasAnchor || !!(data.changed_since_anchor)} onClick={() => bit && onGo(bit)}>Make {pos?.positions.length ?? ""} variants</Button></>}>
      <div className="flex flex-col gap-3">
        <select className="field text-[13px]" value={bit?.id ?? ""} onChange={(e) => { const b = data.bench.find((x) => x.id === e.target.value); if (b) onPick(b); }} aria-label="Bit">{data.bench.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        {data.changed_since_anchor && hasAnchor && <p className="text-[12px] text-amber-900">Your working copy has changes since v{data.set.current_anchor_number}. Anchor it first so the fork starts from what you have.</p>}
        {pos && <ol className="max-h-[260px] space-y-1 overflow-y-auto text-[12px]">{pos.positions.map((p) => <li key={p.index} className="rounded-md border border-border bg-card px-2 py-1">{p.description}</li>)}</ol>}
      </div>
    </Dialog>
  );
}

function SetName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return <input aria-label="Set name" className="w-full bg-transparent font-serif text-[15px] font-semibold outline-none" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== name && onSave(v.trim())} maxLength={80} />;
}

function TargetField({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value === null ? "" : formatMmSs(value));
  useEffect(() => setV(value === null ? "" : formatMmSs(value)), [value]);
  return <label className="mt-1.5 flex items-center gap-1 text-[12px]"><span className="meta">Target</span><TextInput value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { const s = v.trim() ? parseMmSs(v.trim()) : null; if (v.trim() && s === null) { toast("Use m:ss, like 5:00"); return; } if (s !== value) onSave(s); }} placeholder="5:00" className="w-[72px] !py-1 text-[12px]" aria-label="Target runtime" /></label>;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}

/** P6 — talk track. */
function SetPhone({ data }: { data: SetDTO }) {
  const router = useRouter();
  const { set, working } = data;
  const [mode, setMode] = useState<"script" | "big">("script");
  const [logOpen, setLogOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  useEffect(() => setMode(readLocal(`talkTrack:${set.id}`, "script")), [set.id]);
  useEffect(() => { if (data.active_performance) setMarking(true); }, [data.active_performance]);
  const currentAnchor = data.anchors.find((a) => a.is_current) ?? null;
  return (
    <PhonePage id="P6" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.push("/sets")}>‹ Sets</button>} title={set.name} right={<SegmentedControl size="sm" ariaLabel="Text size" value={mode} options={[{ value: "script", label: "Script" }, { value: "big", label: "Big" }]} onChange={(v) => { setMode(v); writeLocal(`talkTrack:${set.id}`, v); }} />}>
      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {currentAnchor ? <Chip variant={data.changed_since_anchor ? "dashed" : "version"}>{data.changed_since_anchor ? `${currentAnchor.label} + changes` : currentAnchor.label}</Chip> : <Chip variant="dashed">unanchored</Chip>}
          <RuntimeLine runtime={working.runtime_seconds} target={set.target_duration_seconds} />
          <span className="meta">{working.items.length} bits</span>
        </div>
        {data.active_performance && (
          <div className="mb-3 rounded-[10px] border border-accent-border bg-accent-wash p-3">
            <button type="button" className="flex w-full items-center justify-between text-[13px] font-semibold" onClick={() => setMarking((v) => !v)}><span>Mark tonight&apos;s set</span><span className="text-accent-dark">{marking ? "Hide" : "Show"}</span></button>
            {marking && <div className="mt-2"><MarkPanel performance={data.active_performance} setId={set.id} big /></div>}
          </div>
        )}
        {working.items.length === 0 ? <EmptyState title="Nothing in this set yet." body="Build the order on desktop; the talk track lives here." /> : <ScriptView script={working.script ?? []} big={mode === "big"} />}
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" full disabled={!working.items.length} onClick={() => setLogOpen(true)}>Log performance</Button>
          {data.anchors.length > 0 && <div className="meta text-center">Anchors: {data.anchors.map((a) => <Link key={a.revision_id} href={`/sets/${set.id}/revisions/${a.revision_id}`} className="ml-1 text-accent-dark">{a.label}</Link>)}</div>}
        </div>
      </div>
      <LogPerformanceDialog open={logOpen} onOpenChange={setLogOpen} setId={set.id} anchors={data.anchors.map((a) => ({ revision_id: a.revision_id, label: a.label, name: a.name }))} changedSinceAnchor={data.changed_since_anchor || set.current_anchor_id === null} currentAnchorNumber={set.current_anchor_number} onLogged={() => setMarking(true)} />
    </PhonePage>
  );
}
