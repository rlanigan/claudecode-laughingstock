"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, TextArea, TextInput, cx } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { dateOnly } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import type { PerformanceDTO, PerformanceResult } from "@/types/dto";

/** S11 — Performed log. */
export default function PerformancesPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const [open, setOpen] = useState<PerformanceDTO | null>(null);
  const list = useInfiniteQuery({
    queryKey: qk.performances(),
    queryFn: ({ pageParam }) => api.get<{ items: PerformanceDTO[]; next_cursor: string | null }>(`/performances${qs({ limit: 30, cursor: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (l) => l.next_cursor ?? undefined,
  });
  if (!mounted) return null;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = (p: PerformanceDTO) => {
    const c = (r: PerformanceResult) => p.marks.filter((m) => m.result === r).length;
    return `✓ ${c("landed")} landed · ${c("flat")} flat · ${c("cut")} cut`;
  };
  const body = (
    <div className="mx-auto max-w-[840px] p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3"><h2 className="font-serif text-[18px] font-semibold">Performed log</h2><span className="meta">{items.length} performances</span></div>
      {list.isLoading && <SkeletonRows n={3} />}
      {list.data && items.length === 0 && <EmptyState title="Nothing performed yet." body="Log a performance from a set's talk track." />}
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="flex w-full flex-wrap items-center gap-3 px-3.5 py-3 text-left hover:bg-surface" onClick={() => setOpen(p)}>
              <span className="font-mono text-[12px]">{dateOnly(p.performed_on)}</span>
              <span className="text-[14px] font-semibold">{p.set_name}</span>
              <Chip variant="version">v{p.anchor_number}</Chip>
              <span className="text-[13px] text-ink-2">{p.venue_label ?? ""}</span>
              <span className="meta ml-auto">{summary(p)}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.hasNextPage && <div className="mt-3 text-center"><Button onClick={() => list.fetchNextPage()}>Load more</Button></div>}
      {open && <PerformanceDetail performance={open} onClose={() => setOpen(null)} />}
    </div>
  );
  if (phone) return <PhonePage id="S11" title="Performed log">{body}</PhonePage>;
  return <DesktopPage id="S11"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}

export function PerformanceDetail({ performance: initial, onClose }: { performance: PerformanceDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = useState(initial);
  const [venue, setVenue] = useState(initial.venue_label ?? "");
  const [notes, setNotes] = useState(initial.notes);
  const [del, setDel] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["performances"] });
    qc.invalidateQueries({ queryKey: qk.set(p.set_id) });
    qc.invalidateQueries({ queryKey: ["card"] });
    qc.invalidateQueries({ queryKey: ["lineage"] });
  };
  const mark = useMutation({ mutationFn: ({ bitId, result }: { bitId: string; result: PerformanceResult }) => api.put<{ performance: PerformanceDTO }>(`/performances/${p.id}/marks/${bitId}`, { result }), onSuccess: (r) => { setP(r.performance); refresh(); } });
  const unmark = useMutation({ mutationFn: (bitId: string) => api.delete(`/performances/${p.id}/marks/${bitId}`), onSuccess: async () => { const r = await api.get<{ performance: PerformanceDTO }>(`/performances/${p.id}`); setP(r.performance); refresh(); } });
  const patch = useMutation({ mutationFn: (body: { venue_label?: string | null; notes?: string }) => api.patch<{ performance: PerformanceDTO }>(`/performances/${p.id}`, body), onSuccess: (r) => { setP(r.performance); refresh(); } });
  const remove = useMutation({ mutationFn: () => api.delete(`/performances/${p.id}`), onSuccess: () => { refresh(); toast("Performance deleted"); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${p.set_name} · v${p.anchor_number}`} description={`${dateOnly(p.performed_on)}${p.anchor_name ? ` · ${p.anchor_name}` : ""}`} width={560}
      footer={<><Button variant="danger" onClick={() => setDel(true)}>Delete performance</Button><Link href={`/sets/${p.set_id}/revisions/${p.revision_id}?mode=script`} className="ml-auto self-center text-[13px] font-semibold text-accent-dark">Open script</Link><Button onClick={onClose}>Done</Button></>}
    >
      <div className="flex flex-col gap-3">
        <label className="block"><span className="label mb-1 block">Venue</span><TextInput value={venue} onChange={(e) => setVenue(e.target.value)} onBlur={() => venue !== (p.venue_label ?? "") && patch.mutate({ venue_label: venue || null })} maxLength={80} /></label>
        <div>
          <span className="label mb-1 block">Marks</span>
          <ul className="divide-y divide-divider rounded-md border border-border bg-card">
            {p.bits.map((b) => {
              const m = p.marks.find((x) => x.bit_id === b.bit_id);
              return (
                <li key={b.bit_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="meta w-5">{b.position + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{b.bit_name}</span>
                  {(["landed", "flat", "cut"] as const).map((r) => (
                    <Chip key={r} variant={m?.result === r ? (r === "landed" ? "success" : r === "cut" ? "danger" : "dark") : "status"} pressed={m?.result === r} onClick={() => (m?.result === r ? unmark.mutate(b.bit_id) : mark.mutate({ bitId: b.bit_id, result: r }))} className={cx("!px-3 !py-2 md:!py-1")}>
                      {r === "cut" ? "cut it" : r}
                    </Chip>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
        <label className="block"><span className="label mb-1 block">Notes</span><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== p.notes && patch.mutate({ notes })} className="min-h-[70px]" maxLength={5000} /></label>
      </div>
      <ConfirmDialog open={del} onOpenChange={setDel} title="Delete this performance?" body="Its marks go with it, and joke statuses are recomputed." confirmLabel="Delete" onConfirm={() => remove.mutateAsync().then(() => undefined)} />
    </Dialog>
  );
}
