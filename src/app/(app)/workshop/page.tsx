"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { shortDate } from "@/lib/format";
import type { SessionSummaryDTO } from "@/types/dto";

/** S9 — Workshop index. */
export default function WorkshopIndexPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: qk.sessions, queryFn: () => api.get<{ items: SessionSummaryDTO[]; active_session_id: string | null }>("/workshop/sessions") });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  useEffect(() => setOpen(sp.get("new") === "1"), [sp]);
  const create = useMutation({
    mutationFn: () => api.post<{ session: SessionSummaryDTO }>("/workshop/sessions", { title: title.trim() || undefined, participants: participants.split(",").map((p) => p.trim()).filter(Boolean) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.sessions });
      router.push(`/workshop/${r.session.id}`);
    },
  });
  if (!mounted) return null;
  const items = data?.items ?? [];
  const active = items.find((s) => s.id === data?.active_session_id);
  const seedHref = (s: SessionSummaryDTO) => (s.seeds[0] ? `/workshop/${s.id}/seeds/${s.seeds[0].card.number}` : `/workshop/${s.id}`);
  const body = (
    <div className="mx-auto max-w-[840px] p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold">Workshop</h2>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>New session</Button>
      </div>
      {isLoading && <SkeletonRows n={3} />}
      {active && (
        <div className="mb-4 rounded-[10px] border border-accent bg-accent-wash p-4">
          <div className="label mb-1">Active session</div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-serif text-[16px] font-semibold">{active.title}</span>
            <span className="meta">{shortDate(active.started_at)}{active.participants.length ? ` · with ${active.participants.join(", ")}` : " · solo"} · {active.seed_count} seed{active.seed_count === 1 ? "" : "s"}</span>
            <Link href={seedHref(active)} className="ml-auto rounded-md border border-accent-border bg-accent px-3 py-1.5 text-[13px] font-semibold text-white">Continue</Link>
          </div>
        </div>
      )}
      {data && items.length === 0 && <EmptyState title="No sessions yet." body="Send a note to the workshop from your inbox." />}
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {items.filter((s) => s.id !== active?.id).map((s) => (
          <li key={s.id}>
            <Link href={seedHref(s)} className="flex flex-wrap items-center gap-3 px-3.5 py-3 hover:bg-surface">
              <span className="font-mono text-[12px]">{shortDate(s.started_at)}</span>
              <span className="text-[14px] font-semibold">{s.title}</span>
              <span className="meta">{s.participants.length ? `with ${s.participants.join(", ")}` : "solo"} — {s.seed_count} seed{s.seed_count === 1 ? "" : "s"}</span>
              <span className="ml-auto flex gap-1">
                {s.promoted_count > 0 && <Chip variant="version">{s.promoted_count} promoted</Chip>}
                {s.ended_at === null && <Chip variant="dashed">open</Chip>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) router.replace("/workshop"); }} title="New session" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>Start</Button></>}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="block"><span className="label mb-1 block">Title</span><TextInput autoFocus placeholder={`Session · ${shortDate(new Date().toISOString())}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
          <label className="block"><span className="label mb-1 block">Who&apos;s there (comma-separated)</span><TextInput placeholder="Sam" value={participants} onChange={(e) => setParticipants(e.target.value)} /></label>
        </form>
      </Dialog>
    </div>
  );
  if (phone) return <PhonePage id="S9" title="Workshop">{body}</PhonePage>;
  return <DesktopPage id="S9"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}
