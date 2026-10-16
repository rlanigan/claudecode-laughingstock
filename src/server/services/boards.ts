// Boards and clusters (F-11, Rules 7.7 and 7.14).
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { bitItems, bits, boardClusters, boardItems, boards, cardSubjectTags, cardThemes, cardVersions, cards, setRevisionItems, setRevisions, sets, subjectTags, type Board, type BoardCluster, type BoardItem } from "@/db/schema";
import { DomainError, limitReached, notFound } from "@/server/errors";
import { CANVAS_MAX, CARD_H, CARD_W, clamp, landingSlot, placeBesideTarget, tidyLayout } from "@/domain/board-geometry";
import type { BoardClusterDTO, BoardDTO, BoardItemDTO, BoardSummaryDTO } from "@/types/dto";
import { loadSummaries, requireCard } from "@/server/repos/cards";
import { fileCard } from "./cards";
import { logCardEvent, track } from "./events";
import { attachTheme, ensureTheme } from "./tags";
import { createBitFromCards } from "./bits";

export async function requireBoard(db: DbOrTx, userId: string, id: string): Promise<Board> {
  const row = await db.query.boards.findFirst({ where: and(eq(boards.id, id), eq(boards.userId, userId)) });
  if (!row) throw notFound("That board");
  return row;
}

async function requireItem(db: DbOrTx, userId: string, id: string): Promise<BoardItem> {
  const row = await db.query.boardItems.findFirst({ where: and(eq(boardItems.id, id), eq(boardItems.userId, userId)) });
  if (!row) throw notFound("That card isn't on this board");
  return row;
}

async function requireCluster(db: DbOrTx, userId: string, id: string): Promise<BoardCluster> {
  const row = await db.query.boardClusters.findFirst({ where: and(eq(boardClusters.id, id), eq(boardClusters.userId, userId)) });
  if (!row) throw notFound("That cluster");
  return row;
}

export async function listBoards(userId: string, archived = false): Promise<BoardSummaryDTO[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      updatedAt: boards.updatedAt,
      archivedAt: boards.archivedAt,
      cardCount: sql<number>`(select count(*) from board_items bi join cards c on c.id = bi.card_id where bi.board_id = boards.id and c.killed_at is null)::int`,
      clusterCount: sql<number>`(select count(*) from board_clusters bc where bc.board_id = boards.id)::int`,
    })
    .from(boards)
    .where(and(eq(boards.userId, userId), archived ? sql`${boards.archivedAt} is not null` : isNull(boards.archivedAt)))
    .orderBy(asc(boards.position), asc(boards.name));
  return rows.map((r) => ({ id: r.id, name: r.name, card_count: r.cardCount, cluster_count: r.clusterCount, updated_at: r.updatedAt.toISOString(), archived: r.archivedAt !== null }));
}

export async function createBoard(userId: string, name: string) {
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(boards).where(eq(boards.userId, userId));
  if (n >= 200) throw limitReached(200, "boards");
  const clash = await db.query.boards.findFirst({ where: and(eq(boards.userId, userId), sql`lower(btrim(${boards.name})) = lower(btrim(${name}))`) });
  if (clash) throw new DomainError("NAME_TAKEN", `You already have one called '${clash.name}'.`);
  const [row] = await db.insert(boards).values({ userId, name: name.trim(), position: n }).returning();
  return summaryOf(row, 0, 0);
}

const summaryOf = (b: Board, cardCount: number, clusterCount: number): BoardSummaryDTO => ({ id: b.id, name: b.name, card_count: cardCount, cluster_count: clusterCount, updated_at: b.updatedAt.toISOString(), archived: b.archivedAt !== null });

export async function patchBoard(userId: string, id: string, patch: { name?: string; position?: number; archived?: boolean }) {
  const db = getDb();
  await requireBoard(db, userId, id);
  if (patch.name !== undefined) {
    const clash = await db.query.boards.findFirst({ where: and(eq(boards.userId, userId), ne(boards.id, id), sql`lower(btrim(${boards.name})) = lower(btrim(${patch.name}))`) });
    if (clash) throw new DomainError("NAME_TAKEN", `You already have one called '${clash.name}'.`);
  }
  const [row] = await db
    .update(boards)
    .set({ name: patch.name?.trim(), position: patch.position, archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null })
    .where(eq(boards.id, id))
    .returning();
  return summaryOf(row, 0, 0);
}

