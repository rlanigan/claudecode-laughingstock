"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DesktopPage } from "@/components/shell/ScreenFrame";
import { CardRow } from "@/components/cards/CardRow";
import { CardInspector } from "@/components/cards/CardInspector";
import { useCard, useCardActions, useCardCounts, useCardList } from "@/components/cards/hooks";
import { Button, Chip, EmptyState, InlineBanner, SkeletonRows } from "@/components/ui/primitives";
import { TagDialog } from "@/components/cards/TagPopover";
import { BoardPickerDialog } from "@/components/cards/pickers";
import { Inspector } from "@/components/shell/ScreenFrame";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { useCapture, useSubjectSuggestions } from "@/components/capture/useCapture";
import { CaptureEditor, type CaptureEditorHandle } from "@/components/capture/CaptureEditor";
import { toast } from "@/components/ui/toast";
import type { CardSummaryDTO } from "@/types/dto";

type Filter = "all" | "untagged" | "week" | "phone";

/** D1 — Inbox (desktop). Phone widths redirect to /review?view=inbox. */
export default function InboxPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (mounted && phone) router.replace(`/review?view=inbox${params.toString() ? `&${params.toString()}` : ""}`);
  }, [mounted, phone, router, params]);
  if (!mounted || phone) return null;
  return <InboxDesktop />;
}

