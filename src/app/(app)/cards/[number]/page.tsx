"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { CardEditor, CardInspector } from "@/components/cards/CardInspector";
import { CardRow } from "@/components/cards/CardRow";
import { useCard, useCardActions, useCardList } from "@/components/cards/hooks";
import { Button, Chip, EmptyState, SkeletonRows, VersionChip } from "@/components/ui/primitives";
import { BoardPickerDialog } from "@/components/cards/pickers";
import { CardMenu } from "@/components/cards/CardMenu";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { ApiRequestError } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { CardChips } from "@/components/cards/CardChips";

/** /cards/{number}: P4 on phone; D1 layout with the card selected on desktop. */
export default function CardPage() {
  const params = useParams<{ number: string }>();
  const number = Number(params.number);
  const phone = useIsPhone();
  const mounted = useMounted();
  const card = useCard(number);
  if (!mounted) return null;
  if (card.error instanceof ApiRequestError && card.error.status === 404) {
    return <EmptyState title="That card doesn't exist or was deleted." action={<Link href={phone ? "/review" : "/inbox"} className="text-accent-dark">{phone ? "Go to Review" : "Go to Inbox"}</Link>} />;
  }
  if (phone) return <CardPhone number={number} />;
  return <CardDesktop number={number} />;
}

function CardPhone({ number }: { number: number }) {
  const router = useRouter();
  const a = useCardActions();
  const card = useCard(number);
  const [board, setBoard] = useState(false);
  const c = card.data;
  return (
    <PhonePage id="P4" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.back()}>‹ Review</button>} right={c && <span className="meta flex items-center gap-2">{c.display_number} <VersionChip label={c.current_version_label} /></span>}>
      {!c && <SkeletonRows n={3} />}
      {c && (
        <div className="flex flex-col gap-4 p-4">
          <CardEditor card={c} context={{ type: c.inbox_state === "inbox" ? "inbox" : "review" }} showHeader={false} />
          <div className="meta">· {relativeTime(c.captured_at)}{c.current_version.context ? ` · ${c.current_version.context.slice(0, 60)}` : ""}</div>
          <Button variant="primary" size="lg" full disabled={c.killed_at !== null} onClick={() => a.sendToWorkshop.mutate(c.number)}>Send to workshop</Button>
          <div className="grid grid-cols-[1fr_1fr_48px] gap-2">
            <Button onClick={() => setBoard(true)} disabled={c.killed_at !== null}>To board ▾</Button>
            {c.killed_at ? <Button onClick={() => a.restore.mutate(c.number)}>Restore</Button> : <Button onClick={() => { a.kill.mutate(c.number); router.back(); }}>Kill</Button>}
            <CardMenu card={c} body={c.current_version.body} trigger={<Button aria-label="More actions">⋯</Button>} />
          </div>
          <BoardPickerDialog open={board} onOpenChange={setBoard} onPick={(boardId) => a.sendToBoard.mutate({ n: c.number, boardId })} />
        </div>
      )}
    </PhonePage>
  );
}

function CardDesktop({ number }: { number: number }) {
  const router = useRouter();
  const card = useCard(number);
  const list = useCardList({ view: "all", limit: 30 });
  const items = list.data?.items ?? [];
  const c = card.data;
  return (
    <DesktopPage id="D1" inspector={c ? <CardInspector card={c} /> : undefined} inspectorOpen onCloseInspector={() => router.push("/inbox")}>
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="font-serif text-[18px] font-semibold">All cards</h2>
          <span className="meta">{list.data?.total_estimate ?? 0} cards</span>
          {c && <Chip variant="version">{c.display_number} · {c.current_version_label}</Chip>}
          <div className="flex-1" />
          <Link href="/inbox" className="text-[12px] font-semibold text-accent-dark hover:underline">Back to inbox</Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {c && !items.some((i) => i.number === c.number) && <CardRow card={{ ...c, body_excerpt: c.body }} selected />}
          {items.map((i) => <CardRow key={i.id} card={i} selected={i.number === number} onSelect={() => router.push(`/cards/${i.number}`)} actions={<CardChips card={i} max={0} />} />)}
          {list.isLoading && <SkeletonRows n={6} />}
        </div>
      </div>
    </DesktopPage>
  );
}