export async function deleteBoard(userId: string, id: string) {
  const db = getDb();
  const b = await requireBoard(db, userId, id);
  if (!b.archivedAt) throw new DomainError("ARCHIVE_FIRST", "Archive the board before deleting it.");
  await db.delete(boards).where(eq(boards.id, id));
}

export async function getBoard(userId: string, id: string, db: DbOrTx = getDb()): Promise<BoardDTO> {
  const board = await requireBoard(db, userId, id);
  const itemRows = await db
    .select({ item: boardItems, card: cards, pinnedLabel: cardVersions.label, pinnedBody: cardVersions.body, pinnedTitle: cardVersions.title })
    .from(boardItems)
    .innerJoin(cards, eq(cards.id, boardItems.cardId))
    .innerJoin(cardVersions, eq(cardVersions.id, boardItems.pinnedVersionId))
    .where(eq(boardItems.boardId, id))
    .orderBy(asc(boardItems.createdAt));
  const summaries = new Map((await loadSummaries(db, userId, itemRows.map((r) => r.card))).map((s) => [s.id, s]));
  const items: BoardItemDTO[] = itemRows.map((r) => ({
    id: r.item.id,
    card: summaries.get(r.card.id)!,
    pinned_version_label: r.pinnedLabel!,
    latest_version_label: summaries.get(r.card.id)!.current_version_label,
    pinned_body: r.pinnedBody,
    pinned_title: r.pinnedTitle,
    x: r.item.x,
    y: r.item.y,
    cluster_id: r.item.clusterId,
    cluster_position: r.item.clusterPosition,
  }));
  const clusterRows = await db.select().from(boardClusters).where(eq(boardClusters.boardId, id)).orderBy(asc(boardClusters.createdAt));
  const clusters: BoardClusterDTO[] = [];
  for (const c of clusterRows) clusters.push(await clusterDTO(db, c, items.filter((i) => i.cluster_id === c.id)));
  const trayRows = await db.select().from(cards).where(and(eq(cards.userId, userId), eq(cards.inboxState, "inbox"), isNull(cards.killedAt))).orderBy(desc(cards.capturedAt)).limit(40);
  const tray = await loadSummaries(db, userId, trayRows);
  const [{ trayTotal }] = await db.select({ trayTotal: sql<number>`count(*)::int` }).from(cards).where(and(eq(cards.userId, userId), eq(cards.inboxState, "inbox"), isNull(cards.killedAt)));
  return { board: { id: board.id, name: board.name, archived: board.archivedAt !== null, updated_at: board.updatedAt.toISOString() }, items, clusters, tray, tray_total: trayTotal };
}

async function clusterDTO(db: DbOrTx, c: BoardCluster, members: BoardItemDTO[]): Promise<BoardClusterDTO> {
  const counts = new Map<string, number>();
  for (const m of members) for (const s of m.card.subjects) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const cardIds = members.map((m) => m.card.id);
  const used: BoardClusterDTO["used_in"] = [];
  if (cardIds.length) {
    const bitRows = await db
      .select({ id: bits.id, name: bits.name, n: sql<number>`count(distinct ${bitItems.cardId})::int` })
      .from(bitItems)
      .innerJoin(bits, eq(bits.id, bitItems.bitId))
      .where(and(inArray(bitItems.cardId, cardIds), isNull(bits.archivedAt)))
      .groupBy(bits.id, bits.name);
    for (const b of bitRows) used.push({ type: "bit", id: b.id, name: b.name, count: b.n });
    const setRows = await db
      .select({ id: sets.id, name: sets.name, n: sql<number>`count(distinct ${bitItems.cardId})::int` })
      .from(bitItems)
      .innerJoin(setRevisionItems, eq(setRevisionItems.bitId, bitItems.bitId))
      .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), eq(setRevisions.kind, "working")))
      .innerJoin(sets, eq(sets.id, setRevisions.setId))
      .where(inArray(bitItems.cardId, cardIds))
      .groupBy(sets.id, sets.name);
    for (const s of setRows) used.push({ type: "set", id: s.id, name: s.name, count: s.n });
  }
  return {
    id: c.id,
    name: c.name,
    use_as_theme: c.useAsTheme,
    theme_id: c.themeId,
    member_count: members.length,
    aggregated_subjects: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    used_in: used,
  };
}

function occupiedRects(items: { x: number; y: number }[]) {
  return items.map((i) => ({ x: i.x, y: i.y, w: CARD_W, h: CARD_H }));
}

