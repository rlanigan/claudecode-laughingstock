// Sets (F-17–F-20, Rule 7.9): working copy, transitions, anchors, forks, variants, pick, restore.
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { bits, cards, performanceMarks, performances, setForkGroups, setRevisionItems, setRevisionTransitions, setRevisions, setTransitions, sets, type Bit, type SetRevision, type SetRow } from "@/db/schema";
import { DomainError, limitReached, notFound } from "@/server/errors";
import { adjacentPairs, differingBits, generateInsertVariants, orderingCode, pairKey, sameOrder, transitionsToWrite, variantLetter } from "@/domain/sets";
import { setNotes } from "@/domain/heuristics";
import { transitionSeconds } from "@/domain/runtime";
import { wordCount } from "@/domain/title-split";
import type { ForkDTO, NoteDTO, RevisionDTO, RevisionItemDTO, RiverNodeDTO, ScriptBlockDTO, SetDTO, SetSummaryDTO, TransitionDTO } from "@/types/dto";
import { bitCardSubjectsAndThemes, durationFor, loadBitItems, primarySubjectsFor, requireBit, snapshotFor, type LoadedBitItem } from "@/server/repos/bits";
import { requireCard } from "@/server/repos/cards";
import { summarizeBits } from "./bits";
import { logCardEvent, track } from "./events";
import { sealVersions } from "./versions";
import { getReadingWpm } from "./users";
import { activePerformanceFor, performanceDTO } from "./performances";

// ---------- loaders ----------

export async function requireSet(db: DbOrTx, userId: string, id: string): Promise<SetRow> {
  const row = await db.query.sets.findFirst({ where: and(eq(sets.id, id), eq(sets.userId, userId)) });
  if (!row) throw notFound("That set");
  return row;
}

export async function requireRevision(db: DbOrTx, userId: string, id: string): Promise<SetRevision> {
  const row = await db.query.setRevisions.findFirst({ where: and(eq(setRevisions.id, id), eq(setRevisions.userId, userId)) });
  if (!row) throw notFound("That version of the set");
  return row;
}

async function workingOf(db: DbOrTx, setId: string): Promise<SetRevision> {
  const row = await db.query.setRevisions.findFirst({ where: and(eq(setRevisions.setId, setId), eq(setRevisions.kind, "working")) });
  if (!row) throw notFound("That set");
  return row;
}

async function revisionBitIds(db: DbOrTx, revisionId: string): Promise<string[]> {
  const rows = await db.select({ bitId: setRevisionItems.bitId }).from(setRevisionItems).where(eq(setRevisionItems.revisionId, revisionId)).orderBy(asc(setRevisionItems.position));
  return rows.map((r) => r.bitId);
}

async function libraryFor(db: DbOrTx, setId: string) {
  const rows = await db.select().from(setTransitions).where(eq(setTransitions.setId, setId));
  return new Map(rows.map((r) => [pairKey(r.fromBitId, r.toBitId), r]));
}

async function frozenFor(db: DbOrTx, revisionId: string) {
  const rows = await db.select().from(setRevisionTransitions).where(eq(setRevisionTransitions.revisionId, revisionId));
  return new Map(rows.map((r) => [pairKey(r.fromBitId, r.toBitId), r]));
}

interface TransitionRowLike {
  kind: "written" | "hard_cut";
  text: string | null;
  callbackToCardId: string | null;
}

async function cardNumbers(db: DbOrTx, ids: (string | null)[]): Promise<Map<string, number>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (!clean.length) return new Map();
  const rows = await db.select({ id: cards.id, number: cards.number }).from(cards).where(inArray(cards.id, clean));
  return new Map(rows.map((r) => [r.id, r.number]));
}

