// Performances and per-bit marks (F-21, Rule 7.10).
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { bits, performanceMarks, performances, setRevisionItems, setRevisions, sets, type Performance } from "@/db/schema";
import { DomainError, notFound } from "@/server/errors";
import type { PerformanceDTO } from "@/types/dto";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { cardIdsInPerformance, cardIdsInRevisionBit, recomputeCardStatus } from "./status";
import { logCardEvent, track } from "./events";

const ACTIVE_WINDOW_MS = 12 * 3600_000;

export async function requirePerformance(db: DbOrTx, userId: string, id: string): Promise<Performance> {
  const row = await db.query.performances.findFirst({ where: and(eq(performances.id, id), eq(performances.userId, userId)) });
  if (!row) throw notFound("That performance");
  return row;
}

export async function activePerformanceFor(db: DbOrTx, userId: string, setId: string): Promise<Performance | null> {
  const row = await db.query.performances.findFirst({
    where: and(eq(performances.userId, userId), eq(performances.setId, setId), gt(performances.createdAt, new Date(Date.now() - ACTIVE_WINDOW_MS))),
    orderBy: desc(performances.createdAt),
  });
  return row ?? null;
}

export async function performanceDTO(db: DbOrTx, _userId: string, p: Performance): Promise<PerformanceDTO> {
  const set = (await db.query.sets.findFirst({ where: eq(sets.id, p.setId) }))!;
  const rev = (await db.query.setRevisions.findFirst({ where: eq(setRevisions.id, p.revisionId) }))!;
  const items = await db
    .select({ bitId: setRevisionItems.bitId, position: setRevisionItems.position, snapshot: setRevisionItems.bitSnapshot, name: bits.name })
    .from(setRevisionItems)
    .leftJoin(bits, eq(bits.id, setRevisionItems.bitId))
    .where(eq(setRevisionItems.revisionId, p.revisionId))
    .orderBy(setRevisionItems.position);
  const marks = await db.select().from(performanceMarks).where(eq(performanceMarks.performanceId, p.id));
  const nameOf = (bitId: string) => {
    const it = items.find((i) => i.bitId === bitId);
    return it?.snapshot?.name ?? it?.name ?? "Bit";
  };
  return {
    id: p.id,
    set_id: p.setId,
    set_name: set.name,
    revision_id: p.revisionId,
    anchor_number: rev.anchorNumber ?? 0,
    anchor_name: rev.name,
    performed_on: p.performedOn,
    venue_label: p.venueLabel,
    notes: p.notes,
    marks: marks.map((m) => ({ bit_id: m.bitId, bit_name: nameOf(m.bitId), position: m.position, result: m.result, note: m.note })).sort((a, b) => a.position - b.position),
    bits: items.map((i) => ({ bit_id: i.bitId, bit_name: i.snapshot?.name ?? i.name ?? "Bit", position: i.position })),
    is_active: Date.now() - p.createdAt.getTime() < ACTIVE_WINDOW_MS,
    created_at: p.createdAt.toISOString(),
  };
}

