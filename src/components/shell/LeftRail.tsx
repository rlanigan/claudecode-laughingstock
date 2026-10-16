"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { useMe } from "@/lib/hooks";
import { cx, Chip } from "@/components/ui/primitives";
import { formatMmSs } from "@/lib/format";
import type { BitSummaryDTO, BoardSummaryDTO, SetSummaryDTO } from "@/types/dto";

export function RailSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-2">
      <div className="label mb-1.5 mt-3.5 flex items-center justify-between">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RailItem({ href, active, children, count, onClick }: { href?: string; active?: boolean; children: React.ReactNode; count?: React.ReactNode; onClick?: () => void }) {
  const cls = cx("flex w-full items-center justify-between gap-2 rounded-[5px] px-2 py-[5px] text-[13px] text-left", active ? "bg-tab-active font-semibold" : "hover:bg-tab-active/60");
  const inner = (
    <>
      <span className="truncate">{children}</span>
      {count !== undefined && <span className="meta shrink-0">{count}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

export function useRailData() {
  const boards = useQuery({ queryKey: qk.boards, queryFn: () => api.get<{ items: BoardSummaryDTO[] }>("/boards") });
  const bits = useQuery({ queryKey: qk.bits, queryFn: () => api.get<{ items: BitSummaryDTO[] }>("/bits") });
  const sets = useQuery({ queryKey: qk.sets, queryFn: () => api.get<{ items: SetSummaryDTO[] }>("/sets") });
  const tags = useQuery({ queryKey: qk.subjectsTop, queryFn: () => api.get<{ top: { id: string; name: string; count: number }[]; more: number }>("/subjects/top") });
  return { boards: boards.data?.items ?? [], bits: bits.data?.items ?? [], sets: sets.data?.items ?? [], tags: tags.data };
}

/** The standard desktop left rail (§4.0.1). Screens can prepend their own sections. */
export function LeftRail({ children, hideStandard }: { children?: React.ReactNode; hideStandard?: boolean }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const { boards, bits, sets, tags } = useRailData();
  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-border bg-rail px-3 pb-3" aria-label="Navigation">
      <div className="flex-1">
        {children}
        {!hideStandard && (
          <>
            <RailSection title="Capture">
              <RailItem href="/inbox" active={pathname === "/inbox"} count={me?.counts.inbox ?? ""}>
                Inbox
              </RailItem>
            </RailSection>
            <RailSection title="Boards" action={<Link href="/boards" className="text-[10px] normal-case tracking-normal text-accent-dark hover:underline">+ New board</Link>}>
              {boards.map((b) => (
                <RailItem key={b.id} href={`/boards/${b.id}`} active={pathname === `/boards/${b.id}`} count={b.card_count}>
                  {b.name}
                </RailItem>
              ))}
              {boards.length === 0 && <p className="px-2 text-[12px] text-ink-2">No boards yet.</p>}
            </RailSection>
            <RailSection title="Bits" action={<Link href="/sets#bits" className="text-[10px] normal-case tracking-normal text-accent-dark hover:underline">+ New bit</Link>}>
              {bits.slice(0, 8).map((b) => (
                <RailItem key={b.id} href={`/bits/${b.id}`} active={pathname === `/bits/${b.id}`} count={formatMmSs(b.duration_seconds)}>
                  {b.name}
                </RailItem>
              ))}
              {bits.length > 8 && <RailItem href="/sets#bits">+ {bits.length - 8} more</RailItem>}
              {bits.length === 0 && <p className="px-2 text-[12px] text-ink-2">No bits yet.</p>}
            </RailSection>
            <RailSection title="Sets" action={<Link href="/sets" className="text-[10px] normal-case tracking-normal text-accent-dark hover:underline">+ New set</Link>}>
              {sets.map((s) => (
                <RailItem key={s.id} href={`/sets/${s.id}`} active={pathname.startsWith(`/sets/${s.id}`)} count={s.current_anchor ? `v${s.current_anchor.number}` : "—"}>
                  {s.name}
                </RailItem>
              ))}
              {sets.length === 0 && <p className="px-2 text-[12px] text-ink-2">No sets yet.</p>}
            </RailSection>
            <RailSection title="Tags">
              <div className="flex flex-wrap gap-1 px-1">
                {tags?.top.map((t) => (
                  <Link key={t.id} href={`/review?subject=${encodeURIComponent(t.name)}`}>
                    <Chip>{t.name}</Chip>
                  </Link>
                ))}
                {tags && tags.more > 0 && (
                  <Link href="/tags">
                    <Chip variant="dashed">+ {tags.more}</Chip>
                  </Link>
                )}
                {tags && tags.top.length === 0 && <span className="px-1 text-[12px] text-ink-2">No tags yet.</span>}
              </div>
            </RailSection>
          </>
        )}
      </div>
      <div className="mt-2 border-t border-divider pt-2">
        <RailItem href="/performances" active={pathname === "/performances"} count={me?.counts.performances ?? ""}>
          Performed log
        </RailItem>
        <RailItem href="/killed" active={pathname === "/killed"} count={me?.counts.killed ?? ""}>
          Killed
        </RailItem>
        <RailItem href="/settings" active={pathname === "/settings"}>
          Settings
        </RailItem>
      </div>
    </aside>
  );
}