/** Builds a RevisionDTO for any revision kind. */
export async function revisionDTO(db: DbOrTx, userId: string, rev: SetRevision, opts: { includeScript?: boolean; siblingTransitionsToWrite?: number[]; baseBitIds?: string[]; insertedBitId?: string } = {}): Promise<RevisionDTO> {
  const set = await requireSet(db, userId, rev.setId);
  const wpm = await getReadingWpm(db, userId);
  const frozen = rev.kind === "anchor";
  const itemRows = await db.select().from(setRevisionItems).where(eq(setRevisionItems.revisionId, rev.id)).orderBy(asc(setRevisionItems.position));
  const bitIds = itemRows.map((r) => r.bitId);
  const bitRows = bitIds.length ? await db.select().from(bits).where(inArray(bits.id, bitIds)) : [];
  const bitById = new Map(bitRows.map((b) => [b.id, b]));
  const liveItems = frozen ? new Map<string, LoadedBitItem[]>() : await loadBitItems(db, bitIds);
  const subjects = await primarySubjectsFor(db, bitIds);
  const parentAnchor = rev.parentRevisionId ? await db.query.setRevisions.findFirst({ where: eq(setRevisions.id, rev.parentRevisionId) }) : null;
  const parentBitIds = parentAnchor ? await revisionBitIds(db, parentAnchor.id) : [];
  const lastCuts = await db
    .select({ bitId: performanceMarks.bitId, performedOn: performances.performedOn, result: performanceMarks.result })
    .from(performanceMarks)
    .innerJoin(performances, and(eq(performances.id, performanceMarks.performanceId), eq(performances.setId, set.id)))
    .where(bitIds.length ? inArray(performanceMarks.bitId, bitIds) : sql`false`)
    .orderBy(desc(performances.performedOn), desc(performanceMarks.updatedAt));
  const latestMark = new Map<string, { performedOn: string; result: string }>();
  for (const m of lastCuts) if (!latestMark.has(m.bitId)) latestMark.set(m.bitId, { performedOn: m.performedOn, result: m.result });

  const items: RevisionItemDTO[] = [];
  const names: Record<string, string> = {};
  const jokeTexts = new Map<string, ScriptBlockDTO[]>();
  for (const r of itemRows) {
    const bit = bitById.get(r.bitId);
    const snap = r.bitSnapshot;
    const name = frozen && snap ? snap.name : (bit?.name ?? "Deleted bit");
    names[r.bitId] = name;
    let duration: number;
    let jokeCount: number;
    const blocks: ScriptBlockDTO[] = [];
    if (frozen && snap) {
      duration = snap.duration_seconds;
      jokeCount = snap.items.filter((i) => i.kind === "joke").length;
      for (const it of snap.items) {
        if (it.kind === "joke") blocks.push({ type: "joke", bit_id: r.bitId, card_number: it.card_number, version_label: it.version_label, text: it.text });
        else blocks.push({ type: "bridge", bit_id: r.bitId, text: it.text });
      }
    } else {
      const its = liveItems.get(r.bitId) ?? [];
      duration = bit ? durationFor(bit, its, wpm) : 0;
      jokeCount = its.filter((i) => i.kind === "joke").length;
      for (const it of its) {
        if (it.kind === "joke") blocks.push({ type: "joke", bit_id: r.bitId, card_number: it.cardNumber!, version_label: it.versionLabel!, text: it.title ? `${it.title}\n${it.body ?? ""}` : (it.body ?? ""), item_id: it.id });
        else blocks.push({ type: "bridge", bit_id: r.bitId, text: it.bridgeText ?? "", item_id: it.id });
      }
    }
    jokeTexts.set(r.bitId, blocks);
    const mark = latestMark.get(r.bitId);
    items.push({
      position: r.position,
      bit_id: r.bitId,
      bit_name: name,
      joke_count: jokeCount,
      duration_seconds: duration,
      is_new_in_revision: parentAnchor ? !parentBitIds.includes(r.bitId) : false,
      marked_cut_on: mark?.result === "cut" ? mark.performedOn : null,
      primary_subject: subjects[r.bitId] ?? null,
      archived: bit?.archivedAt !== null && bit?.archivedAt !== undefined,
    });
  }

  // Transitions.
  const source: Map<string, TransitionRowLike> = frozen ? await frozenFor(db, rev.id) : await libraryFor(db, set.id);
  const numbers = await cardNumbers(db, [...source.values()].map((t) => t.callbackToCardId));
  const transitions: TransitionDTO[] = adjacentPairs(bitIds).map(([a, b]) => {
    const t = source.get(pairKey(a, b));
    return { from_bit_id: a, to_bit_id: b, state: t ? t.kind : "missing", text: t?.text ?? null, callback_to_card_number: t?.callbackToCardId ? (numbers.get(t.callbackToCardId) ?? null) : null };
  });
  const libraryKinds = new Map<string, "written" | "hard_cut">();
  for (const [k, t] of source) libraryKinds.set(k, t.kind);
  const toWrite = transitionsToWrite(bitIds, libraryKinds);

  // Runtime.
  let runtime = items.reduce((acc, i) => acc + i.duration_seconds, 0);
  for (const t of transitions) if (t.state === "written" && t.text) runtime += transitionSeconds(wordCount(t.text), wpm);
  runtime = Math.round(runtime);

  // Callbacks (transitions with a callback target, plus jokes linked callback_to).
  const callbacks: RevisionDTO["callbacks"] = [];
  const heuristicCallbacks: { fromPosition: number; targetFirstPosition: number | null; cardNumber: number }[] = [];
  const firstPositionOfCard = (cardNumber: number): number | null => {
    for (const [bitId, blocks] of jokeTexts) if (blocks.some((b) => b.type === "joke" && b.card_number === cardNumber)) return bitIds.indexOf(bitId);
    return null;
  };
  transitions.forEach((t, gap) => {
    if (t.callback_to_card_number !== null) {
      const target = firstPositionOfCard(t.callback_to_card_number);
      const valid = target !== null && target <= gap;
      callbacks.push({ card_number: t.callback_to_card_number, label: target !== null ? names[bitIds[target]] : `#${String(t.callback_to_card_number).padStart(4, "0")}`, valid });
      heuristicCallbacks.push({ fromPosition: gap + 1, targetFirstPosition: target, cardNumber: t.callback_to_card_number });
    }
  });

  const notes: NoteDTO[] = setNotes({
    bitIds,
    names,
    primarySubjects: subjects,
    insertedBitId: opts.insertedBitId,
    baseBitIds: opts.baseBitIds,
    callbacks: heuristicCallbacks,
    runtimeSeconds: runtime,
    targetSeconds: set.targetDurationSeconds,
    siblingTransitionsToWrite: opts.siblingTransitionsToWrite,
    ownTransitionsToWrite: opts.siblingTransitionsToWrite ? toWrite : undefined,
  });

  // "What do both share?" per gap (live revisions only — cheap enough at this scale).
  const shared: RevisionDTO["shared"] = [];
  if (!frozen) {
    const cache = new Map<string, { subjects: Set<string>; themes: Set<string> }>();
    for (const id of bitIds) cache.set(id, await bitCardSubjectsAndThemes(db, id));
    for (const [a, b] of adjacentPairs(bitIds)) {
      const A = cache.get(a)!;
      const B = cache.get(b)!;
      shared.push({ from_bit_id: a, to_bit_id: b, subjects: [...A.subjects].filter((s) => B.subjects.has(s)), themes: [...A.themes].filter((t) => B.themes.has(t)) });
    }
  }

  let script: ScriptBlockDTO[] | undefined;
  if (opts.includeScript) {
    script = [];
    items.forEach((it, i) => {
      script!.push({ type: "bit_header", position: it.position, bit_id: it.bit_id, name: it.bit_name, duration_seconds: it.duration_seconds });
      script!.push(...(jokeTexts.get(it.bit_id) ?? []));
      if (i < transitions.length) script!.push({ type: "transition", ...transitions[i] });
    });
  }

  return {
    id: rev.id,
    set_id: rev.setId,
    kind: rev.kind,
    anchor_number: rev.anchorNumber,
    name: rev.name,
    parent_revision_id: rev.parentRevisionId,
    parent_anchor_number: parentAnchor?.anchorNumber ?? null,
    fork_group_id: rev.forkGroupId,
    variant_letter: rev.variantLetter,
    variant_description: rev.variantDescription,
    variant_state: rev.variantState,
    frozen_at: rev.frozenAt?.toISOString() ?? null,
    rev: rev.rev,
    items,
    transitions,
    runtime_seconds: runtime,
    transitions_to_write: toWrite,
    notes,
    callbacks,
    shared,
    script,
  };
}

