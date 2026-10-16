// Bits (F-16): ordered jokes and bridges on one premise.
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { bitItems, bits, boardClusters, boardItems, cards, performanceMarks, performances, setRevisionItems, setRevisions, sets, type Bit } from "@/db/schema";
import { DomainError, limitReached, notFound } from "@/server/errors";
import type { BitDTO, BitItemDTO, BitSummaryDTO } from "@/types/dto";
import { loadSummaries, requireCard, versionToDTO } from "@/server/repos/cards";
import { durationFor, loadBitItems, requireBit } from "@/server/repos/bits";
import { fileCard } from "./cards";
import { logCardEvent, track } from "./events";
import { getReadingWpm } from "./users";
import { cardVersions } from "@/db/schema";

const NEW_WINDOW_MS = 7 * 24 * 3600_000;

export async function summarizeBits(db: DbOrTx, userId: string, rows: Bit[]): Promise<BitSummaryDTO[]> {
  const wpm = await getReadingWpm(db, userId);
  const items = await loadBitItems(db, rows.map((b) => b.id));
  return rows.map((b) => {
    const its = items.get(b.id) ?? [];
    return {
      id: b.id,
      name: b.name,
      item_count: its.length,
      joke_count: its.filter((i) => i.kind === "joke").length,
      duration_seconds: durationFor(b, its, wpm),
      created_at: b.createdAt.toISOString(),
      updated_at: b.updatedAt.toISOString(),
      is_new: Date.now() - b.createdAt.getTime() < NEW_WINDOW_MS,
      archived: b.archivedAt !== null,
    };
  });
}

export async function listBits(userId: string, opts: { archived?: boolean; notInSet?: string } = {}): Promise<BitSummaryDTO[]> {
  const db = getDb();
  const conds = [eq(bits.userId, userId), opts.archived ? sql`${bits.archivedAt} is not null` : isNull(bits.archivedAt)];
  if (opts.notInSet) {
    const inSet = db
      .select({ bitId: setRevisionItems.bitId })
      .from(setRevisionItems)
      .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), eq(setRevisions.setId, opts.notInSet), eq(setRevisions.kind, "working")));
    conds.push(notInArray(bits.id, inSet));
  }
  const rows = await db.select().from(bits).where(and(...conds)).orderBy(desc(bits.updatedAt), asc(bits.name));
  return summarizeBits(db, userId, rows);
}

export async function createBitFromCards(userId: string, name: string, members: { cardId: string; versionId: string }[], sourceClusterId: string | null = null): Promise<BitDTO> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [bit] = await tx.insert(bits).values({ userId, name, sourceClusterId }).returning();
    let pos = 0;
    const seen = new Set<string>();
    for (const m of members) {
      if (seen.has(m.cardId)) continue;
      seen.add(m.cardId);
      const card = (await tx.query.cards.findFirst({ where: and(eq(cards.id, m.cardId), eq(cards.userId, userId)) }))!;
      if (card.killedAt) continue;
      await tx.insert(bitItems).values({ bitId: bit.id, userId, position: pos++, kind: "joke", cardId: card.id, pinnedVersionId: m.versionId });
      await fileCard(tx, userId, card, "added_to_bit", { refType: "bit", refId: bit.id, label: bit.name });
    }
    await track(tx, userId, "bit_created", { from: sourceClusterId ? "cluster" : members.length ? "cards" : "empty" });
    return bit.id;
  });
  return getBit(userId, id);
}

export async function createBit(userId: string, input: { name: string; card_numbers?: number[] }): Promise<BitDTO> {
  const db = getDb();
  const members: { cardId: string; versionId: string }[] = [];
  for (const n of input.card_numbers ?? []) {
    const c = await requireCard(db, userId, n);
    members.push({ cardId: c.id, versionId: c.currentVersionId! });
  }
  return createBitFromCards(userId, input.name, members, null);
}

