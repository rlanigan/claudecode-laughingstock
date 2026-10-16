"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Chip, SectionLabel, TextArea, Button, VersionChip, cx } from "@/components/ui/primitives";
import { Inspector, InspectorSection } from "@/components/shell/ScreenFrame";
import { CARD_FORMS, FORM_LABELS, type CardDTO, type CardForm, type PartDTO, type PartKind } from "@/types/dto";
import { joinTitle, splitTitle } from "@/domain/title-split";
import { shortDateTime } from "@/lib/format";
import { useCardActions } from "./hooks";
import { PartsList } from "./PartsList";
import { TagDialog } from "./TagPopover";
import { ThemePickerDialog, BoardPickerDialog } from "./pickers";
import { CardMenu } from "./CardMenu";
import { useSubjectSuggestions } from "@/components/capture/useCapture";
import { Dialog } from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";

type Ctx = { type: "inbox" | "review" | "board" | "bit" | "set" | "lineage"; id?: string | null };

/**
 * Shared card editor used by the D1 inspector and P4. Edits apply on blur or after 800 ms idle.
 * Versioning context is passed by the caller (review by default).
 */
export function CardEditor({ card, context = { type: "review", id: null }, versionLabel, compact, showHeader = true, bodyRef }: { card: CardDTO; context?: Ctx; versionLabel?: string; compact?: boolean; showHeader?: boolean; bodyRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const a = useCardActions();
  const [text, setText] = useState(joinTitle(card.current_version.title, card.current_version.body));
  const [ctx, setCtx] = useState(card.current_version.context ?? "");
  const [details, setDetails] = useState(card.current_version.details ?? "");
  const [tagOpen, setTagOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [conflict, setConflict] = useState<CardDTO | null>(null);
  const suggestions = useSubjectSuggestions(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef({ text, ctx, details });

  useEffect(() => {
    const next = { text: joinTitle(card.current_version.title, card.current_version.body), ctx: card.current_version.context ?? "", details: card.current_version.details ?? "" };
    if (next.text !== lastSaved.current.text || next.ctx !== lastSaved.current.ctx || next.details !== lastSaved.current.details) {
      setText(next.text);
      setCtx(next.ctx);
      setDetails(next.details);
      lastSaved.current = next;
    }
  }, [card.current_version.title, card.current_version.body, card.current_version.context, card.current_version.details, card.rev]);

  const commit = async () => {
    const { title, body } = splitTitle(text);
    if (!`${title ?? ""}${body}`.trim()) return;
    if (text === lastSaved.current.text && ctx === lastSaved.current.ctx && details === lastSaved.current.details) return;
    const snapshot = { text, ctx, details };
    try {
      await a.edit.mutateAsync({ n: card.number, input: { rev: card.rev, context: { type: context.type, id: context.id ?? null }, version_label: versionLabel, title, body, context_text: ctx || null, details: details || null } });
      lastSaved.current = snapshot;
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "CONFLICT") setConflict((e.details as { current: CardDTO })?.current ?? null);
      else toast(e instanceof Error ? e.message : "Couldn't save. Retry");
    }
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 800);
  };
  const onForm = (form: CardForm | null) => a.edit.mutate({ n: card.number, input: { rev: card.rev, context: { type: "review", id: null }, form } });

  const chipRow = (
    <div className="flex flex-wrap gap-1">
      {card.subjects.map((s) => <Chip key={s.id}>{s.name}</Chip>)}
      <Chip variant="dashed" onClick={() => setTagOpen(true)}>+ add</Chip>
    </div>
  );

  return (
    <div className={cx("flex flex-col gap-3.5", compact && "gap-3")}>
      {showHeader && (
        <div className="flex items-center justify-between">
          <span className="label">Card</span>
          <span className="meta flex items-center gap-2">{card.display_number} <VersionChip label={card.current_version_label} /></span>
        </div>
      )}
      <TextArea
        ref={bodyRef}
        aria-label="Title and text"
        value={text}
        onChange={(e) => { setText(e.target.value); schedule(); }}
        onBlur={commit}
        className={cx("min-h-[120px] text-[15px] leading-[1.5] md:text-[14px]", compact && "min-h-[90px]")}
        maxLength={20201}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <SectionLabel htmlFor={`form-${card.id}`}>Form</SectionLabel>
          <select id={`form-${card.id}`} className="field mt-1 text-[13px]" value={card.form ?? ""} onChange={(e) => onForm((e.target.value || null) as CardForm | null)}>
            <option value="">None</option>
            {CARD_FORMS.map((f) => <option key={f} value={f}>{FORM_LABELS[f]}{card.form === f && card.form_inferred ? " (auto)" : ""}</option>)}
          </select>
        </div>
        <div>
          <SectionLabel>Status</SectionLabel>
          <div className="mt-1 flex min-h-[32px] items-center gap-1 text-[13px]" title="Set automatically as the card moves">
            <Chip variant={card.status === "landed" ? "success" : card.status === "killed" ? "danger" : "status"}>{card.status}</Chip>
            <span className="meta" aria-hidden>ⓘ</span>
          </div>
        </div>
      </div>
      <InspectorSection title="Tags">{chipRow}</InspectorSection>
      <InspectorSection title="Themes">
        <div className="flex flex-wrap gap-1">
          {card.themes.map((t) => <Chip key={t.id} variant="theme">{t.name}</Chip>)}
          <Chip variant="dashed" onClick={() => setThemeOpen(true)}>+ add</Chip>
        </div>
      </InspectorSection>
      <details open={!!(ctx || details)} className="group">
        <summary className="label cursor-pointer list-none">Context &amp; details <span className="font-sans normal-case tracking-normal text-ink-2 group-open:hidden">(expand)</span></summary>
        <div className="mt-2 flex flex-col gap-2">
          <TextArea aria-label="Context" placeholder="Context · where, when, who" value={ctx} onChange={(e) => { setCtx(e.target.value); schedule(); }} onBlur={commit} className="min-h-[56px] text-[13px]" maxLength={5000} />
          <TextArea aria-label="Other details" placeholder="Other details" value={details} onChange={(e) => { setDetails(e.target.value); schedule(); }} onBlur={commit} className="min-h-[56px] text-[13px]" maxLength={5000} />
        </div>
      </details>
      <InspectorSection title="Parts">
        <PartsList
          parts={card.parts}
          onAdd={async (kind: PartKind, body: string) => { await a.addPart.mutateAsync({ n: card.number, kind, body }); }}
          onEdit={(p: PartDTO, body) => a.patchPart.mutate({ id: p.id, body, n: card.number })}
          onDelete={(p) => a.deletePart.mutate({ id: p.id, n: card.number, part: p })}
          onReorder={(ids) => a.reorderParts.mutate({ n: card.number, ids })}
        />
      </InspectorSection>
      <LineageCard card={card} />
      <TagDialog open={tagOpen} onOpenChange={setTagOpen} value={card.subjects.map((s) => s.name)} suggestions={suggestions} onSave={(names) => a.setSubjects.mutate({ n: card.number, names })} />
      <ThemePickerDialog open={themeOpen} onOpenChange={setThemeOpen} selected={card.themes} cardNumber={card.number} onSave={(ids) => a.setThemes.mutate({ n: card.number, ids })} />
      <ConflictDialog current={conflict} mine={text} onClose={() => setConflict(null)} onKeepMine={async () => { if (!conflict) return; const { title, body } = splitTitle(text); await a.edit.mutateAsync({ n: card.number, input: { rev: conflict.rev, context: { type: "review", id: null }, title, body, save_as_new_version: true } }); setConflict(null); }} onUseTheirs={() => { if (conflict) { setText(joinTitle(conflict.current_version.title, conflict.current_version.body)); lastSaved.current = { ...lastSaved.current, text: joinTitle(conflict.current_version.title, conflict.current_version.body) }; } setConflict(null); }} cardNumber={card.number} />
    </div>
  );
}

/** M11 — version conflict. */
function ConflictDialog({ current, mine, onClose, onKeepMine, onUseTheirs, cardNumber }: { current: CardDTO | null; mine: string; onClose: () => void; onKeepMine: () => void; onUseTheirs: () => void; cardNumber: number }) {
  return (
    <Dialog open={!!current} onOpenChange={(o) => !o && onClose()} title="This card changed on another device." screenId="M11" width={520}
      footer={
        <>
          <Link href={`/cards/${cardNumber}/lineage`} className="mr-auto text-[13px] font-semibold text-accent-dark">Compare</Link>
          <Button onClick={onUseTheirs}>Use theirs</Button>
          <Button variant="primary" onClick={onKeepMine}>Keep mine as a new version</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div><div className="label mb-1">Mine</div><p className="whitespace-pre-wrap rounded-md border border-border bg-card p-2 text-[13px]">{mine}</p></div>
        <div><div className="label mb-1">Theirs</div><p className="whitespace-pre-wrap rounded-md border border-border bg-card p-2 text-[13px]">{current ? joinTitle(current.current_version.title, current.current_version.body) : ""}</p></div>
      </div>
    </Dialog>
  );
}

export function LineageCard({ card }: { card: CardDTO }) {
  const v = card.current_version;
  const places = card.placements.boards.length + card.placements.bits.length + card.placements.sets.length + (card.placements.workshop ? 1 : 0);
  return (
    <div className="rounded-md border border-border bg-card p-3 text-[12px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">Lineage</span>
        <Link href={`/cards/${card.number}/lineage`} className="font-semibold text-accent-dark hover:underline">Open full lineage →</Link>
      </div>
      <div className="flex items-center gap-2">
        <VersionChip label={v.label} />
        {card.version_count === 1 ? <span className="font-semibold">Origin card</span> : <span>{card.version_count} versions · in {places} place{places === 1 ? "" : "s"}</span>}
      </div>
      <div className="meta mt-1">{shortDateTime(v.created_at)} · {card.capture_source}</div>
      {card.version_count === 1 && card.inbox_state === "inbox" && <p className="mt-1.5 text-ink-2">No versions yet. Editing after it leaves the inbox creates v2. Sending it to a board or a bit records where it went.</p>}
      {card.version_count === 1 && card.inbox_state === "filed" && <p className="mt-1.5 text-ink-2">Filed. The next edit here creates v2.</p>}
    </div>
  );
}

/** D1 inspector wrapper: editor + footer actions. */
export function CardInspector({ card, onAfterKill }: { card: CardDTO; onAfterKill?: () => void }) {
  const a = useCardActions();
  const [board, setBoard] = useState(false);
  return (
    <Inspector>
      <CardEditor card={card} context={{ type: card.inbox_state === "inbox" ? "inbox" : "review" }} />
      <div className="mt-1 flex items-center gap-2 border-t border-divider pt-3">
        <Button variant="primary" onClick={() => setBoard(true)} disabled={card.killed_at !== null}>Send to board ▾</Button>
        {card.killed_at ? <Button onClick={() => a.restore.mutate(card.number)}>Restore</Button> : <Button onClick={() => { a.kill.mutate(card.number); onAfterKill?.(); }}>Kill</Button>}
        <div className="flex-1" />
        <CardMenu card={card} body={card.current_version.body} />
      </div>
      <BoardPickerDialog open={board} onOpenChange={setBoard} onPick={(boardId) => a.sendToBoard.mutate({ n: card.number, boardId })} />
    </Inspector>
  );
}