export async function addItem(userId: string, boardId: string, input: { card_number: number; x?: number; y?: number }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const board = await requireBoard(tx, userId, boardId);
    const card = await requireCard(tx, userId, input.card_number);
    if (card.killedAt) throw new DomainError("CARD_KILLED", "Restore this card first.");
    const existing = await tx.query.boardItems.findFirst({ where: and(eq(boardItems.boardId, boardId), eq(boardItems.cardId, card.id)) });
    if (existing) throw new DomainError("ALREADY_ON_BOARD", `Already on ${board.name}.`, { item_id: existing.id });
    const others = await tx.select({ x: boardItems.x, y: boardItems.y }).from(boardItems).where(eq(boardItems.boardId, boardId));
    if (others.length >= 1000) throw limitReached(1000, "cards on one board");
    const pos = input.x !== undefined && input.y !== undefined ? { x: clamp(input.x), y: clamp(input.y) } : landingSlot(occupiedRects(others));
    const [item] = await tx.insert(boardItems).values({ boardId, userId, cardId: card.id, pinnedVersionId: card.currentVersionId!, x: pos.x, y: pos.y }).returning();
    await fileCard(tx, userId, card, "added_to_board", { refType: "board", refId: boardId, label: board.name });
    await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
    await track(tx, userId, "card_sent_to_board", {});
    return itemDTO(tx, userId, item);
  });
}

async function itemDTO(db: DbOrTx, userId: string, item: BoardItem): Promise<BoardItemDTO> {
  const card = (await db.query.cards.findFirst({ where: eq(cards.id, item.cardId) }))!;
  const [summary] = await loadSummaries(db, userId, [card]);
  const v = (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, item.pinnedVersionId) }))!;
  return { id: item.id, card: summary, pinned_version_label: v.label!, latest_version_label: summary.current_version_label, pinned_body: v.body, pinned_title: v.title, x: item.x, y: item.y, cluster_id: item.clusterId, cluster_position: item.clusterPosition };
}

