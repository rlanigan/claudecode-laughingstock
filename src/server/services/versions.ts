// Rule 7.2 — versioning engine shared by every editing context.
import { and, eq, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { bitItems, boardItems, cardVersions, cards, type Card, type CardVersion } from "@/db/schema";
import { contextLabel, nextBranch, shouldEditInPlace, shouldIncrementEditCount } from "@/domain/versioning";
import { wordCount } from "@/domain/title-split";
import { DomainError, limitReached } from "@/server/errors";
import type { VersionContext } from "@/types/dto";
import { bumpCard, refreshSearch } from "@/server/repos/cards";
import { logCardEvent, logEditedEventThrottled } from "./events";

export interface EditContext {
  type: VersionContext;
  /** board id / bit id / session id / null */
  refId: string | null;
  /** Human label, e.g. "Board Travel". */
  label?: string | null;
  /** The container item (board item or bit item) the edit is made from; its pin moves. */
  container?: { kind: "board_item" | "bit_item"; id: string } | null;
}

export interface TextPatch {
  title?: string | null;
  body?: string;
  context?: string | null;
  details?: string | null;
  changeNote?: string | null;
}

async function usedBranchesAtDepth(db: DbOrTx, cardId: string, depth: number): Promise<Set<string>> {
  const rows = await db.select({ branch: cardVersions.branch }).from(cardVersions).where(and(eq(cardVersions.cardId, cardId), eq(cardVersions.depth, depth)));
  return new Set(rows.map((r) => r.branch));
}

async function hasChildren(db: DbOrTx, versionId: string): Promise<boolean> {
  const row = await db.query.cardVersions.findFirst({ where: eq(cardVersions.parentVersionId, versionId), columns: { id: true } });
  return !!row;
}

async function pinnedByOthers(db: DbOrTx, versionId: string, container: EditContext["container"]): Promise<boolean> {
  const b = await db
    .select({ id: boardItems.id })
    .from(boardItems)
    .where(and(eq(boardItems.pinnedVersionId, versionId), container?.kind === "board_item" ? ne(boardItems.id, container.id) : sql`true`))
    .limit(1);
  if (b.length) return true;
  const i = await db
    .select({ id: bitItems.id })
    .from(bitItems)
    .where(and(eq(bitItems.pinnedVersionId, versionId), container?.kind === "bit_item" ? ne(bitItems.id, container.id) : sql`true`))
    .limit(1);
  return i.length > 0;
}

export async function countVersions(db: DbOrTx, cardId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(cardVersions).where(eq(cardVersions.cardId, cardId));
  return n;
}

/** Create a child version of `parent` with the given fields. Does not touch pins or current. */
export async function createChildVersion(
  db: DbOrTx,
  userId: string,
  card: Card,
  parent: CardVersion,
  fields: { title: string | null; body: string; context: string | null; details: string | null; changeNote?: string | null },
  ctx: EditContext,
  now: Date = new Date(),
): Promise<CardVersion> {
  if ((await countVersions(db, card.id)) >= 500) throw limitReached(500, "versions on one card");
  const used = await usedBranchesAtDepth(db, card.id, parent.depth + 1);
  const { depth, branch } = nextBranch(parent.depth, parent.branch, used);
  const [v] = await db
    .insert(cardVersions)
    .values({
      cardId: card.id,
      userId,
      parentVersionId: parent.id,
      depth,
      branch,
      title: fields.title,
      body: fields.body,
      context: fields.context,
      details: fields.details,
      createdContext: ctx.type,
      createdContextRefId: ctx.refId,
      createdContextLabel: ctx.label ?? contextLabel(ctx.type),
      changeNote: fields.changeNote ?? null,
      editCount: 1,
      wordCount: wordCount(fields.title, fields.body),
      lastEditedAt: now,
      createdAt: now,
    })
    .returning();
  return v;
}

/**
 * Apply a text edit to `target` in the given context. Returns the version that now holds the
 * text and whether it is new. Moves the editing container's pin and `cards.current_version_id`.
 */
export async function applyTextEdit(
  db: DbOrTx,
  userId: string,
  card: Card,
  target: CardVersion,
  patch: TextPatch,
  ctx: EditContext,
  opts: { forceNew?: boolean; now?: Date } = {},
): Promise<{ version: CardVersion; createdNew: boolean }> {
  const now = opts.now ?? new Date();
  const next = {
    title: patch.title !== undefined ? patch.title : target.title,
    body: patch.body !== undefined ? patch.body : target.body,
    context: patch.context !== undefined ? patch.context : target.context,
    details: patch.details !== undefined ? patch.details : target.details,
  };
  if (!`${next.title ?? ""}${next.body}`.trim()) throw new DomainError("VALIDATION_ERROR", "A card needs some text.");
  const unchanged = next.title === target.title && next.body === target.body && next.context === target.context && next.details === target.details;
  if (unchanged && !opts.forceNew) return { version: target, createdNew: false };

  const inPlace =
    !opts.forceNew &&
    shouldEditInPlace(
      {
        sealed: target.sealedAt !== null,
        hasChildren: await hasChildren(db, target.id),
        pinnedByOtherContainers: await pinnedByOthers(db, target.id, ctx.container ?? null),
        cardInInbox: card.inboxState === "inbox",
        versionContext: target.createdContext,
        versionContextRef: target.createdContextRefId,
        lastEditedAt: target.lastEditedAt,
      },
      ctx.type,
      ctx.refId,
      now,
    );

  let version: CardVersion;
  if (inPlace) {
    const [v] = await db
      .update(cardVersions)
      .set({
        ...next,
        wordCount: wordCount(next.title, next.body),
        lastEditedAt: now,
        editCount: shouldIncrementEditCount(target.lastEditedAt, now) ? target.editCount + 1 : target.editCount,
      })
      .where(eq(cardVersions.id, target.id))
      .returning();
    version = v;
    await logEditedEventThrottled(db, userId, card.id, version.id);
  } else {
    version = await createChildVersion(db, userId, card, target, { ...next, changeNote: patch.changeNote ?? null }, ctx, now);
    await logCardEvent(db, { userId, cardId: card.id, type: "version_created", versionId: version.id, refType: refTypeFor(ctx.type), refId: ctx.refId, label: version.createdContextLabel });
  }
  await movePinsAndCurrent(db, card.id, version.id, ctx);
  await bumpCard(db, card.id);
  await refreshSearch(db, card.id);
  return { version, createdNew: !inPlace };
}

function refTypeFor(t: VersionContext): "board" | "bit" | "set" | "session" | null {
  if (t === "board") return "board";
  if (t === "bit") return "bit";
  if (t === "set") return "set";
  if (t === "workshop") return "session";
  return null;
}

async function movePinsAndCurrent(db: DbOrTx, cardId: string, versionId: string, ctx: EditContext) {
  await db.update(cards).set({ currentVersionId: versionId }).where(eq(cards.id, cardId));
  if (ctx.container?.kind === "board_item") await db.update(boardItems).set({ pinnedVersionId: versionId }).where(eq(boardItems.id, ctx.container.id));
  if (ctx.container?.kind === "bit_item") await db.update(bitItems).set({ pinnedVersionId: versionId }).where(eq(bitItems.id, ctx.container.id));
}

/** Rule V7 — fork from a version: identical text as a child, becomes current. */
export async function forkFrom(db: DbOrTx, userId: string, card: Card, from: CardVersion): Promise<CardVersion> {
  const v = await createChildVersion(db, userId, card, from, { title: from.title, body: from.body, context: from.context, details: from.details, changeNote: `Forked from ${from.label}` }, { type: "lineage", refId: null, label: "Lineage" });
  await db.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, card.id));
  await bumpCard(db, card.id);
  await refreshSearch(db, card.id);
  await logCardEvent(db, { userId, cardId: card.id, type: "version_created", versionId: v.id, label: "Lineage" });
  return v;
}

