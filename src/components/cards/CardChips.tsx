"use client";
import { Chip } from "@/components/ui/primitives";
import { FORM_LABELS, type CardSummaryDTO } from "@/types/dto";

/** Chip order (§F-09): form (neutral), status (system, only when not raw), subjects (neutral), themes (accent). */
export function CardChips({ card, max = 6, showUntagged }: { card: Pick<CardSummaryDTO, "form" | "form_inferred" | "status" | "subjects" | "themes" | "killed_at">; max?: number; showUntagged?: boolean }) {
  const chips: React.ReactNode[] = [];
  if (card.form) chips.push(<Chip key="form" title={card.form_inferred ? "Form inferred automatically" : "Form"}>{FORM_LABELS[card.form]}{card.form_inferred && <span className="opacity-60">·auto</span>}</Chip>);
  if (card.status !== "raw") chips.push(<Chip key="status" variant={card.status === "landed" ? "success" : card.status === "killed" ? "danger" : "status"}>{card.status}</Chip>);
  for (const s of card.subjects) chips.push(<Chip key={`s-${s.id}`}>{s.name}</Chip>);
  for (const t of card.themes) chips.push(<Chip key={`t-${t.id}`} variant="theme">{t.name}</Chip>);
  if (chips.length === 0 && showUntagged) chips.push(<Chip key="untagged" variant="dashed">untagged</Chip>);
  const shown = chips.slice(0, max);
  const extra = chips.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown}
      {extra > 0 && <Chip variant="dashed">+{extra}</Chip>}
    </div>
  );
}