async function riverNode(db: DbOrTx, rev: SetRevision, currentAnchorId: string | null): Promise<RiverNodeDTO> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(setRevisionItems).where(eq(setRevisionItems.revisionId, rev.id));
  let summary: string | null = null;
  if (rev.kind === "anchor") {
    const perf = await db.select({ performedOn: performances.performedOn, id: performances.id }).from(performances).where(eq(performances.revisionId, rev.id)).orderBy(desc(performances.performedOn)).limit(1);
    if (perf.length) {
      const marks = await db.select({ result: performanceMarks.result }).from(performanceMarks).where(eq(performanceMarks.performanceId, perf[0].id));
      const landed = marks.filter((m) => m.result === "landed").length;
      const date = new Date(perf[0].performedOn + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      summary = marks.length ? `performed ${date} · ${landed}/${marks.length} landed` : `performed ${date}`;
    }
  }
  return {
    revision_id: rev.id,
    kind: rev.kind as "anchor" | "variant",
    label: rev.kind === "anchor" ? `v${rev.anchorNumber}` : (rev.variantLetter ?? "?"),
    name: rev.name ?? rev.variantDescription,
    parent_revision_id: rev.parentRevisionId,
    fork_group_id: rev.forkGroupId,
    variant_state: rev.variantState,
    is_current: rev.id === currentAnchorId,
    created_at: rev.createdAt.toISOString(),
    bit_count: n,
    performance_summary: summary,
  };
}

/** "Changed since anchor" (Rule 7.9). */
export async function changedSinceAnchor(db: DbOrTx, userId: string, set: SetRow, working: SetRevision): Promise<boolean> {
  if (!working.parentRevisionId) return (await revisionBitIds(db, working.id)).length > 0;
  const anchor = await requireRevision(db, userId, working.parentRevisionId);
  const a = await revisionBitIds(db, anchor.id);
  const w = await revisionBitIds(db, working.id);
  if (!sameOrder(a, w)) return true;
  if (w.length) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(bits).where(and(inArray(bits.id, w), gt(bits.updatedAt, anchor.frozenAt!)));
    if (n > 0) return true;
  }
  const frozen = await frozenFor(db, anchor.id);
  const lib = await libraryFor(db, set.id);
  for (const [x, y] of adjacentPairs(w)) {
    const f = frozen.get(pairKey(x, y));
    const l = lib.get(pairKey(x, y));
    if ((f?.kind ?? null) !== (l?.kind ?? null) || (f?.text ?? null) !== (l?.text ?? null)) return true;
  }
  return false;
}

// ---------- CRUD ----------

export async function listSets(userId: string, archived = false): Promise<SetSummaryDTO[]> {
  const db = getDb();
  const rows = await db.select().from(sets).where(and(eq(sets.userId, userId), archived ? sql`${sets.archivedAt} is not null` : isNull(sets.archivedAt))).orderBy(desc(sets.updatedAt), asc(sets.name));
  const out: SetSummaryDTO[] = [];
  for (const s of rows) {
    const working = await workingOf(db, s.id);
    const dto = await revisionDTO(db, userId, working);
    const anchor = s.currentAnchorId ? await db.query.setRevisions.findFirst({ where: eq(setRevisions.id, s.currentAnchorId) }) : null;
    const last = await db.select({ d: performances.performedOn }).from(performances).where(eq(performances.setId, s.id)).orderBy(desc(performances.performedOn)).limit(1);
    out.push({ id: s.id, name: s.name, status: s.status, current_anchor: anchor ? { number: anchor.anchorNumber!, name: anchor.name! } : null, runtime_seconds: dto.runtime_seconds, target_duration_seconds: s.targetDurationSeconds, last_performed_on: last[0]?.d ?? null, archived: s.archivedAt !== null, updated_at: s.updatedAt.toISOString() });
  }
  return out;
}

