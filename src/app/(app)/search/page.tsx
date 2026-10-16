"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Chip, EmptyState, SkeletonRows, TextInput, cx } from "@/components/ui/primitives";
import { useDebounced, useIsPhone, useMounted } from "@/lib/hooks";
import { readLocal } from "@/lib/storage";
import type { SearchResultDTO } from "@/types/dto";

const TYPES = ["all", "cards", "bits", "sets", "boards", "subjects", "themes"] as const;
type T = (typeof TYPES)[number];

/** S4 — Search results. */
export default function SearchPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const type = (sp.get("type") ?? "all") as T;
  const includeVersions = sp.get("include_versions") === "true";
  const includeKilled = sp.get("include_killed") === "true";
  const dq = useDebounced(q, 200);
  useEffect(() => {
    const cur = new URLSearchParams(sp.toString());
    if ((cur.get("q") ?? "") !== dq) {
      cur.set("q", dq);
      router.replace(`/search?${cur.toString()}`);
    }
  }, [dq, router, sp]);
  const set = (k: string, v: string | null) => {
    const cur = new URLSearchParams(sp.toString());
    v === null ? cur.delete(k) : cur.set(k, v);
    router.replace(`/search?${cur.toString()}`);
  };
  const { data, isLoading } = useQuery({
    queryKey: [...qk.search(dq, type), includeVersions, includeKilled],
    queryFn: () => api.get<{ groups: SearchResultDTO }>(`/search${qs({ q: dq, type, include_versions: includeVersions, include_killed: includeKilled, limit: 30 })}`),
    enabled: dq.trim().length > 0,
  });
  if (!mounted) return null;
  const g = data?.groups;
  const total = g ? g.cards.length + g.bits.length + g.sets.length + g.boards.length + g.subjects.length + g.themes.length : 0;
  const recent = readLocal<string[]>("recentSearches", []);
  const body = (
    <div className="mx-auto max-w-[720px] p-4 md:p-5">
      <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards, bits, sets, boards, tags…" aria-label="Search" className="text-[15px]" />
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {TYPES.map((t) => <Chip key={t} variant={type === t ? "dark" : "neutral"} pressed={type === t} onClick={() => set("type", t === "all" ? null : t)} className="capitalize">{t}</Chip>)}
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={includeVersions} onChange={(e) => set("include_versions", e.target.checked ? "true" : null)} /> Include old versions</label>
        <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={includeKilled} onChange={(e) => set("include_killed", e.target.checked ? "true" : null)} /> Include killed</label>
      </div>
      {!dq.trim() && (
        <div className="mt-6">
          <div className="label mb-2">Recent searches</div>
          {recent.length === 0 && <p className="text-[13px] text-ink-2">No searches yet.</p>}
          <div className="flex flex-wrap gap-1.5">{recent.map((r) => <Chip key={r} onClick={() => setQ(r)}>{r}</Chip>)}</div>
        </div>
      )}
      {dq.trim() && isLoading && <SkeletonRows n={4} />}
      {g && total === 0 && <EmptyState title={`Nothing matches '${dq}'.`} />}
      {g && (
        <div className="mt-4 flex flex-col gap-5">
          <Group title="Cards" show={g.cards.length > 0}>
            {g.cards.map((c) => (
              <Row key={c.number} href={`/cards/${c.number}`} icon="▢" title={c.display_title} html={c.snippet_html} meta={`#${String(c.number).padStart(4, "0")} · ${c.matched_in.replace("_", " ")}`} chip={c.killed ? "killed" : c.status !== "raw" ? c.status : undefined} />
            ))}
          </Group>
          <Group title="Bits" show={g.bits.length > 0}>{g.bits.map((b) => <Row key={b.id} href={`/bits/${b.id}`} icon="≡" title={b.name} html={b.snippet_html} />)}</Group>
          <Group title="Sets" show={g.sets.length > 0}>{g.sets.map((s) => <Row key={s.id} href={`/sets/${s.id}`} icon="♪" title={s.name} html={s.snippet_html} />)}</Group>
          <Group title="Boards" show={g.boards.length > 0}>{g.boards.map((b) => <Row key={b.id} href={`/boards/${b.id}`} icon="▦" title={b.name} html={b.snippet_html} />)}</Group>
          <Group title="Subjects" show={g.subjects.length > 0}>{g.subjects.map((s) => <Row key={s.id} href={`/review?subject=${encodeURIComponent(s.name)}`} icon="#" title={s.name} meta={`${s.count} cards`} />)}</Group>
          <Group title="Themes" show={g.themes.length > 0}>{g.themes.map((t) => <Row key={t.id} href={`/review?theme=${t.id}`} icon="◇" title={t.name} meta={`${t.count} cards`} />)}</Group>
        </div>
      )}
    </div>
  );
  if (phone) return <PhonePage id="S4" title="Search">{body}</PhonePage>;
  return <DesktopPage id="S4"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}

function Group({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section>
      <div className="label mb-1.5">{title}</div>
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">{children}</ul>
    </section>
  );
}

function Row({ href, icon, title, html, meta, chip }: { href: string; icon: string; title: string; html?: string; meta?: string; chip?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface">
        <span className="mt-0.5 w-4 text-center font-mono text-[12px] text-ink-2" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{title}</span>
          {html && <span className="block text-[12px] text-ink-2" dangerouslySetInnerHTML={{ __html: html }} />}
          {meta && <span className="meta">{meta}</span>}
        </span>
        {chip && <Chip variant={chip === "killed" ? "danger" : chip === "landed" ? "success" : "status"} className={cx("shrink-0")}>{chip}</Chip>}
      </Link>
    </li>
  );
}
