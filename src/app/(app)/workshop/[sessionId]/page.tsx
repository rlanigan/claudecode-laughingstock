"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, EmptyState, SkeletonRows } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useCardList } from "@/components/cards/hooks";
import { useIsPhone, useMounted } from "@/lib/hooks";
import type { SessionSummaryDTO } from "@/types/dto";

/** /workshop/{sessionId}: opens the most recently edited seed, or offers to pull one from the inbox. */
export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const phone = useIsPhone();
  const mounted = useMounted();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: qk.session(sessionId), queryFn: () => api.get<{ session: SessionSummaryDTO }>(`/workshop/sessions/${sessionId}`).then((r) => r.session) });
  const [pick, setPick] = useState(false);
  const inbox = useCardList({ view: "inbox", limit: 50 }, pick);
  const seed = useMutation({
    mutationFn: (n: number) => api.post<{ session_id: string }>("/workshop/seed", { card_number: n, session_id: sessionId }),
    onSuccess: (_r, n) => {
      qc.invalidateQueries({ queryKey: ["workshop"] });
      qc.invalidateQueries({ queryKey: ["cards"] });
      router.replace(`/workshop/${sessionId}/seeds/${n}`);
    },
  });
  useEffect(() => {
    if (data?.seeds.length) router.replace(`/workshop/${sessionId}/seeds/${data.seeds[0].card.number}`);
  }, [data, router, sessionId]);
  if (!mounted) return null;
  const body = isLoading || !data ? <SkeletonRows n={3} /> : data.seeds.length ? null : (
    <EmptyState title="No seeds yet. Pull a card from your inbox." action={<Button variant="primary" onClick={() => setPick(true)}>+ Pull from inbox</Button>} />
  );
  const picker = (
    <Dialog open={pick} onOpenChange={setPick} title="Pull from inbox" width={480}>
      <ul className="divide-y divide-divider rounded-md border border-border bg-card">
        {(inbox.data?.items ?? []).map((c) => (
          <li key={c.id}><button type="button" className="block w-full px-3 py-2.5 text-left text-[14px] hover:bg-surface" onClick={() => seed.mutate(c.number)}><span className="meta mr-2">{c.display_number}</span>{c.display_title}</button></li>
        ))}
        {inbox.data && inbox.data.items.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-2">Inbox is empty.</li>}
      </ul>
    </Dialog>
  );
  if (phone) return <PhonePage id="S9" title={data?.title ?? "Session"}>{body}{picker}</PhonePage>;
  return <DesktopPage id="S9"><div className="h-full overflow-y-auto">{body}</div>{picker}</DesktopPage>;
}