export async function getBit(userId: string, id: string, db: DbOrTx = getDb()): Promise<BitDTO> {
  const bit = await requireBit(db, userId, id);
  const wpm = await getReadingWpm(db, userId);
  const loaded = (await loadBitItems(db, [id])).get(id) ?? [];
  const cardIds = loaded.filter((i) => i.cardId).map((i) => i.cardId!);
  const cardRows = cardIds.length ? await db.select().from(cards).where(inArray(cards.id, cardIds)) : [];
  const summaries = new Map((await loadSummaries(db, userId, cardRows)).map((s) => [s.id, s]));
  const versionRows = loaded.filter((i) => i.pinnedVersionId).length ? await db.select().from(cardVersions).where(inArray(cardVersions.id, loaded.filter((i) => i.pinnedVersionId).map((i) => i.pinnedVersionId!))) : [];
  const vById = new Map(versionRows.map((v) => [v.id, v]));
  const items: BitItemDTO[] = [];
  for (const i of loaded) {
    if (i.kind === "bridge") {
      items.push({ id: i.id, kind: "bridge", position: i.position, bridge_text: i.bridgeText ?? "" });
      continue;
    }
    const v = vById.get(i.pinnedVersionId!)!;
    const editedHere = v.createdContext === "bit" && v.createdContextRefId === id ? v.editCount : 0;
    items.push({ id: i.id, kind: "joke", position: i.position, card: summaries.get(i.cardId!), pinned_version: versionToDTO(v, null), latest_version_label: summaries.get(i.cardId!)?.current_version_label, edited_here_count: editedHere });
  }
  let unplaced: BitDTO["unplaced_from_cluster"] = [];
  let sourceClusterName: string | null = null;
  if (bit.sourceClusterId) {
    const cluster = await db.query.boardClusters.findFirst({ where: eq(boardClusters.id, bit.sourceClusterId) });
    sourceClusterName = cluster?.name ?? null;
    const memberRows = await db
      .select({ c: cards })
      .from(boardItems)
      .innerJoin(cards, eq(cards.id, boardItems.cardId))
      .where(and(eq(boardItems.clusterId, bit.sourceClusterId), isNull(cards.killedAt), cardIds.length ? notInArray(cards.id, cardIds) : sql`true`))
      .orderBy(asc(boardItems.clusterPosition));
    unplaced = await loadSummaries(db, userId, memberRows.map((r) => r.c));
  }
  const setRows = await db
    .select({ setId: sets.id, setName: sets.name, kind: setRevisions.kind, anchorNumber: setRevisions.anchorNumber })
    .from(setRevisionItems)
    .innerJoin(setRevisions, eq(setRevisions.id, setRevisionItems.revisionId))
    .innerJoin(sets, eq(sets.id, setRevisions.setId))
    .where(eq(setRevisionItems.bitId, id));
  const usedMap = new Map<string, BitDTO["used_in_sets"][number]>();
  for (const r of setRows) {
    const u = usedMap.get(r.setId) ?? { id: r.setId, name: r.setName, in_working: false, anchors: [] };
    if (r.kind === "working") u.in_working = true;
    if (r.kind === "anchor" && r.anchorNumber !== null && !u.anchors.includes(r.anchorNumber)) u.anchors.push(r.anchorNumber);
    usedMap.set(r.setId, u);
  }
  const perf = await db
    .select({ performedOn: performances.performedOn, venue: performances.venueLabel, setName: sets.name, anchorNumber: setRevisions.anchorNumber, result: performanceMarks.result })
    .from(performanceMarks)
    .innerJoin(performances, eq(performances.id, performanceMarks.performanceId))
    .innerJoin(sets, eq(sets.id, performances.setId))
    .innerJoin(setRevisions, eq(setRevisions.id, performances.revisionId))
    .where(eq(performanceMarks.bitId, id))
    .orderBy(desc(performances.performedOn));
  return {
    bit: { id: bit.id, name: bit.name, source_cluster_id: bit.sourceClusterId, source_cluster_name: sourceClusterName, duration_override_seconds: bit.durationOverrideSeconds, archived: bit.archivedAt !== null, created_at: bit.createdAt.toISOString(), updated_at: bit.updatedAt.toISOString() },
    items,
    duration_seconds: durationFor(bit, loaded, wpm),
    unplaced_from_cluster: unplaced,
    used_in_sets: [...usedMap.values()],
    performed: perf.map((p) => ({ performed_on: p.performedOn, venue_label: p.venue, set_name: p.setName, anchor_number: p.anchorNumber ?? 0, result: p.result })),
  };
}

export async function patchBit(userId: string, id: string, patch: { name?: string; duration_override_seconds?: number | null; archived?: boolean }) {
  const db = getDb();
  await requireBit(db, userId, id);
  await db
    .update(bits)
    .set({ name: patch.name?.trim(), durationOverrideSeconds: patch.duration_override_seconds, archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null })
    .where(eq(bits.id, id));
  return getBit(userId, id);
}

export async function deleteBit(userId: string, id: string, force = false) {
  const db = getDb();
  await requireBit(db, userId, id);
  const inAnchors = await db.select({ id: setRevisionItems.id }).from(setRevisionItems).innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), eq(setRevisions.kind, "anchor"))).where(eq(setRevisionItems.bitId, id)).limit(1);
  if (inAnchors.length) throw new DomainError("BIT_IN_HISTORY", "This bit is in set history. Archive it instead.");
  const inSets = await db
    .select({ name: sets.name })
    .from(setRevisionItems)
    .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), sql`${setRevisions.kind} <> 'anchor'`))
    .innerJoin(sets, eq(sets.id, setRevisions.setId))
    .where(eq(setRevisionItems.bitId, id));
  if (inSets.length && !force) throw new DomainError("BIT_IN_SETS", `Remove from ${inSets.length} set${inSets.length > 1 ? "s" : ""} and delete?`, { sets: [...new Set(inSets.map((s) => s.name))] });
  await db.transaction(async (tx) => {
    await tx.delete(setRevisionItems).where(eq(setRevisionItems.bitId, id));
    await tx.delete(bits).where(eq(bits.id, id));
  });
}

