"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SegmentedControl, SkeletonRows } from "@/components/ui/primitives";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { formatMmSs, shortDateTime } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { BitRow, NotesList, PickDialog, ScriptView, TransitionSlot, downloadText, revisionMarkdown, transitionFor, useWorkingCopyResolution } from "@/components/sets/SetParts";
import type { PerformanceDTO, RevisionDTO, SetDTO } from "@/types/dto";

/** S10 — a frozen anchor or a variant, read-only. */
export default function RevisionPage() {
  const { setId, revisionId } = useParams<{ setId: string; revisionId: string }>();
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: rev, error } = useQuery({ queryKey: qk.revision(revisionId), queryFn: () => api.get<RevisionDTO>(`/set-revisions/${revisionId}?include=script`) });
  const { data: set } = useQuery({ queryKey: qk.set(setId), queryFn: () => api.get<SetDTO>(`/sets/${setId}`) });
  const { data: perfs } = useQuery({ queryKey: qk.performances(setId), queryFn: () => api.get<{ items: PerformanceDTO[] }>(`/performances?set_id=${setId}&limit=100`).then((r) => r.items) });
  const [view, setView] = useState<"flow" | "script">("script");
  const [pickOpen, setPickOpen] = useState(false);
  const { guard, dialog } = useWorkingCopyResolution();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.set(setId) }); qc.invalidateQueries({ queryKey: qk.sets }); qc.invalidateQueries({ queryKey: qk.revision(revisionId) }); };
  const fork = useMutation({ mutationFn: () => api.post<{ fork_group_id: string }>(`/sets/${setId}/forks`, { base_revision_id: revisionId, mode: "duplicate" }), onSuccess: (r) => { refresh(); router.push(`/sets/${setId}/compare/${r.fork_group_id}`); }, onError: (e) => toast(e.message) });
  const restore = () => guard(async (res) => { await api.post(`/set-revisions/${revisionId}/restore`, res ?? {}); refresh(); toast(`Working copy now matches v${rev?.anchor_number}`); router.push(`/sets/${setId}`); }).catch((e) => toast((e as Error).message));
  if (!mounted) return null;
  if (error instanceof ApiRequestError && error.status === 404) return <EmptyState title="That version isn't here." action={<Link href={`/sets/${setId}`} className="text-accent-dark">Back to the set</Link>} />;
  if (!rev) return <SkeletonRows n={4} />;
  const label = rev.kind === "anchor" ? `v${rev.anchor_number}` : `Variant ${rev.variant_letter}`;
  const title = `${set?.set.name ?? "Set"} · ${label}${rev.name ? ` · ${rev.name}` : ""}`;
  const isCurrent = set?.set.current_anchor_id === rev.id;
  const performed = (perfs ?? []).filter((p) => p.revision_id === rev.id);

  const body = view === "script" ? (
    <ScriptView script={rev.script ?? []} />
  ) : (
    <ol className="mx-auto flex max-w-[560px] flex-col gap-1.5">
      {rev.items.map((it, i) => (
        <li key={it.bit_id} className="flex flex-col gap-1.5">
          <BitRow item={it} highlight={it.is_new_in_revision} />
          {i < rev.items.length - 1 && <TransitionSlot t={transitionFor(rev, it.bit_id, rev.items[i + 1].bit_id)} />}
        </li>
      ))}
    </ol>
  );

  const actions = (
    <div className="flex flex-col gap-2">
      {rev.kind === "anchor" && <Button variant="primary" onClick={() => fork.mutate()}>Fork from here</Button>}
      {rev.kind === "anchor" && <Button onClick={restore} disabled={isCurrent && !set?.changed_since_anchor}>Restore as working copy</Button>}
      {rev.kind === "variant" && rev.variant_state === "open" && <Button variant="primary" onClick={() => setPickOpen(true)}>Pick for variants</Button>}
      {rev.fork_group_id && <Link href={`/sets/${setId}/compare/${rev.fork_group_id}`} className="text-[13px] font-semibold text-accent-dark">Open the comparison</Link>}
      <Button onClick={() => downloadText(`${title}.md`, revisionMarkdown(set?.set.name ?? "Set", rev))}>Export .md</Button>
    </div>
  );

  const inspector = (
    <Inspector title={rev.kind === "anchor" ? "Anchor" : "Variant"} meta={rev.frozen_at ? `frozen ${shortDateTime(rev.frozen_at)}` : rev.variant_state ?? ""}>
      <p className="meta">{rev.items.length} bits · {formatMmSs(rev.runtime_seconds)}{rev.parent_anchor_number ? ` · from v${rev.parent_anchor_number}` : ""}{isCurrent ? " · current anchor" : ""}</p>
      {rev.variant_description && <p className="text-[12px]">{rev.variant_description}</p>}
      <InspectorSection title="Notes at the time"><NotesList notes={rev.notes} /></InspectorSection>
      {performed.length > 0 && <InspectorSection title="Performed"><ul className="space-y-1 text-[12px]">{performed.map((p) => <li key={p.id}>{p.performed_on}{p.venue_label ? ` · ${p.venue_label}` : ""} · {p.marks.filter((m) => m.result === "landed").length} landed, {p.marks.filter((m) => m.result === "flat").length} flat, {p.marks.filter((m) => m.result === "cut").length} cut</li>)}</ul></InspectorSection>}
      {rev.kind === "anchor" && <p className="meta">Anchors never change. Jokes pinned here are sealed at the version they had.</p>}
      {actions}
    </Inspector>
  );

  const dialogs = (
    <>
      <PickDialog open={pickOpen} onOpenChange={setPickOpen} revision={rev} onPicked={(sid) => router.push(`/sets/${sid}`)} />
      {dialog}
    </>
  );

  if (phone) {
    return (
      <PhonePage id="S10" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.push(`/sets/${setId}`)}>‹ Set</button>} title={label} right={<Chip variant="version">read-only</Chip>}>
        <div className="p-4">
          <h1 className="mb-1 font-serif text-[18px] font-semibold">{title}</h1>
          <p className="meta mb-3">{rev.items.length} bits · {formatMmSs(rev.runtime_seconds)}</p>
          <ScriptView script={rev.script ?? []} />
          <div className="mt-5">{actions}</div>
        </div>
        {dialogs}
      </PhonePage>
    );
  }
  return (
    <DesktopPage id="S10" inspector={inspector} inspectorOpen>
      <div className="flex h-full flex-col">
        <CenterHeader title={title} chip={<Chip variant={rev.kind === "anchor" ? "version" : "dashed"}>{rev.kind === "anchor" ? "anchor" : rev.variant_state ?? "variant"}</Chip>} meta={`${rev.items.length} bits · ${formatMmSs(rev.runtime_seconds)} · read-only`}>
          <SegmentedControl size="sm" ariaLabel="View" value={view} options={[{ value: "flow", label: "Flow" }, { value: "script", label: "Script" }]} onChange={setView} />
          <Link href={`/sets/${setId}`} className="text-[13px] font-semibold text-accent-dark">Back to the set</Link>
        </CenterHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
      </div>
      {dialogs}
    </DesktopPage>
  );
}
