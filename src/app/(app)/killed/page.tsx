"use client";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, EmptyState, SkeletonRows } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { useCardActions } from "@/components/cards/hooks";
import { CardChips } from "@/components/cards/CardChips";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import type { CardSummaryDTO } from "@/types/dto";

/** S5 — Killed pile. */
export default function KilledPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const a = useCardActions();
  const [confirm, setConfirm] = useState<CardSummaryDTO | null>(null);
  const list = useInfiniteQuery({
    queryKey: qk.cards({ view: "killed" }),
    queryFn: ({ pageParam }) => api.get<{ items: CardSummaryDTO[]; next_cursor: string | null; total_estimate: number }>(`/cards${qs({ view: "killed", limit: 30, cursor: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (l) => l.next_cursor ?? undefined,
  });
  if (!mounted) return null;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total_estimate ?? 0;
  const body = (
    <div className="p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold">Killed</h2>
        <span className="meta">{total} killed cards. Dead jokes come back sometimes.</span>
      </div>
      {list.isLoading && <SkeletonRows n={3} />}
      {list.data && items.length === 0 && <EmptyState title="Nothing killed." />}
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {items.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/cards/${c.number}`} className="block">
                {c.title && <div className="text-[14px] font-semibold">{c.title}</div>}
                <div className="line-clamp-2 text-[14px] text-ink-body">{c.body}</div>
              </Link>
              <div className="meta mt-1">killed {c.killed_at ? relativeTime(c.killed_at) : ""} · {c.display_number}</div>
              <div className="mt-1.5"><CardChips card={c} /></div>
            </div>
            <Button size="sm" onClick={() => a.restore.mutate(c.number)}>Restore</Button>
            <Menu trigger={<Button size="sm" aria-label="More">⋯</Button>} items={[{ label: "Open lineage", onSelect: () => (window.location.href = `/cards/${c.number}/lineage`) }, { label: "Delete forever", danger: true, onSelect: () => setConfirm(c) }]} />
          </li>
        ))}
      </ul>
      {list.hasNextPage && <div className="mt-3 text-center"><Button onClick={() => list.fetchNextPage()}>Load more</Button></div>}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.display_number ?? ""} forever?`}
        body="This removes the card, every version, its parts and its lineage links. It can't be undone."
        confirmLabel="Delete forever"
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await a.deleteForever.mutateAsync(confirm.number);
            toast("Deleted forever");
          } catch (e) {
            toast((e as Error).message, { durationMs: 5000 });
          }
        }}
      />
    </div>
  );
  if (phone) return <PhonePage id="S5" title="Killed">{body}</PhonePage>;
  return <DesktopPage id="S5"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}
