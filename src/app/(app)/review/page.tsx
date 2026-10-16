"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PhonePage } from "@/components/shell/ScreenFrame";
import { FeedCard } from "@/components/cards/FeedCard";
import { useCardActions, useCardCounts } from "@/components/cards/hooks";
import { TagDialog } from "@/components/cards/TagPopover";
import { Button, Chip, EmptyState, InlineBanner, SkeletonRows } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { useShell } from "@/components/shell/AppShell";
import { readLocal, writeLocal } from "@/lib/storage";
import { CARD_FORMS, FORM_LABELS, type CardSummaryDTO, type ThemeDTO } from "@/types/dto";

const CHIPS = [
  { id: "all", label: "All" },
  { id: "inbox", label: "Inbox" },
  { id: "untagged", label: "Untagged" },
  { id: "week", label: "This week" },
  { id: "board", label: "On a board" },
  { id: "jokes", label: "Jokes" },
  { id: "killed", label: "Killed" },
] as const;
type ChipId = (typeof CHIPS)[number]["id"];
const STATUSES = ["raw", "workshopped", "promoted", "tested", "landed"];

/** P3 — Review feed. Desktop widths redirect to /inbox (query preserved). */
export default function ReviewPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (mounted && !phone) router.replace(`/inbox${params.toString() ? `?${params.toString()}` : ""}`);
  }, [mounted, phone, router, params]);
  if (!mounted || !phone) return null;
  return <ReviewPhone />;
}