/** Rule V7 — restore vK: child of the current version with K's text. */
export async function restoreVersion(db: DbOrTx, userId: string, card: Card, from: CardVersion): Promise<CardVersion> {
  const current = (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) }))!;
  const v = await createChildVersion(db, userId, card, current, { title: from.title, body: from.body, context: from.context, details: from.details, changeNote: `Restored from ${from.label}` }, { type: "lineage", refId: null, label: "Lineage" });
  await db.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, card.id));
  await bumpCard(db, card.id);
  await refreshSearch(db, card.id);
  await logCardEvent(db, { userId, cardId: card.id, type: "version_created", versionId: v.id, label: "Lineage", payload: { restored_from: from.label } });
  return v;
}

export async function sealVersion(db: DbOrTx, versionId: string) {
  await db.update(cardVersions).set({ sealedAt: sql`coalesce(${cardVersions.sealedAt}, now())` }).where(eq(cardVersions.id, versionId));
}

export async function sealVersions(db: DbOrTx, versionIds: string[]) {
  for (const id of new Set(versionIds)) await sealVersion(db, id);
}

/** Push vN to every board item of the card. */
export async function pinAllBoards(db: DbOrTx, userId: string, card: Card, version: CardVersion): Promise<number> {
  const rows = await db.update(boardItems).set({ pinnedVersionId: version.id }).where(eq(boardItems.cardId, card.id)).returning({ id: boardItems.id, boardId: boardItems.boardId });
  for (const r of rows) await logCardEvent(db, { userId, cardId: card.id, type: "pin_changed", versionId: version.id, refType: "board", refId: r.boardId });
  await bumpCard(db, card.id);
  return rows.length;
}