export async function createSet(userId: string, input: { name: string; target_duration_seconds?: number | null; status?: SetRow["status"] }): Promise<SetDTO> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [s] = await tx.insert(sets).values({ userId, name: input.name.trim(), targetDurationSeconds: input.target_duration_seconds ?? null, status: input.status ?? "wip" }).returning();
    await tx.insert(setRevisions).values({ setId: s.id, userId, kind: "working" });
    await track(tx, userId, "set_created", {});
    return s.id;
  });
  return getSet(userId, id);
}

export async function patchSet(userId: string, id: string, patch: { name?: string; status?: SetRow["status"]; target_duration_seconds?: number | null; archived?: boolean }) {
  const db = getDb();
  await requireSet(db, userId, id);
  await db.update(sets).set({ name: patch.name?.trim(), status: patch.status, targetDurationSeconds: patch.target_duration_seconds, archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null }).where(eq(sets.id, id));
  return getSet(userId, id);
}

export async function deleteSet(userId: string, id: string) {
  const db = getDb();
  const s = await requireSet(db, userId, id);
  if (!s.archivedAt) throw new DomainError("ARCHIVE_FIRST", "Archive the set before deleting it.");
  await db.transaction(async (tx) => {
    await tx.delete(performances).where(eq(performances.setId, id));
    await tx.update(sets).set({ currentAnchorId: null }).where(eq(sets.id, id));
    await tx.delete(sets).where(eq(sets.id, id));
  });
}

export async function getSet(userId: string, id: string): Promise<SetDTO> {
  const db = getDb();
  const set = await requireSet(db, userId, id);
  const working = await workingOf(db, set.id);
  const workingDTO = await revisionDTO(db, userId, working, { includeScript: true });
  const revs = await db.select().from(setRevisions).where(and(eq(setRevisions.setId, id), sql`${setRevisions.kind} <> 'working'`)).orderBy(asc(setRevisions.createdAt));
  const anchors: RiverNodeDTO[] = [];
  const variants: RiverNodeDTO[] = [];
  for (const r of revs) (r.kind === "anchor" ? anchors : variants).push(await riverNode(db, r, set.currentAnchorId));
  // Picked variants keep their fork-time created_at, so the river orders anchors by number.
  anchors.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)));
  const workingBitIds = workingDTO.items.map((i) => i.bit_id);
  const benchRows = await db.select().from(bits).where(and(eq(bits.userId, userId), isNull(bits.archivedAt), workingBitIds.length ? sql`${bits.id} not in ${sql.raw(`(${workingBitIds.map((b) => `'${b}'`).join(",")})`)}` : sql`true`)).orderBy(desc(bits.createdAt));
  const bench = await summarizeBits(db, userId, benchRows);
  const currentAnchor = set.currentAnchorId ? await db.query.setRevisions.findFirst({ where: eq(setRevisions.id, set.currentAnchorId) }) : null;
  const active = await activePerformanceFor(db, userId, set.id);
  // Reuse candidates: frozen transitions in this set's anchors (most recent first, distinct text).
  const reuseRows = await db
    .select({ from: setRevisionTransitions.fromBitId, to: setRevisionTransitions.toBitId, text: setRevisionTransitions.text, anchor: setRevisions.anchorNumber, name: setRevisions.name })
    .from(setRevisionTransitions)
    .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionTransitions.revisionId), eq(setRevisions.setId, id)))
    .where(eq(setRevisionTransitions.kind, "written"))
    .orderBy(desc(setRevisions.anchorNumber));
  const seen = new Set<string>();
  const reuse: SetDTO["reuse_candidates"] = [];
  for (const r of reuseRows) {
    if (!r.text || seen.has(r.text)) continue;
    seen.add(r.text);
    reuse.push({ from_bit_id: r.from, to_bit_id: r.to, anchor_label: `v${r.anchor}${r.name ? ` · ${r.name}` : ""}`, text: r.text });
  }
  return {
    set: { id: set.id, name: set.name, status: set.status, target_duration_seconds: set.targetDurationSeconds, current_anchor_id: set.currentAnchorId, current_anchor_number: currentAnchor?.anchorNumber ?? null, current_anchor_name: currentAnchor?.name ?? null, archived: set.archivedAt !== null, updated_at: set.updatedAt.toISOString() },
    working: workingDTO,
    changed_since_anchor: await changedSinceAnchor(db, userId, set, working),
    anchors,
    variants,
    bench,
    active_performance: active ? await performanceDTO(db, userId, active) : null,
    reuse_candidates: reuse,
  };
}

// ---------- working copy and variants: ordering ----------