function ReviewPhone() {
  const params = useSearchParams();
  const router = useRouter();
  const a = useCardActions();
  const setPalette = useShell((s) => s.setPalette);
  const counts = useCardCounts();
  const [tagFor, setTagFor] = useState<CardSummaryDTO | null>(null);
  const [facets, setFacets] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [hintsSeen, setHintsSeen] = useState(true);
  useEffect(() => {
    const n = readLocal<number>("reviewHintsSeen", 0);
    setHintsSeen(n >= 3);
    writeLocal("reviewHintsSeen", n + 1);
  }, []);

  // URL is the source of truth for filters (§18.6).
  const view = (params.get("view") ?? "all") as "all" | "inbox" | "killed";
  const chip: ChipId = view === "inbox" ? "inbox" : view === "killed" ? "killed" : params.get("untagged") === "true" ? "untagged" : params.get("since") === "7d" ? "week" : params.get("on_board") === "true" ? "board" : params.get("kind") === "joke" ? "jokes" : "all";
  const set = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) v === null ? sp.delete(k) : sp.set(k, v);
    router.replace(`/review?${sp.toString()}`);
  };
  const pickChip = (id: ChipId) => {
    const base: Record<string, string | null> = { view: null, untagged: null, since: null, on_board: null, kind: null };
    if (id === "inbox") base.view = "inbox";
    if (id === "killed") base.view = "killed";
    if (id === "untagged") base.untagged = "true";
    if (id === "week") base.since = "7d";
    if (id === "board") base.on_board = "true";
    if (id === "jokes") base.kind = "joke";
    set(base);
  };
  const filters = useMemo(() => {
    const f: Record<string, string> = { limit: "20" };
    for (const k of ["view", "untagged", "since", "on_board", "kind", "form", "status", "subject", "theme", "source", "sort", "q"]) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);

  const list = useInfiniteQuery({
    queryKey: qk.cards(filters),
    queryFn: ({ pageParam }) => api.get<{ items: CardSummaryDTO[]; next_cursor: string | null; total_estimate: number }>(`/cards${qs({ ...filters, cursor: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const facetCount = ["form", "status", "subject", "theme", "source"].filter((k) => params.get(k)).length;
  const countFor = (id: ChipId) => (counts.data ? ({ all: counts.data.all, inbox: counts.data.inbox, untagged: counts.data.untagged, week: counts.data.week, board: counts.data.on_board, jokes: counts.data.jokes, killed: counts.data.killed } as Record<ChipId, number>)[id] : undefined);

  return (
    <PhonePage id="P3" title="Review" right={<><Button size="sm" onClick={() => setSortOpen(true)}>Sort ▾</Button><Button size="sm" aria-label="Search" onClick={() => setPalette(true)}><Search size={18} aria-hidden /></Button></>}>
      <div className="sticky top-[56px] z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-bg px-4 py-2 [scrollbar-width:none]">
        {CHIPS.map((c) => (
          <Chip key={c.id} variant={chip === c.id ? "dark" : "neutral"} pressed={chip === c.id} onClick={() => pickChip(c.id)} className="shrink-0 !px-3">
            {c.label}{countFor(c.id) !== undefined && c.id !== "week" ? ` ${countFor(c.id)}` : ""}
          </Chip>
        ))}
        <Chip variant={facetCount ? "dark" : "dashed"} onClick={() => setFacets(true)} className="shrink-0 !px-3">Facets{facetCount ? ` ${facetCount}` : ""}</Chip>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {list.isLoading && <SkeletonRows n={3} />}
        {list.error && <InlineBanner action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>Couldn&apos;t load your cards.</InlineBanner>}
        {list.data && items.length === 0 && (chip === "all" && !facetCount ? <EmptyState title="Nothing here yet. Capture something funny." action={<Button variant="primary" onClick={() => router.push("/capture")}>Capture</Button>} /> : <EmptyState title="No cards match these filters." action={<Button onClick={() => router.replace("/review")}>Clear filters</Button>} />)}
        {items.map((c) => (
          <FeedCard key={c.id} card={c} href={`/cards/${c.number}`} onKeep={() => (c.inbox_state === "inbox" ? a.keep.mutate(c.number) : setTagFor(c))} onKill={() => (c.killed_at ? a.restore.mutate(c.number) : a.kill.mutate(c.number))} onTag={() => setTagFor(c)} onWorkshop={() => a.sendToWorkshop.mutate(c.number)} />
        ))}
        <div ref={sentinel} />
        {list.hasNextPage && <Button full onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</Button>}
      </div>
      {!hintsSeen && <p className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] bg-surface/95 px-4 py-1.5 text-center text-[12px] text-ink-2">Swipe right to keep and tag. Swipe left to kill. Tap to open.</p>}
      <TagDialog open={!!tagFor} onOpenChange={(o) => !o && setTagFor(null)} value={tagFor?.subjects.map((s) => s.name) ?? []} onSave={(names) => { if (tagFor) a.setSubjects.mutate({ n: tagFor.number, names }); }} />
      <Dialog open={sortOpen} onOpenChange={setSortOpen} title="Sort">
        {[["newest", "Newest"], ["oldest", "Oldest"], ["recently_edited", "Recently edited"], ["title", "A–Z"]].map(([v, l]) => (
          <button key={v} type="button" className="block w-full px-2 py-3 text-left text-[15px]" onClick={() => { set({ sort: v === "newest" ? null : v }); setSortOpen(false); }}>{l}{(params.get("sort") ?? "newest") === v ? " ✓" : ""}</button>
        ))}
      </Dialog>
      <FacetSheet open={facets} onOpenChange={setFacets} params={params} set={set} />
    </PhonePage>
  );
}

function FacetSheet({ open, onOpenChange, params, set }: { open: boolean; onOpenChange: (o: boolean) => void; params: URLSearchParams; set: (n: Record<string, string | null>) => void }) {
  const { data: themes } = useQuery({ queryKey: qk.themes, queryFn: () => api.get<{ items: (ThemeDTO & { count: number })[] }>("/themes"), enabled: open });
  const { data: subjects } = useQuery({ queryKey: qk.subjects("facets"), queryFn: () => api.get<{ items: { id: string; name: string; count: number }[] }>("/subjects?sort=count"), enabled: open });
  const multi = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const toggle = (key: string, v: string) => {
    const cur = multi(key);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    set({ [key]: next.length ? next.join(",") : null });
  };
  const group = (title: string, key: string, options: { v: string; l: string }[]) => (
    <div className="mb-4">
      <div className="label mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => <Chip key={o.v} variant={multi(key).includes(o.v) ? "dark" : "neutral"} pressed={multi(key).includes(o.v)} onClick={() => toggle(key, o.v)} className="!px-3 !py-2">{o.l}</Chip>)}
        {options.length === 0 && <span className="text-[13px] text-ink-2">None yet.</span>}
      </div>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Facets" footer={<><Button onClick={() => set({ form: null, status: null, subject: null, theme: null, source: null })}>Clear</Button><Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button></>}>
      {group("Form", "form", CARD_FORMS.map((f) => ({ v: f, l: FORM_LABELS[f] })))}
      {group("Status", "status", STATUSES.map((s) => ({ v: s, l: s })))}
      {group("Subject", "subject", (subjects?.items ?? []).slice(0, 30).map((s) => ({ v: s.name, l: `${s.name} ${s.count}` })))}
      {group("Theme", "theme", (themes?.items ?? []).map((t) => ({ v: t.id, l: t.name })))}
      {group("Source", "source", [{ v: "phone", l: "Phone" }, { v: "desktop", l: "Desktop" }])}
    </Dialog>
  );
}