async function shiftPositions(db: DbOrTx, bitId: string, from: number, delta: number) {
  await db.update(bitItems).set({ position: sql`${bitItems.position} + ${delta}` }).where(and(eq(bitItems.bitId, bitId), sql`${bitItems.position} >= ${from}`));
}

export async function addBitItem(userId: string, bitId: string, input: { kind: "joke"; card_number: number; position?: number } | { kind: "bridge"; bridge_text: string; position?: number }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const bit = await requireBit(tx, userId, bitId);
    const existing = (await loadBitItems(tx, [bitId])).get(bitId) ?? [];
    if (existing.length >= 100) throw limitReached(100, "items in one bit");
    const position = Math.min(input.position ?? existing.length, existing.length);
    await shiftPositions(tx, bitId, position, 1);
    let itemId: string;
    if (input.kind === "joke") {
      const card = await requireCard(tx, userId, input.card_number);
      if (card.killedAt) throw new DomainError("CARD_KILLED", "Restore this card first.");
      if (existing.some((i) => i.cardId === card.id)) {
        await shiftPositions(tx, bitId, position, -1);
        throw new DomainError("ALREADY_IN_BIT", "Already in this bit.");
      }
      const [row] = await tx.insert(bitItems).values({ bitId, userId, position, kind: "joke", cardId: card.id, pinnedVersionId: card.currentVersionId! }).returning();
      itemId = row.id;
      await fileCard(tx, userId, card, "added_to_bit", { refType: "bit", refId: bitId, label: bit.name });
      await track(tx, userId, "card_added_to_bit", {});
    } else {
      const [row] = await tx.insert(bitItems).values({ bitId, userId, position, kind: "bridge", bridgeText: input.bridge_text }).returning();
      itemId = row.id;
    }
    await tx.update(bits).set({ updatedAt: new Date() }).where(eq(bits.id, bitId));
    const dto = await getBit(userId, bitId, tx);
    return { item: dto.items.find((i) => i.id === itemId)!, bit: dto };
  });
}

async function requireBitItem(db: DbOrTx, userId: string, id: string) {
  const row = await db.query.bitItems.findFirst({ where: and(eq(bitItems.id, id), eq(bitItems.userId, userId)) });
  if (!row) throw notFound("That block");
  return row;
}

export async function patchBitItem(userId: string, id: string, patch: { bridge_text?: string; use_latest?: true }) {
  const db = getDb();
  const item = await requireBitItem(db, userId, id);
  if (patch.bridge_text !== undefined) {
    if (item.kind !== "bridge") throw new DomainError("VALIDATION_ERROR", "Joke text is edited through the card.");
    await db.update(bitItems).set({ bridgeText: patch.bridge_text }).where(eq(bitItems.id, id));
  }
  if (patch.use_latest && item.kind === "joke") {
    const card = (await db.query.cards.findFirst({ where: eq(cards.id, item.cardId!) }))!;
    await db.update(bitItems).set({ pinnedVersionId: card.currentVersionId! }).where(eq(bitItems.id, id));
    await logCardEvent(db, { userId, cardId: card.id, type: "pin_changed", versionId: card.currentVersionId, refType: "bit", refId: item.bitId });
  }
  await db.update(bits).set({ updatedAt: new Date() }).where(eq(bits.id, item.bitId));
  const dto = await getBit(userId, item.bitId);
  return { item: dto.items.find((i) => i.id === id)!, bit: dto };
}

export async function removeBitItem(userId: string, id: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const item = await requireBitItem(tx, userId, id);
    await tx.delete(bitItems).where(eq(bitItems.id, id));
    await tx.update(bitItems).set({ position: sql`${bitItems.position} - 1` }).where(and(eq(bitItems.bitId, item.bitId), sql`${bitItems.position} > ${item.position}`));
    if (item.cardId) {
      const bit = await requireBit(tx, userId, item.bitId);
      await logCardEvent(tx, { userId, cardId: item.cardId, type: "removed_from_bit", refType: "bit", refId: item.bitId, label: bit.name });
    }
    await tx.update(bits).set({ updatedAt: new Date() }).where(eq(bits.id, item.bitId));
  });
}

export async function reorderBit(userId: string, bitId: string, itemIds: string[]) {
  const db = getDb();
  await requireBit(db, userId, bitId);
  const existing = (await loadBitItems(db, [bitId])).get(bitId) ?? [];
  const ids = new Set(existing.map((i) => i.id));
  if (itemIds.length !== ids.size || !itemIds.every((id) => ids.has(id))) throw new DomainError("ORDER_MISMATCH", "Block list doesn't match.");
  await db.transaction(async (tx) => {
    for (let i = 0; i < itemIds.length; i++) await tx.update(bitItems).set({ position: i }).where(eq(bitItems.id, itemIds[i]));
    await tx.update(bits).set({ updatedAt: new Date() }).where(eq(bits.id, bitId));
  });
  return getBit(userId, bitId);
}