async function replaceItems(db: DbOrTx, revisionId: string, bitIds: string[], snapshots?: Map<string, ReturnType<typeof snapshotFor>>) {
  await db.delete(setRevisionItems).where(eq(setRevisionItems.revisionId, revisionId));
  for (let i = 0; i < bitIds.length; i++) {
    await db.insert(setRevisionItems).values({ revisionId, position: i, bitId: bitIds[i], bitSnapshot: snapshots?.get(bitIds[i]) ?? null });
  }
}

async function setOrder(db: DbOrTx, userId: string, rev: SetRevision, expectedRev: number, bitIds: string[]) {
  if (rev.kind === "anchor") throw new DomainError("REVISION_FROZEN", "Anchors can't change. Fork it instead.");
  if (rev.rev !== expectedRev) throw new DomainError("CONFLICT", "This set changed on another device. Reloaded.");
  if (new Set(bitIds).size !== bitIds.length) throw new DomainError("VALIDATION_ERROR", "A bit can only appear once in a set.");
  if (bitIds.length > 60) throw limitReached(60, "bits in a set");
  for (const id of bitIds) await requireBit(db, userId, id);
  const before = await revisionBitIds(db, rev.id);
  await replaceItems(db, rev.id, bitIds);
  await db.update(setRevisions).set({ rev: rev.rev + 1, updatedAt: new Date() }).where(eq(setRevisions.id, rev.id));
  await db.update(sets).set({ updatedAt: new Date() }).where(eq(sets.id, rev.setId));
  const added = bitIds.filter((b) => !before.includes(b));
  if (added.length && rev.kind === "working") {
    const set = await requireSet(db, userId, rev.setId);
    const items = await loadBitItems(db, added);
    for (const b of added) for (const it of items.get(b) ?? []) if (it.cardId) await logCardEvent(db, { userId, cardId: it.cardId, type: "added_to_set", refType: "set", refId: set.id, label: set.name });
  }
}

export async function putWorking(userId: string, setId: string, input: { rev: number; bit_ids: string[] }) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await requireSet(tx, userId, setId);
    const working = await workingOf(tx, setId);
    await setOrder(tx, userId, working, input.rev, input.bit_ids);
  });
  const working = await workingOf(db, setId);
  return { working: await revisionDTO(db, userId, working, { includeScript: true }) };
}

export async function putRevisionOrder(userId: string, revisionId: string, input: { rev: number; bit_ids: string[] }) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const rev = await requireRevision(tx, userId, revisionId);
    await setOrder(tx, userId, rev, input.rev, input.bit_ids);
  });
  return revisionDTO(db, userId, await requireRevision(db, userId, revisionId));
}

// ---------- transitions ----------

export async function putTransition(userId: string, setId: string, input: { from_bit_id: string; to_bit_id: string; kind: "written" | "hard_cut"; text?: string; callback_to_card_number?: number | null }) {
  const db = getDb();
  await requireSet(db, userId, setId);
  await requireBit(db, userId, input.from_bit_id);
  await requireBit(db, userId, input.to_bit_id);
  if (input.from_bit_id === input.to_bit_id) throw new DomainError("VALIDATION_ERROR", "A transition joins two different bits.");
  const text = input.kind === "written" ? (input.text ?? "").trim() : null;
  if (input.kind === "written" && !text) {
    await db.delete(setTransitions).where(and(eq(setTransitions.setId, setId), eq(setTransitions.fromBitId, input.from_bit_id), eq(setTransitions.toBitId, input.to_bit_id)));
    return { transition: { from_bit_id: input.from_bit_id, to_bit_id: input.to_bit_id, state: "missing" as const, text: null, callback_to_card_number: null } };
  }
  let callbackId: string | null = null;
  if (input.callback_to_card_number) callbackId = (await requireCard(db, userId, input.callback_to_card_number)).id;
  await db
    .insert(setTransitions)
    .values({ setId, userId, fromBitId: input.from_bit_id, toBitId: input.to_bit_id, kind: input.kind, text, callbackToCardId: callbackId })
    .onConflictDoUpdate({ target: [setTransitions.setId, setTransitions.fromBitId, setTransitions.toBitId], set: { kind: input.kind, text, callbackToCardId: input.callback_to_card_number === undefined ? sql`${setTransitions.callbackToCardId}` : callbackId, updatedAt: new Date() } });
  await db.update(sets).set({ updatedAt: new Date() }).where(eq(sets.id, setId));
  await track(db, userId, "set_transition_written", { kind: input.kind });
  const row = (await db.query.setTransitions.findFirst({ where: and(eq(setTransitions.setId, setId), eq(setTransitions.fromBitId, input.from_bit_id), eq(setTransitions.toBitId, input.to_bit_id)) }))!;
  const num = row.callbackToCardId ? (await cardNumbers(db, [row.callbackToCardId])).get(row.callbackToCardId) : null;
  return { transition: { from_bit_id: row.fromBitId, to_bit_id: row.toBitId, state: row.kind, text: row.text, callback_to_card_number: num ?? null } as TransitionDTO };
}

export async function deleteTransition(userId: string, setId: string, from: string, to: string) {
  const db = getDb();
  await requireSet(db, userId, setId);
  await db.delete(setTransitions).where(and(eq(setTransitions.setId, setId), eq(setTransitions.fromBitId, from), eq(setTransitions.toBitId, to)));
}

