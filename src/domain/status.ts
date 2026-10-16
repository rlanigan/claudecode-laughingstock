// Rule 7.4 — card status derivation (precedence top to bottom).
import type { CardKind, CardStatus, PerformanceResult } from "@/types/dto";

export interface Appearance {
  performedOn: string; // YYYY-MM-DD
  updatedAt: Date;
  result: PerformanceResult;
}

export function latestAppearance(appearances: Appearance[]): Appearance | null {
  if (appearances.length === 0) return null;
  return [...appearances].sort((a, b) => {
    if (a.performedOn !== b.performedOn) return a.performedOn < b.performedOn ? 1 : -1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

export function deriveStatus(input: {
  killed: boolean;
  kind: CardKind;
  hasWorkshopAnswers: boolean;
  appearances: Appearance[];
}): CardStatus {
  if (input.killed) return "killed";
  const latest = latestAppearance(input.appearances);
  if (latest && latest.result === "landed") return "landed";
  if (latest) return "tested";
  if (input.kind === "joke") return "promoted";
  if (input.hasWorkshopAnswers) return "workshopped";
  return "raw";
}
