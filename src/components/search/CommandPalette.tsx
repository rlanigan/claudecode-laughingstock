"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as RD from "@radix-ui/react-dialog";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { useDebounced, useIsPhone } from "@/lib/hooks";
import { useShell } from "@/components/shell/AppShell";
import { readLocal, writeLocal } from "@/lib/storage";
import type { SearchResultDTO } from "@/types/dto";
import { Chip, cx } from "@/components/ui/primitives";

interface Row {
  group: string;
  label: string;
  html?: string;
  href?: string;
  run?: () => void;
  chip?: string;
}

/** M1 — Command palette (⌘K). */
export function CommandPalette() {
  const open = useShell((s) => s.paletteOpen);
  const setOpen = useShell((s) => s.setPalette);
  const setCapture = useShell((s) => s.setCapture);
  const router = useRouter();
  const phone = useIsPhone();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 150);
  const isCommand = q.startsWith(">");

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
    }
  }, [open]);

  const { data } = useQuery({
    queryKey: qk.search(dq, "all"),
    queryFn: ({ signal }) => api.get<{ groups: SearchResultDTO }>(`/search${qs({ q: dq, limit: 8 })}`, { signal }),
    enabled: open && !isCommand && dq.trim().length > 0,
  });

  const rows = useMemo<Row[]>(() => {
    if (isCommand) {
      const term = q.slice(1).trim().toLowerCase();
      const cmds: Row[] = [
        { group: "Commands", label: "New capture", run: () => setCapture(true) },
        { group: "Commands", label: "New board", href: "/boards?new=1" },
        { group: "Commands", label: "New bit", href: "/sets?newBit=1" },
        { group: "Commands", label: "New set", href: "/sets?new=1" },
        { group: "Commands", label: "New session", href: "/workshop?new=1" },
        { group: "Commands", label: "Go to Inbox", href: "/inbox" },
        { group: "Commands", label: "Go to Boards", href: "/boards" },
        { group: "Commands", label: "Go to Workshop", href: "/workshop" },
        { group: "Commands", label: "Go to Sets", href: "/sets" },
        { group: "Commands", label: "Go to Tags & themes", href: "/tags" },
        { group: "Commands", label: "Go to Killed", href: "/killed" },
        { group: "Commands", label: "Go to Settings", href: "/settings" },
      ];
      return cmds.filter((c) => c.label.toLowerCase().includes(term));
    }
    if (!dq.trim()) {
      return readLocal<string[]>("recentSearches", []).map((s) => ({ group: "Recent", label: s, run: () => setQ(s) }));
    }
    const g = data?.groups;
    if (!g) return [];
    const out: Row[] = [];
    g.cards.forEach((c) => out.push({ group: "Cards", label: `${c.display_title}`, html: c.snippet_html, href: `/cards/${c.number}`, chip: c.killed ? "killed" : undefined }));
    g.bits.forEach((b) => out.push({ group: "Bits", label: b.name, href: `/bits/${b.id}` }));
    g.sets.forEach((s) => out.push({ group: "Sets", label: s.name, href: `/sets/${s.id}` }));
    g.boards.forEach((b) => out.push({ group: "Boards", label: b.name, href: `/boards/${b.id}` }));
    g.subjects.forEach((s) => out.push({ group: "Subjects", label: s.name, href: `/review?subject=${encodeURIComponent(s.name)}`, chip: `${s.count}` }));
    g.themes.forEach((t) => out.push({ group: "Themes", label: t.name, href: `/review?theme=${t.id}`, chip: `${t.count}` }));
    return out;
  }, [data, dq, isCommand, q, setCapture]);

  const go = (row: Row) => {
    if (dq.trim() && !isCommand) {
      const recent = [dq.trim(), ...readLocal<string[]>("recentSearches", []).filter((s) => s !== dq.trim())].slice(0, 10);
      writeLocal("recentSearches", recent);
    }
    setOpen(false);
    if (row.run) row.run();
    if (row.href) router.push(row.href);
  };
  const seeAll = () => {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[rgba(31,29,26,0.35)]" />
        <RD.Content className={cx("fixed z-50 flex flex-col overflow-hidden bg-surface shadow-dialog focus:outline-none", phone ? "inset-0" : "left-1/2 top-[12vh] w-[600px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] border border-border")} onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}>
          <RD.Title className="sr-only">Search</RD.Title>
          <RD.Description className="sr-only">Search cards, bits, sets, boards, subjects and themes. Start with &gt; for commands.</RD.Description>
          <div className="flex items-center gap-2 border-b border-border px-3">
            {process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS === "true" && <span className="meta">M1</span>}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setIndex(0); }}
              placeholder="Search cards, bits, sets, tags…  (> for commands)"
              className="h-[48px] flex-1 bg-transparent text-[15px] outline-none md:text-[14px]"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, rows.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (e.metaKey || e.ctrlKey) seeAll(); else if (rows[index]) go(rows[index]); else if (q.trim()) seeAll(); }
                else if (e.key === "Escape") setOpen(false);
              }}
            />
            {phone && <button type="button" className="text-[13px] text-accent-dark" onClick={() => setOpen(false)}>Cancel</button>}
          </div>
          <ul id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-1 md:max-h-[420px]">
            {rows.length === 0 && q.trim() && !isCommand && <li className="px-4 py-6 text-center text-[13px] text-ink-2">Nothing matches &lsquo;{q}&rsquo;.</li>}
            {rows.length === 0 && !q.trim() && <li className="px-4 py-6 text-center text-[13px] text-ink-2">Type to search. Start with &gt; for commands.</li>}
            {rows.map((r, i) => {
              const first = i === 0 || rows[i - 1].group !== r.group;
              return (
                <li key={`${r.group}-${r.label}-${i}`} role="option" aria-selected={i === index}>
                  {first && <div className="label px-4 pb-1 pt-2">{r.group}</div>}
                  <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => go(r)} className={cx("flex w-full items-center gap-2 px-4 py-2 text-left text-[13px]", i === index && "bg-tab-active")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.label}</span>
                      {r.html && <span className="block truncate text-[12px] text-ink-2" dangerouslySetInnerHTML={{ __html: r.html }} />}
                    </span>
                    {r.chip && <Chip variant={r.chip === "killed" ? "danger" : "neutral"}>{r.chip}</Chip>}
                  </button>
                </li>
              );
            })}
          </ul>
          {q.trim() && !isCommand && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-ink-2">
              <span>↑↓ navigate · Enter opens</span>
              <button type="button" className="font-semibold text-accent-dark hover:underline" onClick={seeAll}>See all results</button>
            </div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
