"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/hooks";
import { readLocal } from "@/lib/storage";
import { cx, KeyHint } from "@/components/ui/primitives";
import { useShell } from "./AppShell";
import { modKey } from "@/lib/format";

const TABS = [
  { id: "inbox", label: "Inbox", href: () => "/inbox", match: (p: string) => p.startsWith("/inbox") || p.startsWith("/cards") || p.startsWith("/review") },
  { id: "board", label: "Board", href: () => (readLocal<string | null>("lastBoardId", null) ? `/boards/${readLocal("lastBoardId", "")}` : "/boards"), match: (p: string) => p.startsWith("/boards") },
  { id: "workshop", label: "Workshop", href: () => "/workshop", match: (p: string) => p.startsWith("/workshop") },
  { id: "sets", label: "Sets", href: () => (readLocal<string | null>("lastSetId", null) ? `/sets/${readLocal("lastSetId", "")}` : "/sets"), match: (p: string) => p.startsWith("/sets") || p.startsWith("/bits") || p.startsWith("/performances") },
];

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const setPalette = useShell((s) => s.setPalette);
  const setCapture = useShell((s) => s.setCapture);
  const inbox = me?.counts.inbox ?? 0;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <div id="screen-id-slot" className="flex min-w-[28px] items-center" />
        <Link href="/inbox" className="font-serif text-[20px] font-semibold leading-none text-ink">
          Cards
        </Link>
        <nav aria-label="Rooms" className="ml-6 flex items-center gap-1">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link key={t.id} href={t.href()} className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px]", active ? "bg-tab-active font-semibold" : "hover:bg-tab-active/60")} aria-current={active ? "page" : undefined}>
                {t.label}
                {t.id === "inbox" && inbox > 0 && <span className="rounded-full bg-accent px-1.5 py-[1px] font-mono text-[10px] font-semibold leading-none text-white">{inbox}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <button type="button" onClick={() => setPalette(true)} className="flex w-[270px] items-center justify-between rounded-md border border-border bg-field px-2.5 py-1.5 text-left text-[12px] text-ink-2 hover:border-border-strong">
          <span>Search cards, tags, drafts</span>
          <KeyHint>{modKey()}K</KeyHint>
        </button>
        <button type="button" onClick={() => setCapture(true)} className="flex items-center gap-2 rounded-md border border-accent-border bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover">
          + Capture <span className="rounded border border-white/40 px-1 font-mono text-[10px] font-normal">{modKey()}N</span>
        </button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