// ---------- anchors ----------

async function freezeInto(db: DbOrTx, userId: string, set: SetRow, sourceRevisionId: string, targetRevisionId: string) {
  const bitIds = await revisionBitIds(db, sourceRevisionId);
  const wpm = await getReadingWpm(db, userId);
  const items = await loadBitItems(db, bitIds);
  const bitRows = bitIds.length ? await db.select().from(bits).where(inArray(bits.id, bitIds)) : [];
  const byId = new Map(bitRows.map((b) => [b.id, b]));
  const snapshots = new Map<string, ReturnType<typeof snapshotFor>>();
  const versionIds: string[] = [];
  const cardIds: string[] = [];
  for (const id of bitIds) {
    const bit = byId.get(id) as Bit;
    const its = items.get(id) ?? [];
    snapshots.set(id, snapshotFor(bit, its, durationFor(bit, its, wpm)));
    for (const it of its) if (it.pinnedVersionId) {
      versionIds.push(it.pinnedVersionId);
      cardIds.push(it.cardId!);
    }
  }
  await replaceItems(db, targetRevisionId, bitIds, snapshots);
  const lib = await libraryFor(db, set.id);
  await db.delete(setRevisionTransitions).where(eq(setRevisionTransitions.revisionId, targetRevisionId));
  for (const [a, b] of adjacentPairs(bitIds)) {
    const t = lib.get(pairKey(a, b));
    if (t) await db.insert(setRevisionTransitions).values({ revisionId: targetRevisionId, fromBitId: a, toBitId: b, kind: t.kind, text: t.text, callbackToCardId: t.callbackToCardId });
  }
  await sealVersions(db, versionIds);
  return { bitIds, cardIds: [...new Set(cardIds)] };
}