async function nextClusterPosition(db: DbOrTx, clusterId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(cluster_position), -1) + 1` }).from(boardItems).where(eq(boardItems.clusterId, clusterId));
  return Number(n);
}

/** Rule 7.7: attach/detach the cluster theme to a member. */
async function syncClusterTheme(db: DbOrTx, userId: string, cluster: BoardCluster, cardId: string, joining: boolean) {
  if (!cluster.themeId) return;
  if (joining) await attachTheme(db, userId, cardId, cluster.themeId, "cluster", cluster.id);
  else {
    const r = await db.delete(cardThemes).where(and(eq(cardThemes.cardId, cardId), eq(cardThemes.themeId, cluster.themeId), eq(cardThemes.source, "cluster"), eq(cardThemes.sourceRefId, cluster.id))).returning();
    if (r.length) await logCardEvent(db, { userId, cardId, type: "theme_removed", payload: { theme_id: cluster.themeId, source: "cluster" } });
  }
}

async function deleteClusterIfEmpty(db: DbOrTx, clusterId: string): Promise<string | null> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(boardItems).where(eq(boardItems.clusterId, clusterId));
  if (n === 0) {
    await db.delete(boardClusters).where(eq(boardClusters.id, clusterId));
    return clusterId;
  }
  return null;
}

export async function patchItem(userId: string, itemId: string, patch: { x?: number; y?: number; cluster_id?: string | null; cluster_position?: number; use_latest?: true; cluster_with_item_id?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    let item = await requireItem(tx, userId, itemId);
    let deletedClusterId: string | null = null;
    let createdClusterId: string | null = null;
    const set: Partial<typeof boardItems.$inferInsert> = {};
    if (patch.x !== undefined) set.x = clamp(patch.x);
    if (patch.y !== undefined) set.y = clamp(patch.y);
    if (patch.use_latest) {
      const card = (await tx.query.cards.findFirst({ where: eq(cards.id, item.cardId) }))!;
      set.pinnedVersionId = card.currentVersionId!;
      await logCardEvent(tx, { userId, cardId: item.cardId, type: "pin_changed", versionId: card.currentVersionId, refType: "board", refId: item.boardId });
    }
    if (patch.cluster_with_item_id) {
      const target = await requireItem(tx, userId, patch.cluster_with_item_id);
      if (target.boardId !== item.boardId) throw notFound("That card isn't on this board");
      if (target.clusterId) {
        patch.cluster_id = target.clusterId;
      } else {
        const [cluster] = await tx.insert(boardClusters).values({ boardId: item.boardId, userId }).returning();
        createdClusterId = cluster.id;
        await tx.update(boardItems).set({ clusterId: cluster.id, clusterPosition: 0 }).where(eq(boardItems.id, target.id));
        const p = placeBesideTarget({ x: target.x, y: target.y, w: CARD_W, h: CARD_H });
        set.x = p.x;
        set.y = p.y;
        patch.cluster_id = cluster.id;
        await track(tx, userId, "board_cluster_created", { size: 2 });
      }
    }
    if (patch.cluster_id !== undefined && patch.cluster_id !== item.clusterId) {
      if (item.clusterId) {
        const old = await requireCluster(tx, userId, item.clusterId);
        await syncClusterTheme(tx, userId, old, item.cardId, false);
      }
      if (patch.cluster_id === null) {
        set.clusterId = null;
        set.clusterPosition = null;
      } else {
        const cluster = await requireCluster(tx, userId, patch.cluster_id);
        if (cluster.boardId !== item.boardId) throw notFound("That cluster");
        set.clusterId = cluster.id;
        set.clusterPosition = patch.cluster_position ?? (await nextClusterPosition(tx, cluster.id));
        await syncClusterTheme(tx, userId, cluster, item.cardId, true);
      }
    } else if (patch.cluster_position !== undefined && item.clusterId) {
      set.clusterPosition = patch.cluster_position;
    }
    if (Object.keys(set).length) {
      [item] = await tx.update(boardItems).set(set).where(eq(boardItems.id, item.id)).returning();
    }
    const oldClusterId = patch.cluster_id !== undefined ? (await requireItem(tx, userId, itemId)).clusterId : null;
    void oldClusterId;
    if (patch.cluster_id !== undefined) {
      const before = await tx.query.boardItems.findFirst({ where: eq(boardItems.id, itemId) });
      void before;
    }
    // Delete any cluster on this board that is now empty.
    const emptyClusters = await tx.execute(sql`select bc.id from board_clusters bc where bc.board_id = ${item.boardId} and not exists (select 1 from board_items bi where bi.cluster_id = bc.id)`);
    for (const r of emptyClusters as unknown as { id: string }[]) deletedClusterId = await deleteClusterIfEmpty(tx, r.id);
    await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, item.boardId));
    const dto = await itemDTO(tx, userId, item);
    return { item: dto, deleted_cluster_id: deletedClusterId, created_cluster_id: createdClusterId };
  });
}

export async function removeItem(userId: string, itemId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const item = await requireItem(tx, userId, itemId);
    if (item.clusterId) {
      const c = await requireCluster(tx, userId, item.clusterId);
      await syncClusterTheme(tx, userId, c, item.cardId, false);
    }
    await tx.delete(boardItems).where(eq(boardItems.id, itemId));
    if (item.clusterId) await deleteClusterIfEmpty(tx, item.clusterId);
    const board = await requireBoard(tx, userId, item.boardId);
    await logCardEvent(tx, { userId, cardId: item.cardId, type: "removed_from_board", refType: "board", refId: item.boardId, label: board.name });
  });
}

export async function createCluster(userId: string, boardId: string, itemIds: string[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await requireBoard(tx, userId, boardId);
    const items = await tx.select().from(boardItems).where(and(eq(boardItems.boardId, boardId), inArray(boardItems.id, itemIds)));
    if (items.length !== itemIds.length) throw new DomainError("VALIDATION_ERROR", "Some cards aren't on this board.");
    const [cluster] = await tx.insert(boardClusters).values({ boardId, userId }).returning();
    for (let i = 0; i < itemIds.length; i++) {
      const it = items.find((x) => x.id === itemIds[i])!;
      if (it.clusterId) {
        const old = await requireCluster(tx, userId, it.clusterId);
        await syncClusterTheme(tx, userId, old, it.cardId, false);
      }
      await tx.update(boardItems).set({ clusterId: cluster.id, clusterPosition: i }).where(eq(boardItems.id, itemIds[i]));
    }
    const empties = await tx.execute(sql`select bc.id from board_clusters bc where bc.board_id = ${boardId} and not exists (select 1 from board_items bi where bi.cluster_id = bc.id)`);
    for (const r of empties as unknown as { id: string }[]) await tx.delete(boardClusters).where(eq(boardClusters.id, r.id));
    await track(tx, userId, "board_cluster_created", { size: itemIds.length });
    const members = (await getBoard(userId, boardId, tx)).items.filter((i) => i.cluster_id === cluster.id);
    return clusterDTO(tx, cluster, members);
  });
}

/** Rule 7.7 — cluster naming / theme toggling / member order. */
export async function patchCluster(userId: string, clusterId: string, patch: { name?: string | null; use_as_theme?: boolean; order?: string[] }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    let cluster = await requireCluster(tx, userId, clusterId);
    const memberRows = await tx.select().from(boardItems).where(eq(boardItems.clusterId, clusterId)).orderBy(asc(boardItems.clusterPosition));
    if (patch.order) {
      const ids = new Set(memberRows.map((m) => m.id));
      if (patch.order.length !== ids.size || !patch.order.every((id) => ids.has(id))) throw new DomainError("ORDER_MISMATCH", "Cluster order doesn't match its members.");
      for (let i = 0; i < patch.order.length; i++) await tx.update(boardItems).set({ clusterPosition: i }).where(eq(boardItems.id, patch.order[i]));
    }
    const newName = patch.name !== undefined ? (patch.name?.trim() || null) : cluster.name;
    const newUse = patch.use_as_theme ?? cluster.useAsTheme;
    const shouldHaveTheme = !!newName && newUse;
    let themeId: string | null = cluster.themeId;
    if (shouldHaveTheme) {
      const { theme } = await ensureTheme(tx, userId, newName!, "cluster", cluster.id);
      if (theme.id !== cluster.themeId) {
        for (const m of memberRows) await syncClusterTheme(tx, userId, cluster, m.cardId, false);
        themeId = theme.id;
        const updated = { ...cluster, themeId };
        for (const m of memberRows) await syncClusterTheme(tx, userId, updated, m.cardId, true);
      }
    } else if (cluster.themeId) {
      for (const m of memberRows) await syncClusterTheme(tx, userId, cluster, m.cardId, false);
      themeId = null;
    }
    [cluster] = await tx.update(boardClusters).set({ name: newName, useAsTheme: newUse, themeId }).where(eq(boardClusters.id, clusterId)).returning();
    if (patch.name !== undefined) await track(tx, userId, "cluster_named", { use_as_theme: newUse });
    const board = await getBoard(userId, cluster.boardId, tx);
    return clusterDTO(tx, cluster, board.items.filter((i) => i.cluster_id === cluster.id));
  });
}

export async function deleteCluster(userId: string, clusterId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const cluster = await requireCluster(tx, userId, clusterId);
    const members = await tx.select().from(boardItems).where(eq(boardItems.clusterId, clusterId));
    for (const m of members) await syncClusterTheme(tx, userId, cluster, m.cardId, false);
    await tx.update(boardItems).set({ clusterId: null, clusterPosition: null }).where(eq(boardItems.clusterId, clusterId));
    await tx.delete(boardClusters).where(eq(boardClusters.id, clusterId));
  });
}

export async function tidyBoard(userId: string, boardId: string) {
  const db = getDb();
  await requireBoard(db, userId, boardId);
  const items = await db.select().from(boardItems).where(eq(boardItems.boardId, boardId)).orderBy(asc(boardItems.clusterPosition), asc(boardItems.createdAt));
  const clusterRows = await db.select().from(boardClusters).where(eq(boardClusters.boardId, boardId)).orderBy(asc(boardClusters.createdAt));
  const layout = tidyLayout(
    clusterRows.map((c) => ({ id: c.id, itemIds: items.filter((i) => i.clusterId === c.id).map((i) => i.id) })),
    items.filter((i) => !i.clusterId).map((i) => i.id),
  );
  await db.transaction(async (tx) => {
    for (const [id, p] of Object.entries(layout)) await tx.update(boardItems).set({ x: Math.min(p.x, CANVAS_MAX), y: Math.min(p.y, CANVAS_MAX) }).where(eq(boardItems.id, id));
  });
  return { items: Object.entries(layout).map(([id, p]) => ({ id, ...p })) };
}

/** "Start a bit from this cluster": cards in suggested order, pinned to the board's versions. */
export async function bitFromCluster(userId: string, clusterId: string, name?: string) {
  const db = getDb();
  const cluster = await requireCluster(db, userId, clusterId);
  const members = await db.select().from(boardItems).where(eq(boardItems.clusterId, clusterId)).orderBy(asc(boardItems.clusterPosition));
  if (!members.length) throw new DomainError("CLUSTER_EMPTY", "This cluster has no cards.");
  return createBitFromCards(userId, name?.trim() || cluster.name || "Untitled bit", members.map((m) => ({ cardId: m.cardId, versionId: m.pinnedVersionId })), cluster.id);
}

void subjectTags;
void cardSubjectTags;
