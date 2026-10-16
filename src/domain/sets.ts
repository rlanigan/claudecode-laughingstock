// Rule 7.9 — fork generation, ordering codes, variant letters, transitions. Pure.
import type { TransitionKind } from "@/types/dto";

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB" … */
export function variantLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

export function variantDescription(i: number, n: number, previousName: string | null): string {
  if (i === 0) return "Open with it";
  if (i === n) return "Put it last";
  return `After ${previousName ?? ""}`.trim();
}

/** Insert `insertBitId` at every position 0…n of the base order. */
export function generateInsertVariants(
  baseBitIds: string[],
  insertBitId: string,
  bitNames: Record<string, string>,
): { letter: string; description: string; bitIds: string[] }[] {
  const n = baseBitIds.length;
  const out: { letter: string; description: string; bitIds: string[] }[] = [];
  for (let i = 0; i <= n; i++) {
    const bitIds = [...baseBitIds.slice(0, i), insertBitId, ...baseBitIds.slice(i)];
    const prev = i > 0 ? (bitNames[baseBitIds[i - 1]] ?? null) : null;
    out.push({ letter: variantLetter(i), description: variantDescription(i, n, prev), bitIds });
  }
  return out;
}

/** Base bits get a, b, c… in base order; bits not in the base get the next letters. */
export function orderingCode(baseBitIds: string[], variantBitIds: string[]): string {
  const codes = new Map<string, string>();
  let next = 0;
  const letter = () => {
    const i = next++;
    return i < 26 ? String.fromCharCode(97 + i) : `${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26) + 1}`;
  };
  for (const id of baseBitIds) if (!codes.has(id)) codes.set(id, letter());
  for (const id of variantBitIds) if (!codes.has(id)) codes.set(id, letter());
  return variantBitIds.map((id) => codes.get(id)!).join(" ");
}

export function adjacentPairs(bitIds: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < bitIds.length; i++) out.push([bitIds[i], bitIds[i + 1]]);
  return out;
}

export function pairKey(from: string, to: string): string {
  return `${from}→${to}`;
}

/** Gaps that have no library row (written or hard cut) for their ordered pair. */
export function transitionsToWrite(bitIds: string[], library: Map<string, TransitionKind>): number {
  return adjacentPairs(bitIds).filter(([a, b]) => !library.has(pairKey(a, b))).length;
}

/** Names of bits whose positions differ between two orderings (plus added/removed bits). */
export function differingBits(baseBitIds: string[], variantBitIds: string[]): string[] {
  const out: string[] = [];
  const basePos = new Map(baseBitIds.map((id, i) => [id, i]));
  const varPos = new Map(variantBitIds.map((id, i) => [id, i]));
  for (const id of new Set([...baseBitIds, ...variantBitIds])) {
    if (basePos.get(id) !== varPos.get(id)) out.push(id);
  }
  return out;
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