export async function listPerformances(userId: string, q: { set_id?: string; limit: number; cursor?: string }) {
  const db = getDb();
  const conds = [eq(performances.userId, userId)];
  if (q.set_id) conds.push(eq(performances.setId, q.set_id));
  if (q.cursor) {
    const c = decodeCursor<{ d: string; c: string }>(q.cursor);
    if (!c) throw new DomainError("INVALID_CURSOR", "Invalid cursor.");
    conds.push(or(lt(performances.performedOn, c.d), and(eq(performances.performedOn, c.d), lt(performances.createdAt, new Date(c.c))))!);
  }
  const rows = await db.select().from(performances).where(and(...conds)).orderBy(desc(performances.performedOn), desc(performances.createdAt)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const items: PerformanceDTO[] = [];
  for (const p of page) items.push(await performanceDTO(db, userId, p));
  const last = page[page.length - 1];
  return { items, next_cursor: rows.length > q.limit && last ? encodeCursor({ d: last.performedOn, c: last.createdAt.toISOString() }) : null };
}

export async function getPerformance(userId: string, id: string) {
  const db = getDb();
  return performanceDTO(db, userId, await requirePerformance(db, userId, id));
}

export async function createPerformance(userId: string, input: { set_id: string; revision_id?: string; anchor_working_copy_as?: string; performed_on: string; venue_label?: string; notes?: string }) {
  const db = getDb();
  const { createAnchor } = await import("./sets");
  let revisionId = input.revision_id;
  if (input.anchor_working_copy_as) {
    const { anchor } = await createAnchor(userId, input.set_id, input.anchor_working_copy_as);
    revisionId = anchor.id;
  }
  const id = await db.transaction(async (tx) => {
    const set = await tx.query.sets.findFirst({ where: and(eq(sets.id, input.set_id), eq(sets.userId, userId)) });
    if (!set) throw notFound("That set");
    const rev = await tx.query.setRevisions.findFirst({ where: and(eq(setRevisions.id, revisionId!), eq(setRevisions.setId, set.id)) });
    if (!rev) throw notFound("That version of the set");
    if (rev.kind !== "anchor") throw new DomainError("REVISION_NOT_ANCHOR", "Performances are logged against an anchor.");
    const [p] = await tx.insert(performances).values({ userId, setId: set.id, revisionId: rev.id, performedOn: input.performed_on, venueLabel: input.venue_label?.trim() || null, notes: input.notes ?? "" }).returning();
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(setRevisionItems).where(eq(setRevisionItems.revisionId, rev.id));
    await track(tx, userId, "performance_logged", { bit_count: n });
    return p.id;
  });
  return getPerformance(userId, id);
}

export async function patchPerformance(userId: string, id: string, patch: { performed_on?: string; venue_label?: string | null; notes?: string }) {
  const db = getDb();
  await requirePerformance(db, userId, id);
  await db.update(performances).set({ performedOn: patch.performed_on, venueLabel: patch.venue_label === undefined ? undefined : patch.venue_label?.trim() || null, notes: patch.notes }).where(eq(performances.id, id));
  if (patch.performed_on) {
    const cardIds = await cardIdsInPerformance(db, id);
    await recomputeCardStatus(db, userId, cardIds);
  }
  return getPerformance(userId, id);
}

export async function deletePerformance(userId: string, id: string) {
  const db = getDb();
  await requirePerformance(db, userId, id);
  await db.transaction(async (tx) => {
    const cardIds = await cardIdsInPerformance(tx, id);
    await tx.delete(performances).where(eq(performances.id, id));
    await recomputeCardStatus(tx, userId, cardIds);
  });
}

export async function putMark(userId: string, performanceId: string, bitId: string, input: { result: "landed" | "flat" | "cut"; note?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const p = await requirePerformance(tx, userId, performanceId);
    const item = await tx.query.setRevisionItems.findFirst({ where: and(eq(setRevisionItems.revisionId, p.revisionId), eq(setRevisionItems.bitId, bitId)) });
    if (!item) throw new DomainError("BIT_NOT_IN_REVISION", "That bit wasn't in this version of the set.");
    await tx
      .insert(performanceMarks)
      .values({ performanceId, userId, bitId, position: item.position, result: input.result, note: input.note?.trim() || null })
      .onConflictDoUpdate({ target: [performanceMarks.performanceId, performanceMarks.bitId], set: { result: input.result, note: input.note === undefined ? sql`${performanceMarks.note}` : input.note.trim() || null, updatedAt: new Date() } });
    const cardIds = await cardIdsInRevisionBit(tx, p.revisionId, bitId);
    for (const c of cardIds) await logCardEvent(tx, { userId, cardId: c, type: "performed", refType: "performance", refId: performanceId, payload: { result: input.result } });
    await recomputeCardStatus(tx, userId, cardIds);
    await track(tx, userId, "performance_mark_added", { result: input.result });
    const dto = await performanceDTO(tx, userId, p);
    return { mark: dto.marks.find((m) => m.bit_id === bitId)!, performance: dto };
  });
}

export async function deleteMark(userId: string, performanceId: string, bitId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const p = await requirePerformance(tx, userId, performanceId);
    const cardIds = await cardIdsInRevisionBit(tx, p.revisionId, bitId);
    await tx.delete(performanceMarks).where(and(eq(performanceMarks.performanceId, performanceId), eq(performanceMarks.bitId, bitId)));
    await recomputeCardStatus(tx, userId, cardIds);
  });
}

/** Recent venue labels for M17 chips. */
export async function recentVenues(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.selectDistinct({ v: performances.venueLabel }).from(performances).where(and(eq(performances.userId, userId), sql`${performances.venueLabel} is not null`)).limit(8);
  return rows.map((r) => r.v!).filter(Boolean);
}
