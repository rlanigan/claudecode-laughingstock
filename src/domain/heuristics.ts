// Rule 7.9 — set heuristics shown in D6 "Set shape" and D7 columns. Pure.
import type { NoteDTO } from "@/types/dto";
import { formatMmSs } from "./runtime";

/** Most frequent subject tag across a bit's joke cards; ties alphabetical; null when none. */
export function primarySubject(subjectsPerJoke: string[][]): string | null {
  const counts = new Map<string, number>();
  for (const subjects of subjectsPerJoke) for (const s of subjects) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export interface HeuristicInput {
  bitIds: string[];
  names: Record<string, string>;
  primarySubjects: Record<string, string | null>;
  insertedBitId?: string;
  baseBitIds?: string[];
  callbacks: { fromPosition: number; targetFirstPosition: number | null; cardNumber: number }[];
  runtimeSeconds: number;
  targetSeconds: number | null;
  siblingTransitionsToWrite?: number[];
  ownTransitionsToWrite?: number;
}

const startsWith = (name: string | undefined, prefix: string) => !!name && name.toLowerCase().startsWith(prefix);

function sameSubjectRuns(bitIds: string[], subjects: Record<string, string | null>): [string, string, string][] {
  const runs: [string, string, string][] = [];
  for (let i = 0; i + 1 < bitIds.length; i++) {
    const a = subjects[bitIds[i]] ?? null;
    const b = subjects[bitIds[i + 1]] ?? null;
    if (a && a === b) runs.push([bitIds[i], bitIds[i + 1], a]);
  }
  return runs;
}

export function setNotes(input: HeuristicInput): NoteDTO[] {
  const notes: NoteDTO[] = [];
  const { bitIds, names, primarySubjects: subjects } = input;
  const n = bitIds.length;
  const isVariant = !!input.baseBitIds;

  // H1 / H2 / P3 — opener and closer position.
  bitIds.forEach((id, i) => {
    const name = names[id] ?? "";
    if (startsWith(name, "opener") && i !== 0) {
      notes.push({ kind: "warning", code: "H1", text: `'${name}' is no longer the opener. Rename or rethink.` });
    }
    if (startsWith(name, "closer")) {
      if (i !== n - 1) notes.push({ kind: "warning", code: "H2", text: `'${name}' is no longer the closer.` });
      else notes.push({ kind: "positive", code: "P3", text: `${name} still closes.` });
    }
  });

  // H3 — same subject back to back.
  const runs = sameSubjectRuns(bitIds, subjects);
  if (isVariant) {
    const baseRuns = sameSubjectRuns(input.baseBitIds!, subjects);
    const baseKeys = new Set(baseRuns.map((r) => `${r[0]}|${r[1]}`));
    const newRuns = runs.filter((r) => !baseKeys.has(`${r[0]}|${r[1]}`));
    const seen = new Set<string>();
    for (const r of newRuns) {
      if (seen.has(r[2])) continue;
      seen.add(r[2]);
      notes.push({ kind: "warning", code: "H3", text: `${capitalize(r[2])} bits back to back.` });
    }
    // P2 — base run kept intact.
    const subjectsOfBaseRuns = new Set(baseRuns.map((r) => r[2]));
    for (const s of subjectsOfBaseRuns) {
      const keeps = baseRuns.filter((r) => r[2] === s).every((r) => runs.some((v) => v[0] === r[0] && v[1] === r[1]));
      if (keeps) notes.push({ kind: "positive", code: "P2", text: `Keeps the ${s} run intact.` });
    }
  } else {
    if (runs.length === 0) {
      notes.push({ kind: "info", code: "H3", text: "Same-subject bits back to back: no" });
    } else {
      const seen = new Set<string>();
      for (const r of runs) {
        if (seen.has(r[2])) continue;
        seen.add(r[2]);
        notes.push({ kind: "warning", code: "H3", text: `${capitalize(r[2])} bits back to back: yes` });
      }
    }
  }

  // H4 — odd fit for the inserted bit.
  if (input.insertedBitId) {
    const i = bitIds.indexOf(input.insertedBitId);
    if (i > 0 && i < n - 1) {
      const a = subjects[bitIds[i - 1]] ?? null;
      const b = subjects[bitIds[i + 1]] ?? null;
      const x = subjects[input.insertedBitId] ?? null;
      if (a && a === b && x !== a) {
        notes.push({
          kind: "warning",
          code: "H4",
          text: `${names[input.insertedBitId] ?? "It"} sits between two ${a} bits. Odd fit.`,
        });
      }
    }
  }

  // H5 — callback order.
  for (const cb of input.callbacks) {
    if (cb.targetFirstPosition === null) {
      notes.push({ kind: "warning", code: "H5", text: `Callback to #${pad(cb.cardNumber)}, which isn't in this set.` });
    } else if (cb.targetFirstPosition >= cb.fromPosition) {
      notes.push({ kind: "warning", code: "H5", text: `Callback to #${pad(cb.cardNumber)} comes before its setup.` });
    }
  }

  // H6 — over target.
  if (input.targetSeconds !== null && input.runtimeSeconds > input.targetSeconds) {
    notes.push({
      kind: "warning",
      code: "H6",
      text: `Over target by ${formatMmSs(input.runtimeSeconds - input.targetSeconds)}.`,
    });
  }

  // P1 — fewest transitions to write among siblings.
  if (input.siblingTransitionsToWrite && input.ownTransitionsToWrite !== undefined) {
    const min = Math.min(...input.siblingTransitionsToWrite, input.ownTransitionsToWrite);
    const othersHaveMore = input.siblingTransitionsToWrite.some((s) => s > input.ownTransitionsToWrite!);
    if (input.ownTransitionsToWrite === min && othersHaveMore) {
      notes.push({ kind: "positive", code: "P1", text: "Fewest transitions to write." });
    }
  }

  return notes;
}

const pad = (n: number) => String(n).padStart(4, "0");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
