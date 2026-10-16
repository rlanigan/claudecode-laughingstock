"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Button, TextInput, cx } from "@/components/ui/primitives";
import { api, qs } from "@/lib/api-client";
import type { CardSummaryDTO } from "@/types/dto";
import { displayNumber } from "@/lib/format";

/** M12 — Split card: click between words to place the split marker. */
export function SplitDialog({ open, onOpenChange, body, onSplit }: { open: boolean; onOpenChange: (o: boolean) => void; body: string; onSplit: (offset: number) => Promise<void> | void }) {
  const tokens = useMemo(() => body.split(/(\s+)/), [body]);
  const [at, setAt] = useState<number>(0);
  useEffect(() => {
    if (open) setAt(Math.floor(body.length / 2));
  }, [open, body.length]);
  const a = body.slice(0, at).trim();
  const b = body.slice(at).trim();
  let offset = 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Split into two cards" description="Click between words to place the split. The original card stays as it is." screenId="M12" width={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!a || !b} onClick={async () => { await onSplit(at); onOpenChange(false); }}>Split</Button>
        </>
      }
    >
      <p className="rounded-md border border-border bg-card p-3 text-[14px] leading-[1.6]">
        {tokens.map((tok, i) => {
          const start = offset;
          offset += tok.length;
          if (/^\s+$/.test(tok)) {
            const here = start;
            return (
              <button key={i} type="button" aria-label="Split here" onClick={() => setAt(here)} className={cx("mx-[1px] inline-block h-[1.1em] w-[6px] cursor-col-resize rounded-sm align-middle", at === here ? "bg-accent" : "bg-transparent hover:bg-accent-tint")} />
            );
          }
          return <span key={i}>{tok}</span>;
        })}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-md border border-border bg-surface p-2"><span className="label mb-1 block">Card A</span>{a || <span className="text-danger-text">Both cards need some text.</span>}</div>
        <div className="rounded-md border border-border bg-surface p-2"><span className="label mb-1 block">Card B</span>{b || <span className="text-danger-text">Both cards need some text.</span>}</div>
      </div>
    </Dialog>
  );
}

/** M13 — Combine cards: pick other cards (search), order them, create a combined card. */
export function CombineDialog({ open, onOpenChange, seed, onCombine, candidates }: { open: boolean; onOpenChange: (o: boolean) => void; seed: CardSummaryDTO; onCombine: (numbers: number[]) => Promise<void> | void; candidates?: CardSummaryDTO[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<CardSummaryDTO[]>([seed]);
  useEffect(() => {
    if (open) setPicked([seed]);
  }, [open, seed]);
  const { data } = useQuery({ queryKey: ["cards", "combine-search", q], queryFn: () => api.get<{ items: CardSummaryDTO[] }>(`/cards${qs({ q, limit: 10 })}`), enabled: open && q.trim().length > 1 });
  const pool = (q.trim().length > 1 ? data?.items : candidates) ?? [];
  const move = (i: number, d: -1 | 1) => setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Combine cards" description="The original cards stay as they are." screenId="M13" width={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={picked.length < 2} onClick={async () => { await onCombine(picked.map((c) => c.number)); onOpenChange(false); }}>Create combined card</Button>
        </>
      }
    >
      <div className="label mb-1">Order</div>
      <ol className="mb-3 divide-y divide-divider rounded-md border border-border bg-card">
        {picked.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
            <span className="meta w-5">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{c.display_title}</span>
            <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="text-ink-2">↑</button>
            <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="text-ink-2">↓</button>
            {c.id !== seed.id && <button type="button" aria-label="Remove" onClick={() => setPicked((p) => p.filter((x) => x.id !== c.id))} className="text-ink-2">✕</button>}
          </li>
        ))}
      </ol>
      <TextInput placeholder="Search cards to add…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
      <ul className="mt-2 max-h-[200px] divide-y divide-divider overflow-y-auto rounded-md border border-border bg-card">
        {pool.filter((c) => !picked.some((p) => p.id === c.id)).map((c) => (
          <li key={c.id}>
            <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-surface" onClick={() => setPicked((p) => [...p, c])}>
              <span className="meta">{displayNumber(c.number)}</span>
              <span className="truncate">{c.display_title}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="label mb-1 mt-3">Preview</div>
      <p className="whitespace-pre-wrap rounded-md border border-border bg-surface p-2 text-[12px] text-ink-body">{picked.map((c) => (c.title ? `${c.title}\n${c.body}` : c.body)).join("\n\n")}</p>
    </Dialog>
  );
}
