"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, cx } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { formatMmSs } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { BitRow, NotesList, PickDialog, TransitionSlot, transitionFor } from "@/components/sets/SetParts";
import type { ForkDTO, RevisionDTO } from "@/types/dto";

type Variant = ForkDTO["variants"][number];

/** D7 — compare the variants of one fork group. */
export default function ComparePage() {
  const { setId, forkGroupId } = useParams<{ setId: string; forkGroupId: string }>();
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: qk.fork(setId, forkGroupId), queryFn: () => api.get<ForkDTO>(`/sets/${setId}/forks/${forkGroupId}`) });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pick, setPick] = useState<Variant | null>(null);
  const [discard, setDiscard] = useState<Variant | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.fork(setId, forkGroupId) }); qc.invalidateQueries({ queryKey: qk.set(setId) }); };
  const another = useMutation({ mutationFn: (fromId: string) => api.post<RevisionDTO>(`/set-revisions/${fromId}/duplicate`), onSuccess: refresh, onError: (e) => toast(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/set-revisions/${id}`), onSuccess: () => { refresh(); toast("Variant discarded"); }, onError: (e) => toast(e.message) });
  if (!mounted) return null;
  if (error instanceof ApiRequestError && error.status === 404) return <EmptyState title="That comparison isn't here." action={<Link href={`/sets/${setId}`} className="text-accent-dark">Back to the set</Link>} />;
  if (!data) return <SkeletonRows n={4} />;
  const { base, variants, fork_group: group } = data;
  const open = variants.filter((v) => v.variant_state === "open");
  const picked = variants.find((v) => v.variant_state === "picked") ?? null;
  const inserted = group.inserted_bit_id;
  const highlighted = highlight ?? inserted;

  const columns = (
    <div className={cx("flex gap-3", phone ? "flex-col" : "h-full items-start overflow-x-auto")}>
      <Column title={`Base · v${base.anchor_number}${base.name ? ` · ${base.name}` : ""}`} rev={base} highlighted={highlighted} onHighlight={setHighlight} phone={phone} muted />
      {variants.map((v) => (
        <Column key={v.id} title={`Variant ${v.variant_letter}`} code={v.ordering_code} rev={v} highlighted={highlighted} onHighlight={setHighlight} phone={phone} state={v.variant_state} actions={v.variant_state === "open" ? <div className="flex gap-1.5"><Button size="sm" variant="primary" onClick={() => setPick(v)}>Pick</Button><Button size="sm" onClick={() => setDiscard(v)}>Discard</Button></div> : v.variant_state === "picked" ? <Link href={`/sets/${setId}/revisions/${v.id}`} className="text-[12px] font-semibold text-accent-dark">Picked as v{v.anchor_number} · open</Link> : <span className="meta">unpicked</span>} />
      ))}
      {open.length > 0 && !phone && <button type="button" onClick={() => another.mutate(open[open.length - 1].id)} className="flex h-[120px] w-[200px] shrink-0 items-center justify-center rounded-lg border border-dashed border-dashed text-[13px] text-ink-2 hover:border-accent hover:text-accent-dark">+ Another ordering</button>}
    </div>
  );

  const inspector = (
    <Inspector title={group.mode === "insert_all_positions" ? "Trying a bit in every position" : "Comparing orderings"}>
      {group.mode === "insert_all_positions" && inserted && <p className="text-[13px]"><strong>{group.inserted_bit_name}</strong> is placed at a different position in each variant. The highlighted bit is the inserted one.</p>}
      <InspectorSection title="How this works">
        <ul className="list-disc space-y-1 pl-4 text-[12px] text-ink-body">
          <li>Every variant starts from v{base.anchor_number}. Transitions you already wrote carry over where the pairs still touch.</li>
          <li><strong>Pick</strong> turns one variant into the next anchor and your working copy. The rest stay as unpicked variants.</li>
          <li><strong>Discard</strong> drops a variant for good. <strong>+ Another ordering</strong> copies one so you can reorder it on its own page.</li>
        </ul>
      </InspectorSection>
      <InspectorSection title="Runtime">
        <ul className="space-y-1 text-[12px]">{variants.map((v) => <li key={v.id} className="flex justify-between"><span>Variant {v.variant_letter}</span><span>{formatMmSs(v.runtime_seconds)} · {v.transitions_to_write} to write</span></li>)}</ul>
      </InspectorSection>
      <div className="flex flex-col gap-2 border-t border-divider pt-3">
        {picked && <p className="meta">Picked: Variant {picked.variant_letter} became v{picked.anchor_number}.</p>}
        <Link href={`/sets/${setId}`} className="text-[13px] font-semibold text-accent-dark">{open.length ? "Keep all as variants for now" : "Back to the set"}</Link>
      </div>
    </Inspector>
  );

  const dialogs = (
    <>
      <PickDialog open={!!pick} onOpenChange={(o) => !o && setPick(null)} revision={pick} onPicked={(sid) => router.push(`/sets/${sid}`)} />
      <ConfirmDialog open={!!discard} onOpenChange={(o) => !o && setDiscard(null)} title={`Discard Variant ${discard?.variant_letter}?`} body="This ordering is deleted. Bits and transitions are untouched." confirmLabel="Discard" onConfirm={() => { if (discard) remove.mutate(discard.id); setDiscard(null); }} />
    </>
  );

  if (phone) {
    return (
      <PhonePage id="D7" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.push(`/sets/${setId}`)}>‹ Set</button>} title="Compare">
        <div className="p-4">{columns}{open.length > 0 && <Button full className="mt-3" onClick={() => another.mutate(open[open.length - 1].id)}>+ Another ordering</Button>}</div>
        {dialogs}
      </PhonePage>
    );
  }
  return (
    <DesktopPage id="D7" inspector={inspector} inspectorOpen>
      <div className="flex h-full flex-col">
        <CenterHeader title={`Compare · from v${base.anchor_number}`} chip={<Chip variant="version">{variants.length} variant{variants.length === 1 ? "" : "s"}</Chip>} meta={group.mode === "insert_all_positions" ? `placing “${group.inserted_bit_name}”` : "duplicate of the anchor"}>
          <Link href={`/sets/${setId}`} className="text-[13px] font-semibold text-accent-dark">Back to the set</Link>
        </CenterHeader>
        <div className="min-h-0 flex-1 overflow-auto p-5">{columns}</div>
      </div>
      {dialogs}
    </DesktopPage>
  );
}

function Column({ title, code, rev, highlighted, onHighlight, phone, muted, state, actions }: { title: string; code?: string; rev: RevisionDTO; highlighted: string | null; onHighlight: (id: string | null) => void; phone: boolean; muted?: boolean; state?: RevisionDTO["variant_state"]; actions?: React.ReactNode }) {
  return (
    <section className={cx("flex shrink-0 flex-col gap-2 rounded-lg border bg-surface p-3", phone ? "w-full" : "w-[260px]", muted ? "border-divider opacity-80" : state === "picked" ? "border-accent" : "border-border", state === "unpicked" && "opacity-60")}>
      <div className="flex items-baseline justify-between"><span className="font-serif text-[14px] font-semibold">{title}</span>{code && <span className="font-mono text-[11px] text-ink-2" title="Ordering code: each letter is a bit from the base, + is the inserted bit">{code}</span>}</div>
      <div className="meta">{formatMmSs(rev.runtime_seconds)}{rev.transitions_to_write > 0 ? ` · ${rev.transitions_to_write} to write` : " · transitions done"}</div>
      <ol className="flex flex-col gap-1">
        {rev.items.map((it, i) => (
          <li key={it.bit_id}>
            <BitRow item={it} compact selected={highlighted === it.bit_id} highlight={it.is_new_in_revision} onClick={() => onHighlight(highlighted === it.bit_id ? null : it.bit_id)} />
            {i < rev.items.length - 1 && <div className="mt-1"><TransitionSlot compact t={transitionFor(rev, it.bit_id, rev.items[i + 1].bit_id)} /></div>}
          </li>
        ))}
      </ol>
      {rev.notes.length > 0 && <NotesList notes={rev.notes} />}
      {actions}
    </section>
  );
}