function InboxDesktop() {
  const params = useSearchParams();
  const router = useRouter();
  const a = useCardActions();
  const [filter, setFilter] = useState<Filter>(params.get("untagged") === "true" ? "untagged" : params.get("source") === "phone" ? "phone" : params.get("since") ? "week" : "all");
  const filters = { view: "inbox", limit: 30, ...(filter === "untagged" ? { untagged: "true" } : {}), ...(filter === "week" ? { since: "7d" } : {}), ...(filter === "phone" ? { source: "phone" } : {}) } as Record<string, string | number>;
  const list = useCardList(filters);
  const counts = useCardCounts();
  const items = list.data?.items ?? [];
  const selectedParam = params.get("card");
  const [selected, setSelected] = useState<number | null>(selectedParam ? Number(selectedParam) : null);
  const [tagFor, setTagFor] = useState<CardSummaryDTO | null>(null);
  const [boardFor, setBoardFor] = useState<CardSummaryDTO | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastKilled = useRef<number | null>(null);

  useEffect(() => {
    if (selected === null && items.length) setSelected(items[0].number);
    if (selected !== null && items.length && !items.some((c) => c.number === selected) && !selectedParam) setSelected(items[0].number);
  }, [items, selected, selectedParam]);

  const card = useCard(selected);
  const selectedIndex = items.findIndex((c) => c.number === selected);
  const move = (d: number) => {
    const next = items[Math.min(Math.max(selectedIndex + d, 0), items.length - 1)];
    if (next) setSelected(next.number);
  };
  const selectedCard = items[selectedIndex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "j": e.preventDefault(); move(1); break;
        case "k": e.preventDefault(); move(-1); break;
        case "t": if (selectedCard) setTagFor(selectedCard); break;
        case "b": if (selectedCard) setBoardFor(selectedCard); break;
        case "w": if (selectedCard) a.sendToWorkshop.mutate(selectedCard.number); break;
        case "e": e.preventDefault(); bodyRef.current?.focus(); break;
        case "x": if (selectedCard) { lastKilled.current = selectedCard.number; a.kill.mutate(selectedCard.number); move(1); } break;
        case "u": if (lastKilled.current) { a.restore.mutate(lastKilled.current); lastKilled.current = null; } break;
        case "escape": (document.activeElement as HTMLElement | null)?.blur(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIndex, selectedCard]);

  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "untagged", label: "Untagged", count: counts.data?.untagged },
    { id: "week", label: "This week" },
    { id: "phone", label: "From phone", count: counts.data?.phone },
  ];

  const inspector = card.data ? (
    <CardInspector card={card.data} onAfterKill={() => move(1)} />
  ) : (
    <Inspector><p className="text-[13px] text-ink-2">{items.length ? "Select a card to see its details." : "Select a card to see its details."}</p></Inspector>
  );

  return (
    <DesktopPage id="D1" inspector={inspector} inspectorOpen={inspectorOpen && selected !== null} onCloseInspector={() => setInspectorOpen(false)}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 p-5 pb-3">
          <DesktopCaptureBox />
        </div>
        <div className="flex shrink-0 items-center gap-3 px-5 pb-2">
          <h2 className="font-serif text-[18px] font-semibold">Inbox</h2>
          <span className="meta">{counts.data?.inbox ?? list.data?.total_estimate ?? 0} raw cards</span>
          <div className="ml-2 flex gap-1">
            {chips.map((c) => (
              <Chip key={c.id} variant={filter === c.id ? "dark" : "neutral"} pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.label}{c.count !== undefined ? ` ${c.count}` : ""}
              </Chip>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border" role="grid" aria-label="Inbox cards">
          {list.isLoading && <SkeletonRows n={6} />}
          {list.error && <div className="p-4"><InlineBanner action={<Button size="sm" onClick={() => list.refetch()}>Retry</Button>}>Couldn&apos;t load your inbox.</InlineBanner></div>}
          {list.data && items.length === 0 && (
            filter === "all" ? <EmptyState title="Inbox zero. Everything has a home." body="New notes from your phone land here." /> : <EmptyState title="No cards match these filters." action={<Button onClick={() => setFilter("all")}>Clear filters</Button>} />
          )}
          {items.map((c) => (
            <CardRow
              key={c.id}
              card={c}
              selected={c.number === selected}
              onSelect={() => { setSelected(c.number); setInspectorOpen(true); router.replace(`/inbox?card=${c.number}`); }}
              onDoubleClick={() => setTimeout(() => bodyRef.current?.focus(), 50)}
              actions={
                <>
                  <Button size="sm" onClick={() => setTagFor(c)}>Tag</Button>
                  <Button size="sm" onClick={() => setBoardFor(c)}>→ Board</Button>
                  <Button size="sm" onClick={() => { lastKilled.current = c.number; a.kill.mutate(c.number); }}>Kill</Button>
                </>
              }
            />
          ))}
          {list.data?.next_cursor && <div className="p-3 text-center"><Button onClick={() => toast("Scroll filters are limited to 30 here. Use Review on your phone or search for older cards.")}>Load more</Button></div>}
        </div>
      </div>
      <TagDialog open={!!tagFor} onOpenChange={(o) => !o && setTagFor(null)} value={tagFor?.subjects.map((s) => s.name) ?? []} onSave={(names) => { if (tagFor) a.setSubjects.mutate({ n: tagFor.number, names }); }} />
      <BoardPickerDialog open={!!boardFor} onOpenChange={(o) => !o && setBoardFor(null)} onPick={(boardId) => boardFor && a.sendToBoard.mutate({ n: boardFor.number, boardId })} />
    </DesktopPage>
  );
}

/** The accent-bordered capture box at the top of D1. Enter saves, Shift+Enter newline. */
export function DesktopCaptureBox() {
  const { draft, setDraft, canSave, save } = useCapture({ source: "desktop" });
  const suggestions = useSubjectSuggestions(draft.text);
  const editor = useRef<CaptureEditorHandle>(null);
  const submit = async () => {
    if (!canSave) return;
    if (await save()) toast("Saved to inbox");
  };
  return (
    <div>
      <CaptureEditor ref={editor} value={draft.text} onChange={(text) => setDraft({ text })} onSubmit={submit} minHeight={72} size="desktop" submitOnEnter />
      <div className="mt-2 flex items-center gap-2">
        <span className="label">Suggested</span>
        <div className="flex flex-wrap gap-1">
          {suggestions.filter((s) => !draft.tags.includes(s)).map((s) => (
            <Chip key={s} variant="dashed" onClick={() => setDraft({ tags: [...draft.tags, s] })}>+ {s}</Chip>
          ))}
          {draft.tags.map((t) => (
            <Chip key={t} variant="dark" onClick={() => setDraft({ tags: draft.tags.filter((x) => x !== t) })} title="Remove">{t} ×</Chip>
          ))}
          {suggestions.length === 0 && draft.tags.length === 0 && <span className="meta">tags appear as you type</span>}
        </div>
        <div className="flex-1" />
        <span className="meta">Enter to save · Shift+Enter for a line break</span>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={submit}>Add card</Button>
      </div>
      <p className="meta mt-1.5">Also lands here: phone captures and voice notes. Never asks for a tag first.</p>
    </div>
  );
}