async function nextAnchorNumber(db: DbOrTx, setId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(anchor_number), 0) + 1` }).from(setRevisions).where(eq(setRevisions.setId, setId));
  if (Number(n) > 1000) throw limitReached(1000, "anchors on one set");
  return Number(n);
}

async function anchorWorking(db: DbOrTx, userId: string, set: SetRow, name: string): Promise<SetRevision> {
  const working = await workingOf(db, set.id);
  const bitIds = await revisionBitIds(db, working.id);
  if (!bitIds.length) throw new DomainError("WORKING_EMPTY", "Add at least one bit before anchoring.");
  const number = await nextAnchorNumber(db, set.id);
  const [anchor] = await db.insert(setRevisions).values({ setId: set.id, userId, kind: "anchor", parentRevisionId: working.parentRevisionId, anchorNumber: number, name: name.trim(), frozenAt: new Date() }).returning();
  const { cardIds } = await freezeInto(db, userId, set, working.id, anchor.id);
  await db.update(sets).set({ currentAnchorId: anchor.id, updatedAt: new Date() }).where(eq(sets.id, set.id));
  await db.update(setRevisions).set({ parentRevisionId: anchor.id, rev: working.rev + 1 }).where(eq(setRevisions.id, working.id));
  for (const c of cardIds) await logCardEvent(db, { userId, cardId: c, type: "anchored", refType: "set", refId: set.id, label: `${set.name} v${number}` });
  await track(db, userId, "set_anchor_created", { anchor_number: number, bit_count: bitIds.length });
  return anchor;
}

export async function createAnchor(userId: string, setId: string, name: string) {
  const db = getDb();
  const anchor = await db.transaction(async (tx) => anchorWorking(tx, userId, await requireSet(tx, userId, setId), name));
  return { anchor: await revisionDTO(db, userId, anchor) };
}

// ---------- forks ----------

export async function createFork(userId: string, setId: string, input: { base_revision_id: string; mode: "insert_all_positions" | "duplicate"; bit_id?: string }) {
  const db = getDb();
  const groupId = await db.transaction(async (tx) => {
    const set = await requireSet(tx, userId, setId);
    const base = await requireRevision(tx, userId, input.base_revision_id);
    if (base.setId !== set.id || base.kind !== "anchor") throw new DomainError("BASE_NOT_ANCHOR", "Forks start from an anchor.");
    const baseBitIds = await revisionBitIds(tx, base.id);
    let variants: { letter: string; description: string; bitIds: string[] }[];
    let insertedBitId: string | null = null;
    if (input.mode === "insert_all_positions") {
      if (!input.bit_id) throw new DomainError("BIT_REQUIRED", "Choose a bit to place.");
      const bit = await requireBit(tx, userId, input.bit_id);
      if (baseBitIds.includes(bit.id)) throw new DomainError("BIT_ALREADY_IN_BASE", `'${bit.name}' is already in v${base.anchorNumber}.`);
      if (baseBitIds.length + 1 > 61) throw limitReached(61, "variants in one fork");
      const names: Record<string, string> = {};
      const rows = baseBitIds.length ? await tx.select({ id: bits.id, name: bits.name }).from(bits).where(inArray(bits.id, baseBitIds)) : [];
      for (const r of rows) names[r.id] = r.name;
      variants = generateInsertVariants(baseBitIds, bit.id, names);
      insertedBitId = bit.id;
    } else {
      variants = [{ letter: variantLetter(0), description: `Copy of v${base.anchorNumber}`, bitIds: baseBitIds }];
    }
    const [group] = await tx.insert(setForkGroups).values({ setId: set.id, baseRevisionId: base.id, mode: input.mode, insertedBitId }).returning();
    for (const v of variants) {
      const [rev] = await tx.insert(setRevisions).values({ setId: set.id, userId, kind: "variant", parentRevisionId: base.id, forkGroupId: group.id, variantLetter: v.letter, variantDescription: v.description, variantState: "open" }).returning();
      await replaceItems(tx, rev.id, v.bitIds);
    }
    await track(tx, userId, "set_fork_created", { mode: input.mode, variant_count: variants.length });
    return group.id;
  });
  const fork = await getFork(userId, setId, groupId);
  return { fork_group_id: groupId, variants: fork.variants };
}

export async function getFork(userId: string, setId: string, forkGroupId: string): Promise<ForkDTO> {
  const db = getDb();
  await requireSet(db, userId, setId);
  const group = await db.query.setForkGroups.findFirst({ where: and(eq(setForkGroups.id, forkGroupId), eq(setForkGroups.setId, setId)) });
  if (!group) throw notFound("That comparison");
  const base = await requireRevision(db, userId, group.baseRevisionId);
  const baseBitIds = await revisionBitIds(db, base.id);
  const variantRows = await db.select().from(setRevisions).where(and(eq(setRevisions.forkGroupId, forkGroupId), sql`${setRevisions.kind} <> 'working'`)).orderBy(asc(setRevisions.variantLetter));
  // First pass: transitions-to-write per variant for P1.
  const lib = new Map<string, "written" | "hard_cut">();
  for (const [k, t] of await libraryFor(db, setId)) lib.set(k, t.kind);
  const counts = await Promise.all(variantRows.map(async (v) => transitionsToWrite(await revisionBitIds(db, v.id), lib)));
  const variants: ForkDTO["variants"] = [];
  for (let i = 0; i < variantRows.length; i++) {
    const v = variantRows[i];
    const dto = await revisionDTO(db, userId, v, { includeScript: true, siblingTransitionsToWrite: counts.filter((_, j) => j !== i), baseBitIds, insertedBitId: group.insertedBitId ?? undefined });
    const ids = dto.items.map((it) => it.bit_id);
    const names = Object.fromEntries(dto.items.map((it) => [it.bit_id, it.bit_name]));
    variants.push({ ...dto, ordering_code: orderingCode(baseBitIds, ids), differs: differingBits(baseBitIds, ids).map((id) => names[id] ?? id) });
  }
  const insertedName = group.insertedBitId ? ((await db.query.bits.findFirst({ where: eq(bits.id, group.insertedBitId) }))?.name ?? null) : null;
  return { fork_group: { id: group.id, mode: group.mode, inserted_bit_id: group.insertedBitId, inserted_bit_name: insertedName }, base: await revisionDTO(db, userId, base), variants };
}

export async function getRevision(userId: string, id: string, includeScript = false) {
  const db = getDb();
  return revisionDTO(db, userId, await requireRevision(db, userId, id), { includeScript });
}

export async function duplicateRevision(userId: string, id: string) {
  const db = getDb();
  const newId = await db.transaction(async (tx) => {
    const src = await requireRevision(tx, userId, id);
    if (src.kind === "working") throw new DomainError("REVISION_NOT_VARIANT", "Duplicate a variant or anchor.");
    let groupId = src.forkGroupId;
    if (!groupId) {
      const [g] = await tx.insert(setForkGroups).values({ setId: src.setId, baseRevisionId: src.id, mode: "duplicate" }).returning();
      groupId = g.id;
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(setRevisions).where(eq(setRevisions.forkGroupId, groupId));
    const base = src.kind === "anchor" ? src : await requireRevision(tx, userId, src.parentRevisionId!);
    const [rev] = await tx.insert(setRevisions).values({ setId: src.setId, userId, kind: "variant", parentRevisionId: base.id, forkGroupId: groupId, variantLetter: variantLetter(n), variantDescription: "Custom order", variantState: "open" }).returning();
    await replaceItems(tx, rev.id, await revisionBitIds(tx, src.id));
    return rev.id;
  });
  return { variant: await revisionDTO(db, userId, await requireRevision(db, userId, newId)) };
}

export async function discardRevision(userId: string, id: string) {
  const db = getDb();
  const rev = await requireRevision(db, userId, id);
  if (rev.kind !== "variant") throw new DomainError("REVISION_FROZEN", "Anchors can't be discarded.");
  await db.delete(setRevisions).where(eq(setRevisions.id, id));
}

// ---------- pick / restore ----------

async function resolveWorkingCopy(tx: DbOrTx, userId: string, set: SetRow, resolution: "anchor_first" | "discard" | undefined, anchorFirstName: string | undefined, action: string) {
  const working = await workingOf(tx, set.id);
  if (!(await changedSinceAnchor(tx, userId, set, working))) return;
  const current = set.currentAnchorId ? await requireRevision(tx, userId, set.currentAnchorId) : null;
  if (!resolution) throw new DomainError("WORKING_COPY_CHANGED", `Your working copy has changes since v${current?.anchorNumber ?? 0}.`, { current_anchor_number: current?.anchorNumber ?? null, action });
  if (resolution === "anchor_first") {
    if (!anchorFirstName) throw new DomainError("VALIDATION_ERROR", "Name the anchor first.");
    await anchorWorking(tx, userId, set, anchorFirstName);
  }
}

async function resetWorkingTo(tx: DbOrTx, setId: string, anchor: SetRevision) {
  const working = await workingOf(tx, setId);
  await replaceItems(tx, working.id, await revisionBitIds(tx, anchor.id));
  await tx.update(setRevisions).set({ parentRevisionId: anchor.id, rev: working.rev + 1, updatedAt: new Date() }).where(eq(setRevisions.id, working.id));
  await tx.update(sets).set({ currentAnchorId: anchor.id, updatedAt: new Date() }).where(eq(sets.id, setId));
}

export async function pickVariant(userId: string, revisionId: string, input: { name: string; working_copy_resolution?: "anchor_first" | "discard"; anchor_first_name?: string }) {
  const db = getDb();
  const setId = await db.transaction(async (tx) => {
    const variant = await requireRevision(tx, userId, revisionId);
    if (variant.kind !== "variant") throw new DomainError("REVISION_NOT_VARIANT", "That action isn't available here.");
    const set = await requireSet(tx, userId, variant.setId);
    await resolveWorkingCopy(tx, userId, set, input.working_copy_resolution, input.anchor_first_name, "pick");
    const number = await nextAnchorNumber(tx, set.id);
    await tx.update(setRevisions).set({ kind: "anchor", anchorNumber: number, name: input.name.trim(), frozenAt: new Date(), variantState: "picked", updatedAt: new Date() }).where(eq(setRevisions.id, variant.id));
    const { cardIds, bitIds } = await freezeInto(tx, userId, set, variant.id, variant.id);
    await tx.update(setRevisions).set({ variantState: "unpicked" }).where(and(eq(setRevisions.forkGroupId, variant.forkGroupId!), eq(setRevisions.kind, "variant"), eq(setRevisions.variantState, "open")));
    const anchor = await requireRevision(tx, userId, variant.id);
    await resetWorkingTo(tx, set.id, anchor);
    for (const c of cardIds) await logCardEvent(tx, { userId, cardId: c, type: "anchored", refType: "set", refId: set.id, label: `${set.name} v${number}` });
    const group = await tx.query.setForkGroups.findFirst({ where: eq(setForkGroups.id, variant.forkGroupId!) });
    const [{ siblings }] = await tx.select({ siblings: sql<number>`count(*)::int` }).from(setRevisions).where(eq(setRevisions.forkGroupId, variant.forkGroupId!));
    await track(tx, userId, "set_variant_picked", { variant_count_in_group: siblings, position_of_inserted_bit: group?.insertedBitId ? bitIds.indexOf(group.insertedBitId) : null });
    return set.id;
  });
  const setDto = await getSet(userId, setId);
  return { anchor: await revisionDTO(db, userId, await requireRevision(db, userId, revisionId)), set: setDto };
}

export async function restoreAnchor(userId: string, revisionId: string, input: { working_copy_resolution?: "anchor_first" | "discard"; anchor_first_name?: string }) {
  const db = getDb();
  const setId = await db.transaction(async (tx) => {
    const anchor = await requireRevision(tx, userId, revisionId);
    if (anchor.kind !== "anchor") throw new DomainError("REVISION_NOT_ANCHOR", "That action isn't available here.");
    const set = await requireSet(tx, userId, anchor.setId);
    await resolveWorkingCopy(tx, userId, set, input.working_copy_resolution, input.anchor_first_name, "restore");
    await resetWorkingTo(tx, set.id, anchor);
    // Bring the anchor's transitions back into the live library for pairs it had.
    const frozen = await frozenFor(tx, anchor.id);
    for (const t of frozen.values()) {
      await tx.insert(setTransitions).values({ setId: set.id, userId, fromBitId: t.fromBitId, toBitId: t.toBitId, kind: t.kind, text: t.text, callbackToCardId: t.callbackToCardId }).onConflictDoUpdate({ target: [setTransitions.setId, setTransitions.fromBitId, setTransitions.toBitId], set: { kind: t.kind, text: t.text, callbackToCardId: t.callbackToCardId } });
    }
    return set.id;
  });
  const working = await workingOf(db, setId);
  return { working: await revisionDTO(db, userId, working, { includeScript: true }) };
}

/** For M14: list positions a bench bit could take in the working copy. */
export async function insertPositions(userId: string, setId: string, bitId: string) {
  const db = getDb();
  await requireSet(db, userId, setId);
  const bit = await requireBit(db, userId, bitId);
  const working = await workingOf(db, setId);
  const ids = await revisionBitIds(db, working.id);
  const rows = ids.length ? await db.select({ id: bits.id, name: bits.name }).from(bits).where(inArray(bits.id, ids)) : [];
  const names = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  return { bit: { id: bit.id, name: bit.name }, positions: generateInsertVariants(ids, bit.id, names).map((v, i) => ({ index: i, description: v.description })) };
}

void performanceDTO;
