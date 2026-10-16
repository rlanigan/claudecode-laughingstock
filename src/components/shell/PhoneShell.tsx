"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PenLine, Layers, GitBranch, ListMusic } from "lucide-react";
import { cx } from "@/components/ui/primitives";
import { readLocal } from "@/lib/storage";

const TABS = [
  { id: "capture", label: "Capture", Icon: PenLine, href: () => "/capture", match: (p: string) => p.startsWith("/capture") },
  { id: "review", label: "Review", Icon: Layers, href: () => "/review", match: (p: string) => p.startsWith("/review") || p.startsWith("/cards") || p.startsWith("/inbox") || p.startsWith("/boards") || p.startsWith("/killed") || p.startsWith("/tags") || p.startsWith("/search") || p.startsWith("/settings") },
  { id: "workshop", label: "Workshop", Icon: GitBranch, href: () => "/workshop", match: (p: string) => p.startsWith("/workshop") },
  { id: "sets", label: "Sets", Icon: ListMusic, href: () => (readLocal<string | null>("lastSetId", null) ? `/sets/${readLocal("lastSetId", "")}?mode=script` : "/sets"), match: (p: string) => p.startsWith("/sets") || p.startsWith("/bits") || p.startsWith("/performances") },
];

export function PhoneShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <div className="flex min-h-0 flex-1 flex-col pb-[calc(64px+env(safe-area-inset-bottom))]">{children}</div>
      <nav aria-label="Tabs" className="bottom-tabs fixed inset-x-0 bottom-0 z-40 flex h-[calc(64px+env(safe-area-inset-bottom))] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link key={t.id} href={t.href()} aria-current={active ? "page" : undefined} className={cx("flex flex-1 flex-col items-center justify-center gap-1 text-[11px]", active ? "font-semibold text-accent" : "text-ink-2")}>
              <t.Icon size={22} strokeWidth={1.75} aria-hidden />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
