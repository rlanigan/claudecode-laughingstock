"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { Button, Chip, TextArea, TextInput, cx } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { defaultAnchorName, formatMmSs, todayIso } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import type { NoteDTO, PerformanceDTO, PerformanceResult, RevisionDTO, RevisionItemDTO, ScriptBlockDTO, TransitionDTO } from "@/types/dto";

export const padNum = (n: number) => `#${String(n).padStart(4, "0")}`;

export function transitionFor(rev: RevisionDTO, from: string, to: string): TransitionDTO | undefined {
  return rev.transitions.find((t) => t.from_bit_id === from && t.to_bit_id === to);
}

/** Runtime vs target line. */
export function RuntimeLine({ runtime, target, className }: { runtime: number; target: number | null; className?: string }) {
  const over = target !== null && runtime > target;
  return (
    <span className={cx("meta", over && "text-danger-text", className)}>
      {formatMmSs(runtime)}{target !== null ? ` / ${formatMmSs(target)} target` : ""}{over ? " · over" : ""}
    </span>
  );
}

export function NotesList({ notes, empty = "Nothing to flag." }: { notes: NoteDTO[]; empty?: string }) {
  if (!notes.length) return <p className="meta">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-[12px]">
      {notes.map((n, i) => (
        <li key={`${n.code}-${i}`} className={cx("flex gap-1.5 rounded-md border px-2 py-1.5", n.kind === "warning" ? "border-amber-300 bg-amber-50" : n.kind === "positive" ? "border-success-text/40 bg-success-bg" : "border-border bg-card")}>
          <span aria-hidden>{n.kind === "warning" ? "△" : n.kind === "positive" ? "✓" : "·"}</span>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A bit in the spine (read-only variant). */
export function BitRow({ item, selected, onClick, compact, highlight, trailing }: { item: RevisionItemDTO; selected?: boolean; onClick?: () => void; compact?: boolean; highlight?: boolean; trailing?: React.ReactNode }) {
  const inner = (
    <>
      <span className="meta w-5 shrink-0 text-right">{item.position + 1}</span>
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate font-semibold", compact ? "text-[12px]" : "text-[13px]")}>{item.bit_name}{item.archived && <Chip variant="dashed" className="ml-1">archived</Chip>}</span>
        {!compact && <span className="meta block">{item.joke_count} joke{item.joke_count === 1 ? "" : "s"} · {formatMmSs(item.duration_seconds)}{item.primary_subject ? ` · ${item.primary_subject}` : ""}{item.marked_cut_on ? " · marked cut" : ""}</span>}
      </span>
      {highlight && <Chip variant="accent">new</Chip>}
      {trailing}
    </>
  );
  const cls = cx("flex w-full items-center gap-2 rounded-md border bg-card px-2.5 text-left", compact ? "py-1.5" : "py-2", selected ? "border-accent ring-2 ring-[var(--accent-ring)]" : highlight ? "border-accent" : "border-border", item.marked_cut_on && "opacity-60");
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** The slot between two bits. */
export function TransitionSlot({ t, selected, onClick, compact }: { t: TransitionDTO | undefined; selected?: boolean; onClick?: () => void; compact?: boolean }) {
  const state = t?.state ?? "missing";
  const label = state === "written" ? (t?.text ?? "") : state === "hard_cut" ? "Hard cut" : "Write the transition";
  const cls = cx("mx-4 flex items-center gap-2 rounded-full border px-3 text-left", compact ? "py-0.5 text-[11px]" : "py-1 text-[12px]", state === "written" ? "border-wire bg-surface text-ink-body" : state === "hard_cut" ? "border-dashed border-wire text-ink-2" : "border-dashed border-amber-300 bg-amber-50 text-amber-900", selected && "ring-2 ring-[var(--accent-ring)]");
  const inner = <><span aria-hidden className="shrink-0 text-ink-2">{state === "hard_cut" ? "✂" : "↓"}</span><span className="truncate">{label}</span>{t?.callback_to_card_number !== null && t?.callback_to_card_number !== undefined && <Chip variant="theme">callback {padNum(t.callback_to_card_number)}</Chip>}</>;
  return onClick ? <button type="button" onClick={onClick} className={cx(cls, "w-[calc(100%-2rem)]")}>{inner}</button> : <div className={cls}>{inner}</div>;
}

/** Rendered script (bit headers, jokes, bridges, transitions). */
export function ScriptView({ script, big = false, hideTransitions = false }: { script: ScriptBlockDTO[]; big?: boolean; hideTransitions?: boolean }) {
  if (!script.length) return <p className="meta">Nothing in this set yet.</p>;
  return (
    <div className={cx("mx-auto flex max-w-[620px] flex-col", big ? "gap-5" : "gap-3")}>
      {script.map((b, i) => {
        if (b.type === "bit_header") return <div key={i} className={cx("mt-2 flex items-baseline justify-between border-b border-divider pb-1", i > 0 && "mt-5")}><span className={cx("font-serif font-semibold", big ? "text-[22px]" : "text-[15px]")}>{b.position + 1}. {b.name}</span><span className="meta">{formatMmSs(b.duration_seconds)}</span></div>;
        if (b.type === "joke") return <p key={i} className={cx("whitespace-pre-wrap", big ? "text-[22px] leading-[1.45]" : "text-[14px] leading-[1.5]")}>{b.text} <span className="meta whitespace-nowrap align-middle">{padNum(b.card_number)} {b.version_label}</span></p>;
        if (b.type === "bridge") return <p key={i} className={cx("whitespace-pre-wrap italic text-ink-body", big ? "text-[20px]" : "text-[13px]")}>{b.text}</p>;
        if (hideTransitions) return null;
        return <p key={i} className={cx("rounded-md border border-dashed px-3 py-1.5", big ? "text-[18px]" : "text-[12px]", b.state === "missing" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-wire text-ink-2")}>{b.state === "hard_cut" ? "✂ Hard cut" : b.state === "missing" ? "△ Transition to write" : `→ ${b.text}`}</p>;
      })}
    </div>
  );
}

export function revisionMarkdown(name: string, rev: RevisionDTO): string {
  const lines: string[] = [`# ${name}${rev.anchor_number ? ` v${rev.anchor_number}` : ""}${rev.name ? ` — ${rev.name}` : ""}`, "", `Runtime ${formatMmSs(rev.runtime_seconds)}`, ""];
  for (const b of rev.script ?? []) {
    if (b.type === "bit_header") lines.push("", `## ${b.position + 1}. ${b.name}`, "");
    else if (b.type === "joke") lines.push(b.text, "");
    else if (b.type === "bridge") lines.push(`_${b.text}_`, "");
    else lines.push(b.state === "hard_cut" ? "> ✂ hard cut" : b.state === "missing" ? "> (transition to write)" : `> ${b.text}`, "");
  }
  return lines.join("\n");
}

export function downloadText(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name;
  a.click();
}

/** M15 — Anchor this. */
export function AnchorDialog({ open, onOpenChange, setId, nextNumber, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; setId: string; nextNumber: number; onDone?: (anchor: RevisionDTO) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(defaultAnchorName()); }, [open]);
  const m = useMutation({ mutationFn: () => api.post<{ anchor: RevisionDTO }>(`/sets/${setId}/anchors`, { name: name.trim() }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: qk.set(setId) }); qc.invalidateQueries({ queryKey: qk.sets }); qc.invalidateQueries({ queryKey: ["cards"] }); toast(`Anchored as v${r.anchor.anchor_number}`); onOpenChange(false); onDone?.(r.anchor); }, onError: (e) => toast(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Anchor as v${nextNumber}`} screenId="M15" description="Freezes this order, the pinned joke versions and the transitions. The working copy keeps going from here." footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>Anchor</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }}>
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Anchor name" placeholder="e.g. Open mic, Tuesday" />
      </form>
    </Dialog>
  );
}

/**
 * M16 — the working copy has changes since the current anchor.
 * Wraps a mutation that may fail with WORKING_COPY_CHANGED and re-runs it with a resolution.
 */
export function useWorkingCopyResolution() {
  const [pending, setPending] = useState<{ anchorNumber: number | null; action: string; run: (res: { working_copy_resolution: "anchor_first" | "discard"; anchor_first_name?: string }) => Promise<unknown> } | null>(null);
  const guard = async (run: (res?: { working_copy_resolution: "anchor_first" | "discard"; anchor_first_name?: string }) => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "WORKING_COPY_CHANGED") {
        const d = (e.details ?? {}) as { current_anchor_number?: number | null; action?: string };
        setPending({ anchorNumber: d.current_anchor_number ?? null, action: d.action ?? "continue", run: (res) => run(res) });
      } else throw e;
    }
  };
  const dialog = <WorkingCopyDialog pending={pending} onClose={() => setPending(null)} />;
  return { guard, dialog };
}

function WorkingCopyDialog({ pending, onClose }: { pending: { anchorNumber: number | null; action: string; run: (res: { working_copy_resolution: "anchor_first" | "discard"; anchor_first_name?: string }) => Promise<unknown> } | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pending) setName(defaultAnchorName()); }, [pending]);
  const go = async (res: { working_copy_resolution: "anchor_first" | "discard"; anchor_first_name?: string }) => {
    setBusy(true);
    try { await pending!.run(res); onClose(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const verb = pending?.action === "pick" ? "picking" : pending?.action === "restore" ? "restoring" : "continuing";
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && onClose()} title="Your working copy has changes" screenId="M16" description={`It has changed since v${pending?.anchorNumber ?? 0}. Keep them by anchoring first, or drop them before ${verb}.`}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="label mb-1">Anchor the working copy first as</div>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Anchor name" />
          <Button variant="primary" className="mt-2" disabled={!name.trim() || busy} onClick={() => go({ working_copy_resolution: "anchor_first", anchor_first_name: name.trim() })}>Anchor, then continue</Button>
        </div>
        <Button disabled={busy} onClick={() => go({ working_copy_resolution: "discard" })}>Discard working changes and continue</Button>
        <Button disabled={busy} onClick={onClose} className="self-end">Cancel</Button>
      </div>
    </Dialog>
  );
}

/** M18 — name the pick. */
export function PickDialog({ open, onOpenChange, revision, onPicked }: { open: boolean; onOpenChange: (o: boolean) => void; revision: RevisionDTO | null; onPicked: (setId: string) => void }) {
  const qc = useQueryClient();
  const { guard, dialog } = useWorkingCopyResolution();
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(revision?.variant_description ? `Variant ${revision.variant_letter}` : defaultAnchorName()); }, [open, revision]);
  const pick = async () => {
    if (!revision) return;
    await guard(async (res) => {
      const r = await api.post<{ anchor: RevisionDTO; set: { set: { id: string } } }>(`/set-revisions/${revision.id}/pick`, { name: name.trim(), ...(res ?? {}) });
      qc.invalidateQueries({ queryKey: qk.set(revision.set_id) });
      qc.invalidateQueries({ queryKey: qk.sets });
      qc.invalidateQueries({ queryKey: ["fork"] });
      qc.invalidateQueries({ queryKey: ["cards"] });
      toast(`Picked as v${r.anchor.anchor_number}`);
      onOpenChange(false);
      onPicked(revision.set_id);
    }).catch((e) => toast((e as Error).message));
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Name the pick" screenId="M18" description="It becomes the next anchor and the working copy. The other orderings stay as unpicked variants." footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={pick}>Pick</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void pick(); }}><TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Anchor name" /></form>
      </Dialog>
      {dialog}
    </>
  );
}

/** M17 — Log a performance. */
export function LogPerformanceDialog({ open, onOpenChange, setId, anchors, changedSinceAnchor, currentAnchorNumber, onLogged }: { open: boolean; onOpenChange: (o: boolean) => void; setId: string; anchors: { revision_id: string; label: string; name: string | null }[]; changedSinceAnchor: boolean; currentAnchorNumber: number | null; onLogged?: (p: PerformanceDTO) => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [which, setWhich] = useState<string>("working");
  const [anchorName, setAnchorName] = useState("");
  const { data: venues } = useQuery({ queryKey: ["venues"], queryFn: () => api.get<{ items: string[] }>("/performances/venues").then((r) => r.items), enabled: open });
  useEffect(() => { if (open) { setDate(todayIso()); setAnchorName(defaultAnchorName()); setWhich(changedSinceAnchor || !anchors.length ? "working" : anchors[anchors.length - 1].revision_id); } }, [open, changedSinceAnchor, anchors]);
  const m = useMutation({
    mutationFn: () => api.post<{ performance: PerformanceDTO }>("/performances", { set_id: setId, performed_on: date, venue_label: venue.trim() || undefined, notes: notes || undefined, ...(which === "working" ? { anchor_working_copy_as: anchorName.trim() } : { revision_id: which }) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: qk.set(setId) }); qc.invalidateQueries({ queryKey: qk.sets }); qc.invalidateQueries({ queryKey: ["performances"] }); qc.invalidateQueries({ queryKey: ["cards"] }); qc.invalidateQueries({ queryKey: ["venues"] }); toast("Performance logged"); onOpenChange(false); onLogged?.(r.performance); },
    onError: (e) => toast(e.message),
  });
  const needsAnchor = which === "working";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Log a performance" screenId="M17" description="Performances are logged against an anchor so the record never shifts under you." footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={m.isPending || (needsAnchor && !anchorName.trim())} onClick={() => m.mutate()}>Log it</Button></>}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px]"><span className="label">Date</span><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayIso()} /></label>
        <label className="flex flex-col gap-1 text-[12px]"><span className="label">Venue</span><TextInput list="venues" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={80} placeholder="e.g. The Comedy Store" /><datalist id="venues">{(venues ?? []).map((v) => <option key={v} value={v} />)}</datalist></label>
        <div className="flex flex-col gap-1 text-[12px]">
          <span className="label">Which version did you perform?</span>
          <select className="field" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Version">
            <option value="working">{changedSinceAnchor ? `The working copy (anchor it as v${(currentAnchorNumber ?? 0) + 1})` : `The working copy as a new anchor v${(currentAnchorNumber ?? 0) + 1}`}</option>
            {[...anchors].reverse().map((a) => <option key={a.revision_id} value={a.revision_id}>{a.label}{a.name ? ` · ${a.name}` : ""}</option>)}
          </select>
          {needsAnchor && <TextInput value={anchorName} onChange={(e) => setAnchorName(e.target.value)} maxLength={80} aria-label="Anchor name" placeholder="Name the anchor" />}
        </div>
        <label className="flex flex-col gap-1 text-[12px]"><span className="label">Notes</span><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} className="min-h-[60px]" placeholder="How did it go?" /></label>
      </div>
    </Dialog>
  );
}

/** Mark bits landed/flat/cut on an active performance. */
export function MarkPanel({ performance, setId, big = false }: { performance: PerformanceDTO; setId: string; big?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.set(setId) }); qc.invalidateQueries({ queryKey: ["performances"] }); };
  const mark = useMutation({ mutationFn: ({ bitId, result }: { bitId: string; result: PerformanceResult | null }) => (result ? api.put(`/performances/${performance.id}/marks/${bitId}`, { result }) : api.delete(`/performances/${performance.id}/marks/${bitId}`)), onSuccess: refresh, onError: (e) => toast(e.message) });
  const notes = useMutation({ mutationFn: (n: string) => api.patch(`/performances/${performance.id}`, { notes: n }), onSuccess: refresh });
  const [n, setN] = useState(performance.notes);
  useEffect(() => setN(performance.notes), [performance.notes]);
  const results: { r: PerformanceResult; label: string }[] = [{ r: "landed", label: "Landed" }, { r: "flat", label: "Flat" }, { r: "cut", label: "Cut" }];
  return (
    <div className="flex flex-col gap-2">
      <div className="meta">Marking v{performance.anchor_number}{performance.anchor_name ? ` · ${performance.anchor_name}` : ""} · {performance.performed_on}{performance.venue_label ? ` · ${performance.venue_label}` : ""}</div>
      <ul className="flex flex-col gap-1.5">
        {performance.bits.map((b) => {
          const cur = performance.marks.find((m) => m.bit_id === b.bit_id)?.result ?? null;
          return (
            <li key={b.bit_id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
              <span className={cx("min-w-0 flex-1 truncate", big ? "text-[15px]" : "text-[13px]")}>{b.position + 1}. {b.bit_name}</span>
              {results.map(({ r, label }) => <Chip key={r} variant={cur === r ? (r === "landed" ? "success" : r === "cut" ? "danger" : "dark") : "status"} pressed={cur === r} onClick={() => mark.mutate({ bitId: b.bit_id, result: cur === r ? null : r })} className={big ? "!min-h-[36px] !px-3" : undefined}>{label}</Chip>)}
            </li>
          );
        })}
      </ul>
      <TextArea value={n} onChange={(e) => setN(e.target.value)} onBlur={() => n !== performance.notes && notes.mutate(n)} placeholder="Performance notes" className="min-h-[56px] text-[13px]" maxLength={5000} />
      <Link href="/performances" className="text-[12px] font-semibold text-accent-dark">All performances</Link>
    </div>
  );
}
