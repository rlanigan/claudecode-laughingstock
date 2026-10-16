// Cards: capture, list, edit, actions, parts, subjects, themes, detach/split/combine.
import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lt, notExists, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import {
  bitItems,
  bits,
  boardItems,
  boards,
  cardCounters,
  cardLinks,
  cardParts,
  cardSubjectTags,
  cardThemes,
  cardVersions,
  cards,
  performances,
  setRevisionItems,
  setRevisions,
  sets,
  subjectTags,
  themes,
  type Card,
  type CardVersion,
} from "@/db/schema";
import { DomainError, limitReached, notFound } from "@/server/errors";
import { splitTitle, wordCount } from "@/domain/title-split";
import { normalizeSubjects, MAX_SUBJECTS_PER_CARD } from "@/domain/tags";
import type { CardDTO, CardSummaryDTO, PartDTO, SubjectDTO, ThemeDTO, VersionContext } from "@/types/dto";
import type { CaptureInput, EditCardInput, ListCardsQuery } from "@/lib/validation";
import { bumpCard, getCardRowById, loadCardDTO, loadParts, loadSubjectsFor, loadSummaries, loadThemesFor, refreshSearch, requireCard, requireVersion, versionDTOWithParent } from "@/server/repos/cards";
import { applyTextEdit, forkFrom, pinAllBoards, restoreVersion, sealVersion, type EditContext } from "./versions";
import { logCardEvent, track } from "./events";
import { recomputeCardStatus } from "./status";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { ensureUserBootstrap } from "./users";

// ---------- creation ----------

export async function nextCardNumber(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .update(cardCounters)
    .set({ nextNumber: sql`${cardCounters.nextNumber} + 1` })
    .where(eq(cardCounters.userId, userId))
    .returning({ n: sql<number>`${cardCounters.nextNumber} - 1` });
  if (!rows.length) {
    await ensureUserBootstrap(db, userId);
    return nextCardNumber(db, userId);
  }
  return Number(rows[0].n);
}

export interface NewCardFields {
  kind?: "note" | "joke";
  title: string | null;
  body: string;
  context?: string | null;
  details?: string | null;
  form?: Card["form"];
  formSource?: Card["formSource"];
  captureSource: Card["captureSource"];
  clientId?: string | null;
  capturedAt?: Date;
  inboxState?: "inbox" | "filed";
  laughSize?: Card["laughSize"];
  createdContext: VersionContext;
  createdContextRefId?: string | null;
  createdContextLabel?: string | null;
}

/** Create a card with its v1 in one go. Caller is responsible for transactions. */
export async function createCardWithVersion(db: DbOrTx, userId: string, f: NewCardFields): Promise<{ card: Card; version: CardVersion }> {
  const [{ n: count }] = await db.select({ n: sql<number>`count(*)::int` }).from(cards).where(eq(cards.userId, userId));
  if (count >= 100_000) throw limitReached(100_000, "cards");
  const number = await nextCardNumber(db, userId);
  const [card] = await db
    .insert(cards)
    .values({
      userId,
      number,
      kind: f.kind ?? "note",
      form: f.form ?? null,
      formSource: f.form ? (f.formSource ?? "user") : null,
      status: f.kind === "joke" ? "promoted" : "raw",
      inboxState: f.inboxState ?? "inbox",
      captureSource: f.captureSource,
      clientId: f.clientId ?? null,
      capturedAt: f.capturedAt ?? new Date(),
      laughSize: f.laughSize ?? null,
    })
    .returning();
  const [version] = await db
    .insert(cardVersions)
    .values({
      cardId: card.id,
      userId,
      depth: 1,
      branch: "",
      title: f.title,
      body: f.body,
      context: f.context ?? null,
      details: f.details ?? null,
      createdContext: f.createdContext,
      createdContextRefId: f.createdContextRefId ?? null,
      createdContextLabel: f.createdContextLabel ?? null,
      wordCount: wordCount(f.title, f.body),
    })
    .returning();
  await db.update(cards).set({ currentVersionId: version.id }).where(eq(cards.id, card.id));
  await refreshSearch(db, card.id);
  return { card: { ...card, currentVersionId: version.id }, version };
}

function clampCapturedAt(iso: string | undefined): Date {
  const now = Date.now();
  if (!iso) return new Date(now);
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return new Date(now);
  if (t > now + 5 * 60_000 || t < now - 30 * 24 * 3600_000) return new Date(now);
  return new Date(t);
}

export async function captureCard(userId: string, input: CaptureInput): Promise<{ card: CardDTO; created: boolean }> {
  const db = getDb();
  if (input.client_id) {
    const existing = await db.query.cards.findFirst({ where: and(eq(cards.userId, userId), eq(cards.clientId, input.client_id)) });
    if (existing) return { card: await loadCardDTO(db, userId, existing), created: false };
  }
  let title: string | null;
  let body: string;
  if (input.text !== undefined) ({ title, body } = splitTitle(input.text));
  else {
    title = input.title?.trim() || null;
    body = (input.body ?? "").trim();
  }
  if (!`${title ?? ""}${body}`.trim()) throw new DomainError("VALIDATION_ERROR", "Write something first.", [{ path: "text", message: "Write something first." }]);
  const { names, invalid } = normalizeSubjects(input.subjects);
  if (invalid.length) throw new DomainError("TAG_INVALID", "Tags can use letters, numbers, spaces and hyphens (max 40).", { invalid });
  if (names.length > MAX_SUBJECTS_PER_CARD) throw new DomainError("TAG_LIMIT", "A card can have up to 20 tags.");

  const card = await db.transaction(async (tx) => {
    const { card, version } = await createCardWithVersion(tx, userId, {
      kind: input.kind,
      title,
      body,
      context: input.context?.trim() || null,
      details: input.details?.trim() || null,
      form: input.form ?? null,
      captureSource: input.capture_source,
      clientId: input.client_id ?? null,
      capturedAt: clampCapturedAt(input.captured_at),
      inboxState: input.kind === "joke" ? "filed" : "inbox",
      createdContext: input.capture_source === "import" ? "import" : "capture",
    });
    if (names.length) await linkSubjects(tx, userId, card.id, names, "user");
    await logCardEvent(tx, { userId, cardId: card.id, type: "captured", versionId: version.id, payload: { source: input.capture_source } });
    await track(tx, userId, "card_captured", {
      source: input.capture_source,
      has_title: !!title,
      has_context: !!input.context,
      has_details: !!input.details,
      form_set: !!input.form,
      subject_count: names.length,
    });
    return card;
  });
  // The transaction returned a card row whose version id is set; reload to be safe.
  const fresh = (await getCardRowById(db, userId, card.id))!;
  return { card: await loadCardDTO(db, userId, fresh), created: true };
}

// ---------- listing ----------

export async function listCards(userId: string, q: ListCardsQuery): Promise<{ items: CardSummaryDTO[]; next_cursor: string | null; total_estimate: number }> {
  const db = getDb();
  const where: SQL[] = [eq(cards.userId, userId)];
  if (q.view === "inbox") where.push(eq(cards.inboxState, "inbox"), isNull(cards.killedAt));
  else if (q.view === "killed") where.push(isNotNull(cards.killedAt));
  else where.push(isNull(cards.killedAt));
  if (q.kind) where.push(eq(cards.kind, q.kind));
  if (q.form) where.push(inArray(cards.form, q.form.split(",").filter(Boolean) as NonNullable<Card["form"]>[]));
  if (q.status) where.push(inArray(cards.status, q.status.split(",").filter(Boolean) as Card["status"][]));
  if (q.source) where.push(eq(cards.captureSource, q.source));
  if (q.since) {
    const since = q.since === "today" ? sql`date_trunc('day', now())` : q.since === "7d" ? sql`now() - interval '7 days'` : q.since === "30d" ? sql`now() - interval '30 days'` : sql`${q.since}::timestamptz`;
    where.push(sql`${cards.capturedAt} >= ${since}`);
  }
  if (q.untagged === "true") where.push(notExists(db.select({ x: sql`1` }).from(cardSubjectTags).where(eq(cardSubjectTags.cardId, cards.id))));
  if (q.on_board === "true") where.push(exists(db.select({ x: sql`1` }).from(boardItems).where(eq(boardItems.cardId, cards.id))));
  if (q.on_board === "false") where.push(notExists(db.select({ x: sql`1` }).from(boardItems).where(eq(boardItems.cardId, cards.id))));
  if (q.subject) {
    const names = q.subject.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (names.length)
      where.push(
        exists(
          db
            .select({ x: sql`1` })
            .from(cardSubjectTags)
            .innerJoin(subjectTags, eq(subjectTags.id, cardSubjectTags.tagId))
            .where(and(eq(cardSubjectTags.cardId, cards.id), inArray(subjectTags.name, names))),
        ),
      );
  }
  if (q.theme) {
    const ids = q.theme.split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    if (ids.length) where.push(exists(db.select({ x: sql`1` }).from(cardThemes).where(and(eq(cardThemes.cardId, cards.id), inArray(cardThemes.themeId, ids)))));
  }
  if (q.q) {
    where.push(sql`(${cards.searchTsv} @@ websearch_to_tsquery('english', ${q.q}) or exists (select 1 from card_versions v where v.id = ${cards.currentVersionId} and (v.body ilike ${"%" + q.q + "%"} or v.title ilike ${"%" + q.q + "%"})))`);
  }

  const sort = q.view === "killed" ? "killed" : q.sort;
  const sortCol = sort === "killed" ? cards.killedAt : sort === "recently_edited" ? cards.updatedAt : cards.capturedAt;
  const dir = sort === "oldest" ? "asc" : "desc";
  let order: SQL[];
  if (sort === "title") {
    order = [sql`lower(coalesce((select v.title from card_versions v where v.id = ${cards.currentVersionId}), (select v.body from card_versions v where v.id = ${cards.currentVersionId}))) asc`, asc(cards.id)];
  } else {
    order = dir === "asc" ? [asc(sortCol), asc(cards.id)] : [desc(sortCol), desc(cards.id)];
  }
  if (q.cursor) {
    const c = decodeCursor<{ v: string; id: string }>(q.cursor);
    if (!c) throw new DomainError("INVALID_CURSOR", "Invalid cursor.");
    if (sort === "title") where.push(gt(cards.id, c.id)); // title sort uses id-only continuation
    else if (dir === "asc") where.push(or(gt(sortCol, new Date(c.v)), and(eq(sortCol, new Date(c.v)), gt(cards.id, c.id)))!);
    else where.push(or(lt(sortCol, new Date(c.v)), and(eq(sortCol, new Date(c.v)), lt(cards.id, c.id)))!);
  }
  const rows = await db
    .select()
    .from(cards)
    .where(and(...where))
    .orderBy(...order)
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const items = await loadSummaries(db, userId, page);
  let next: string | null = null;
  if (rows.length > q.limit) {
    const last = page[page.length - 1];
    const v = sort === "killed" ? last.killedAt : sort === "recently_edited" ? last.updatedAt : last.capturedAt;
    next = encodeCursor({ v: (v ?? new Date()).toISOString(), id: last.id });
  }
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(cards).where(and(...where.filter((_, i) => i < where.length - (q.cursor ? 1 : 0))));
  return { items, next_cursor: next, total_estimate: total };
}

/** Chip counts for D1/P3 (inbox, untagged, this week, on board, jokes, killed, all). */
export async function cardCounts(userId: string) {
  const db = getDb();
  const [r] = await db
    .select({
      all: sql<number>`count(*) filter (where killed_at is null)::int`,
      inbox: sql<number>`count(*) filter (where killed_at is null and inbox_state = 'inbox')::int`,
      untagged: sql<number>`count(*) filter (where killed_at is null and not exists (select 1 from card_subject_tags t where t.card_id = cards.id))::int`,
      week: sql<number>`count(*) filter (where killed_at is null and captured_at >= now() - interval '7 days')::int`,
      phone: sql<number>`count(*) filter (where killed_at is null and inbox_state = 'inbox' and capture_source = 'phone')::int`,
      on_board: sql<number>`count(*) filter (where killed_at is null and exists (select 1 from board_items b where b.card_id = cards.id))::int`,
      jokes: sql<number>`count(*) filter (where killed_at is null and kind = 'joke')::int`,
      killed: sql<number>`count(*) filter (where killed_at is not null)::int`,
    })
    .from(cards)
    .where(eq(cards.userId, userId));
  return r;
}

export async function getCard(userId: string, number: number): Promise<CardDTO> {
  const db = getDb();
  return loadCardDTO(db, userId, await requireCard(db, userId, number));
}

// ---------- editing ----------

async function resolveContext(db: DbOrTx, userId: string, card: Card, input: EditCardInput): Promise<{ ctx: EditContext; target: CardVersion }> {
  const type = input.context.type;
  const id = input.context.id ?? null;
  if (type === "board") {
    if (!id) throw notFound("That board");
    const item = await db.query.boardItems.findFirst({ where: and(eq(boardItems.boardId, id), eq(boardItems.cardId, card.id), eq(boardItems.userId, userId)) });
    if (!item) throw notFound("That board item");
    const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
    const target = (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, item.pinnedVersionId) }))!;
    return { ctx: { type: "board", refId: id, label: `Board ${board?.name ?? ""}`.trim(), container: { kind: "board_item", id: item.id } }, target };
  }
  if (type === "bit" || type === "set") {
    if (!id) throw notFound("That bit");
    const item = await db.query.bitItems.findFirst({ where: and(eq(bitItems.bitId, id), eq(bitItems.cardId, card.id), eq(bitItems.userId, userId)) });
    if (!item) throw notFound("That bit item");
    const bit = await db.query.bits.findFirst({ where: eq(bits.id, id) });
    const target = (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, item.pinnedVersionId!) }))!;
    let label = `Bit ${bit?.name ?? ""}`.trim();
    if (type === "set") {
      const setRow = await db
        .select({ name: sets.name })
        .from(setRevisionItems)
        .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), eq(setRevisions.kind, "working")))
        .innerJoin(sets, eq(sets.id, setRevisions.setId))
        .where(eq(setRevisionItems.bitId, id))
        .limit(1);
      label = `Set ${setRow[0]?.name ?? ""}`.trim();
    }
    return { ctx: { type, refId: id, label, container: { kind: "bit_item", id: item.id } }, target };
  }
  if (type === "lineage") {
    if (!input.version_label) throw notFound("That version");
    const target = await requireVersion(db, card.id, input.version_label);
    return { ctx: { type: "lineage", refId: null, label: "Lineage", container: null }, target };
  }
  const current = (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) }))!;
  const effective: VersionContext = card.inboxState === "inbox" ? "inbox" : "review";
  return { ctx: { type: effective, refId: null, label: effective === "inbox" ? "Inbox" : "Review", container: null }, target: current };
}

export async function editCard(userId: string, number: number, input: EditCardInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, number);
    if (card.rev !== input.rev) {
      const current = await loadCardDTO(tx, userId, card);
      throw new DomainError("CONFLICT", "This card changed on another device.", { current });
    }
    // Non-edit fields.
    const cardPatch: Partial<typeof cards.$inferInsert> = {};
    if (input.form !== undefined) {
      cardPatch.form = input.form;
      cardPatch.formSource = input.form ? "user" : null;
    }
    if (input.laugh_size !== undefined) cardPatch.laughSize = input.laugh_size;
    if (Object.keys(cardPatch).length) {
      await tx.update(cards).set(cardPatch).where(eq(cards.id, card.id));
      if (input.form !== undefined) await logCardEvent(tx, { userId, cardId: card.id, type: "form_set", payload: { form: input.form } });
    }
    const { ctx, target } = await resolveContext(tx, userId, card, input);
    const patch: { title?: string | null; body?: string; context?: string | null; details?: string | null } = {};
    if (input.text !== undefined) Object.assign(patch, splitTitle(input.text));
    if (input.title !== undefined) patch.title = input.title?.trim() || null;
    if (input.body !== undefined) patch.body = input.body;
    if (input.context_text !== undefined) patch.context = input.context_text?.trim() || null;
    if (input.details !== undefined) patch.details = input.details?.trim() || null;
    let version = target;
    let createdNew = false;
    const hasTextPatch = Object.keys(patch).length > 0;
    if (input.save_as_new_version && !hasTextPatch) {
      await sealVersion(tx, target.id);
    } else if (hasTextPatch) {
      ({ version, createdNew } = await applyTextEdit(tx, userId, card, target, patch, ctx, { forceNew: !!input.save_as_new_version }));
    } else if (Object.keys(cardPatch).length) {
      await bumpCard(tx, card.id);
    }
    const fresh = (await getCardRowById(tx, userId, card.id))!;
    const dto = await loadCardDTO(tx, userId, fresh);
    const versionDto = await versionDTOWithParent(tx, (await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, version.id) }))!);
    return { card: dto, version: versionDto, created_new_version: createdNew };
  });
}

// ---------- actions ----------

async function reloadDTO(db: DbOrTx, userId: string, cardId: string) {
  return loadCardDTO(db, userId, (await getCardRowById(db, userId, cardId))!);
}

export async function fileCard(db: DbOrTx, userId: string, card: Card, event: "kept" | "added_to_board" | "seeded_in_workshop" | "added_to_bit" | null, ref?: { refType: "board" | "bit" | "session"; refId: string; label?: string }) {
  if (card.inboxState === "inbox") await db.update(cards).set({ inboxState: "filed", updatedAt: new Date() }).where(eq(cards.id, card.id));
  if (event) await logCardEvent(db, { userId, cardId: card.id, type: event, refType: ref?.refType ?? null, refId: ref?.refId ?? null, label: ref?.label ?? null });
}

export async function keepCard(userId: string, number: number) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  await db.transaction((tx) => fileCard(tx, userId, card, "kept"));
  return reloadDTO(db, userId, card.id);
}

export async function returnToInbox(userId: string, number: number) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  if (card.killedAt) throw new DomainError("CARD_KILLED", "Restore this card first.");
  await db.transaction(async (tx) => {
    await tx.update(cards).set({ inboxState: "inbox", updatedAt: new Date() }).where(eq(cards.id, card.id));
    await logCardEvent(tx, { userId, cardId: card.id, type: "returned_to_inbox" });
  });
  return reloadDTO(db, userId, card.id);
}

export async function killCard(userId: string, number: number) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  if (!card.killedAt) {
    await db.transaction(async (tx) => {
      await tx.update(cards).set({ killedAt: new Date(), status: "killed", updatedAt: new Date() }).where(eq(cards.id, card.id));
      await logCardEvent(tx, { userId, cardId: card.id, type: "killed" });
      await track(tx, userId, "card_killed", {});
    });
  }
  return reloadDTO(db, userId, card.id);
}

export async function restoreCard(userId: string, number: number) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  if (card.killedAt) {
    await db.transaction(async (tx) => {
      await tx.update(cards).set({ killedAt: null, updatedAt: new Date() }).where(eq(cards.id, card.id));
      await recomputeCardStatus(tx, userId, [card.id]);
      await logCardEvent(tx, { userId, cardId: card.id, type: "restored" });
    });
  }
  return reloadDTO(db, userId, card.id);
}

export async function deleteCardForever(userId: string, number: number) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  if (!card.killedAt) throw new DomainError("CARD_NOT_KILLED", "Kill the card before deleting it.");
  const history = await db.execute(sql`
    select s.name as set_name, r.anchor_number
    from set_revision_items ri
    join set_revisions r on r.id = ri.revision_id and r.kind = 'anchor'
    join sets s on s.id = r.set_id
    cross join lateral jsonb_array_elements(coalesce(ri.bit_snapshot->'items','[]'::jsonb)) j
    where j->>'card_id' = ${card.id} limit 1`);
  const h = (history as unknown as { set_name: string; anchor_number: number }[])[0];
  if (h) throw new DomainError("CARD_IN_HISTORY", `This card is part of set history (${h.set_name} v${h.anchor_number}). Keep it killed instead.`);
  const inBits = await db.select({ name: bits.name }).from(bitItems).innerJoin(bits, eq(bits.id, bitItems.bitId)).where(eq(bitItems.cardId, card.id));
  if (inBits.length) throw new DomainError("CARD_IN_BIT", `Remove it from ${inBits.map((b) => b.name).join(", ")} first.`);
  await db.transaction(async (tx) => {
    // Clear the circular FK before cascading deletes.
    await tx.update(cards).set({ currentVersionId: null }).where(eq(cards.id, card.id));
    await tx.delete(cards).where(eq(cards.id, card.id));
    await track(tx, userId, "card_deleted_forever", {});
  });
}

// ---------- parts ----------

export async function addPart(userId: string, number: number, input: { kind: PartDTO["kind"]; body: string; position?: number }): Promise<PartDTO> {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  return db.transaction(async (tx) => {
    const existing = await loadParts(tx, card.id);
    if (existing.length >= 100) throw limitReached(100, "parts on one card");
    const position = input.position ?? existing.length;
    await tx.update(cardParts).set({ position: sql`${cardParts.position} + 1` }).where(and(eq(cardParts.cardId, card.id), sql`${cardParts.position} >= ${position}`));
    const [p] = await tx.insert(cardParts).values({ cardId: card.id, userId, createdOnVersionId: card.currentVersionId, kind: input.kind, body: input.body, position }).returning();
    await logCardEvent(tx, { userId, cardId: card.id, type: "part_added", versionId: card.currentVersionId, payload: { kind: input.kind } });
    await refreshSearch(tx, card.id);
    await bumpCard(tx, card.id);
    await track(tx, userId, "card_part_added", { kind: input.kind });
    const v = await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) });
    return { id: p.id, kind: p.kind, body: p.body, position: p.position, created_on_version_label: v?.label ?? null };
  });
}

async function requirePart(db: DbOrTx, userId: string, id: string) {
  const p = await db.query.cardParts.findFirst({ where: and(eq(cardParts.id, id), eq(cardParts.userId, userId)) });
  if (!p) throw notFound("That part");
  return p;
}

export async function patchPart(userId: string, id: string, input: { body?: string; kind?: PartDTO["kind"] }): Promise<PartDTO> {
  const db = getDb();
  const p = await requirePart(db, userId, id);
  const [u] = await db.update(cardParts).set({ body: input.body ?? p.body, kind: input.kind ?? p.kind }).where(eq(cardParts.id, id)).returning();
  await refreshSearch(db, p.cardId);
  await bumpCard(db, p.cardId);
  const parts = await loadParts(db, p.cardId);
  return parts.find((x) => x.id === u.id)!;
}

export async function deletePart(userId: string, id: string) {
  const db = getDb();
  const p = await requirePart(db, userId, id);
  await db.delete(cardParts).where(eq(cardParts.id, id));
  await db.update(cardParts).set({ position: sql`${cardParts.position} - 1` }).where(and(eq(cardParts.cardId, p.cardId), sql`${cardParts.position} > ${p.position}`));
  await refreshSearch(db, p.cardId);
  await bumpCard(db, p.cardId);
}

export async function reorderParts(userId: string, number: number, partIds: string[]): Promise<PartDTO[]> {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  const existing = await loadParts(db, card.id);
  const ids = new Set(existing.map((p) => p.id));
  if (partIds.length !== ids.size || !partIds.every((id) => ids.has(id))) throw new DomainError("ORDER_MISMATCH", "Part list doesn't match.");
  await db.transaction(async (tx) => {
    for (let i = 0; i < partIds.length; i++) await tx.update(cardParts).set({ position: i }).where(eq(cardParts.id, partIds[i]));
    await bumpCard(tx, card.id);
  });
  return loadParts(db, card.id);
}

// ---------- subjects ----------

export async function linkSubjects(db: DbOrTx, userId: string, cardId: string, names: string[], source: "user" | "suggestion" | "inherited") {
  for (const name of names) {
    const [tag] = await db.insert(subjectTags).values({ userId, name }).onConflictDoNothing().returning();
    const tagRow = tag ?? (await db.query.subjectTags.findFirst({ where: and(eq(subjectTags.userId, userId), eq(subjectTags.name, name)) }))!;
    await db.insert(cardSubjectTags).values({ cardId, tagId: tagRow.id, source }).onConflictDoNothing();
  }
}

export async function setCardSubjects(userId: string, number: number, rawNames: string[]): Promise<SubjectDTO[]> {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  const { names, invalid } = normalizeSubjects(rawNames);
  if (invalid.length) throw new DomainError("TAG_INVALID", "Tags can use letters, numbers, spaces and hyphens (max 40).", { invalid });
  if (names.length > MAX_SUBJECTS_PER_CARD) throw new DomainError("TAG_LIMIT", "A card can have up to 20 tags.");
  await db.transaction(async (tx) => {
    const before = (await loadSubjectsFor(tx, [card.id])).get(card.id) ?? [];
    const beforeNames = new Set(before.map((s) => s.name));
    const removed = before.filter((s) => !names.includes(s.name));
    if (removed.length) await tx.delete(cardSubjectTags).where(and(eq(cardSubjectTags.cardId, card.id), inArray(cardSubjectTags.tagId, removed.map((r) => r.id))));
    const added = names.filter((n) => !beforeNames.has(n));
    if (added.length) await linkSubjects(tx, userId, card.id, added, "user");
    if (added.length) await logCardEvent(tx, { userId, cardId: card.id, type: "tagged", payload: { count: added.length } });
    if (removed.length) await logCardEvent(tx, { userId, cardId: card.id, type: "untagged", payload: { count: removed.length } });
    if (added.length) await track(tx, userId, "card_tagged", { count: added.length });
    await bumpCard(tx, card.id);
  });
  return (await loadSubjectsFor(db, [card.id])).get(card.id) ?? [];
}

// ---------- themes on a card ----------

export async function setCardThemes(userId: string, number: number, themeIds: string[]): Promise<ThemeDTO[]> {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  const valid = themeIds.length ? await db.select({ id: themes.id }).from(themes).where(and(eq(themes.userId, userId), inArray(themes.id, themeIds))) : [];
  const validIds = new Set(valid.map((v) => v.id));
  await db.transaction(async (tx) => {
    const current = await tx.select().from(cardThemes).where(and(eq(cardThemes.cardId, card.id), eq(cardThemes.source, "user")));
    const keep = new Set([...validIds]);
    for (const row of current) if (!keep.has(row.themeId)) {
      await tx.delete(cardThemes).where(and(eq(cardThemes.cardId, card.id), eq(cardThemes.themeId, row.themeId)));
      await logCardEvent(tx, { userId, cardId: card.id, type: "theme_removed", payload: { theme_id: row.themeId } });
    }
    for (const id of keep) {
      const r = await tx.insert(cardThemes).values({ cardId: card.id, themeId: id, source: "user" }).onConflictDoNothing().returning();
      if (r.length) await logCardEvent(tx, { userId, cardId: card.id, type: "theme_added", payload: { theme_id: id } });
    }
    await bumpCard(tx, card.id);
  });
  return (await loadThemesFor(db, [card.id])).get(card.id) ?? [];
}

// ---------- versions ----------

export async function versionAction(userId: string, number: number, mode: "fork" | "restore" | "seal", fromLabel: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, number);
    const from = await requireVersion(tx, card.id, fromLabel);
    let v: CardVersion = from;
    if (mode === "fork") v = await forkFrom(tx, userId, card, from);
    else if (mode === "restore") v = await restoreVersion(tx, userId, card, from);
    else await sealVersion(tx, from.id);
    const fresh = (await getCardRowById(tx, userId, card.id))!;
    return { card: await loadCardDTO(tx, userId, fresh), version: await versionDTOWithParent(tx, (await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, v.id) }))!), created: mode !== "seal" };
  });
}

export async function pinVersion(userId: string, number: number, label: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, number);
    const v = await requireVersion(tx, card.id, label);
    const n = await pinAllBoards(tx, userId, card, v);
    return { updated_board_items: n };
  });
}

// ---------- detach / split / combine ----------

async function inheritTagsAndThemes(db: DbOrTx, userId: string, fromCardId: string, toCardId: string) {
  const subs = (await loadSubjectsFor(db, [fromCardId])).get(fromCardId) ?? [];
  for (const s of subs) await db.insert(cardSubjectTags).values({ cardId: toCardId, tagId: s.id, source: "inherited" }).onConflictDoNothing();
  const ths = (await loadThemesFor(db, [fromCardId])).get(fromCardId) ?? [];
  for (const t of ths) await db.insert(cardThemes).values({ cardId: toCardId, themeId: t.id, source: "inherited" }).onConflictDoNothing();
  void userId;
}

async function swapInContainer(db: DbOrTx, userId: string, container: { type: "board" | "bit"; id: string } | undefined, oldCardId: string, newCards: { card: Card; version: CardVersion }[]) {
  if (!container) return;
  if (container.type === "board") {
    const item = await db.query.boardItems.findFirst({ where: and(eq(boardItems.boardId, container.id), eq(boardItems.cardId, oldCardId), eq(boardItems.userId, userId)) });
    if (!item) return;
    const [first, ...rest] = newCards;
    await db.update(boardItems).set({ cardId: first.card.id, pinnedVersionId: first.version.id }).where(eq(boardItems.id, item.id));
    let dx = 0;
    for (const nc of rest) {
      dx += 210;
      await db.insert(boardItems).values({ boardId: container.id, userId, cardId: nc.card.id, pinnedVersionId: nc.version.id, x: item.x + dx, y: item.y, clusterId: item.clusterId, clusterPosition: item.clusterPosition !== null ? item.clusterPosition + 1 : null }).onConflictDoNothing();
    }
  } else {
    const item = await db.query.bitItems.findFirst({ where: and(eq(bitItems.bitId, container.id), eq(bitItems.cardId, oldCardId), eq(bitItems.userId, userId)) });
    if (!item) return;
    const [first, ...rest] = newCards;
    await db.update(bitItems).set({ cardId: first.card.id, pinnedVersionId: first.version.id }).where(eq(bitItems.id, item.id));
    if (rest.length) {
      await db.update(bitItems).set({ position: sql`${bitItems.position} + ${rest.length}` }).where(and(eq(bitItems.bitId, container.id), sql`${bitItems.position} > ${item.position}`));
      let pos = item.position;
      for (const nc of rest) {
        pos += 1;
        await db.insert(bitItems).values({ bitId: container.id, userId, position: pos, kind: "joke", cardId: nc.card.id, pinnedVersionId: nc.version.id });
      }
    }
  }
}

export async function detachCopy(userId: string, number: number, input: { version_label?: string; container?: { type: "board" | "bit"; id: string } }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, number);
    const from = input.version_label ? await requireVersion(tx, card.id, input.version_label) : (await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) }))!;
    const created = await createCardWithVersion(tx, userId, { kind: card.kind, title: from.title, body: from.body, context: from.context, details: from.details, form: card.form, formSource: card.form ? "user" : undefined, captureSource: "desktop", inboxState: "filed", createdContext: "lineage", createdContextLabel: "Detached copy" });
    await tx.insert(cardLinks).values({ userId, relation: "detached_from", sourceCardId: card.id, sourceVersionId: from.id, derivedCardId: created.card.id, derivedVersionId: created.version.id });
    await inheritTagsAndThemes(tx, userId, card.id, created.card.id);
    await swapInContainer(tx, userId, input.container, card.id, [created]);
    await logCardEvent(tx, { userId, cardId: card.id, type: "detached", versionId: from.id, refType: "card", refId: created.card.id });
    await logCardEvent(tx, { userId, cardId: created.card.id, type: "captured", versionId: created.version.id, payload: { detached_from: card.number } });
    return loadCardDTO(tx, userId, (await getCardRowById(tx, userId, created.card.id))!);
  });
}

export async function splitCard(userId: string, number: number, input: { version_label?: string; split_at: number; container?: { type: "board" | "bit"; id: string } }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, number);
    const from = input.version_label ? await requireVersion(tx, card.id, input.version_label) : (await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) }))!;
    const a = from.body.slice(0, input.split_at).trim();
    const b = from.body.slice(input.split_at).trim();
    if (!a || !b) throw new DomainError("SPLIT_INVALID", "Both cards need some text.");
    const mk = (body: string, title: string | null) =>
      createCardWithVersion(tx, userId, { kind: card.kind, title, body, context: from.context, details: from.details, form: card.form, formSource: card.form ? "user" : undefined, captureSource: "desktop", inboxState: "filed", createdContext: "lineage", createdContextLabel: "Split" });
    const first = await mk(a, from.title);
    const second = await mk(b, null);
    for (const nc of [first, second]) {
      await tx.insert(cardLinks).values({ userId, relation: "split_from", sourceCardId: card.id, sourceVersionId: from.id, derivedCardId: nc.card.id, derivedVersionId: nc.version.id });
      await inheritTagsAndThemes(tx, userId, card.id, nc.card.id);
      await logCardEvent(tx, { userId, cardId: nc.card.id, type: "captured", versionId: nc.version.id, payload: { split_from: card.number } });
    }
    await swapInContainer(tx, userId, input.container, card.id, [first, second]);
    await logCardEvent(tx, { userId, cardId: card.id, type: "split", versionId: from.id });
    return [await loadCardDTO(tx, userId, (await getCardRowById(tx, userId, first.card.id))!), await loadCardDTO(tx, userId, (await getCardRowById(tx, userId, second.card.id))!)];
  });
}

export async function combineCards(userId: string, numbers: number[], title?: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const sources: { card: Card; version: CardVersion }[] = [];
    for (const n of numbers) {
      const card = await requireCard(tx, userId, n);
      const version = (await tx.query.cardVersions.findFirst({ where: eq(cardVersions.id, card.currentVersionId!) }))!;
      sources.push({ card, version });
    }
    const body = sources.map((s) => (s.version.title ? `${s.version.title}\n${s.version.body}` : s.version.body)).join("\n\n");
    const created = await createCardWithVersion(tx, userId, { title: title?.trim() || null, body, captureSource: "desktop", inboxState: "filed", createdContext: "lineage", createdContextLabel: "Combined" });
    for (const s of sources) {
      await tx.insert(cardLinks).values({ userId, relation: "combined_from", sourceCardId: s.card.id, sourceVersionId: s.version.id, derivedCardId: created.card.id, derivedVersionId: created.version.id });
      await inheritTagsAndThemes(tx, userId, s.card.id, created.card.id);
      await logCardEvent(tx, { userId, cardId: s.card.id, type: "combined", versionId: s.version.id, refType: "card", refId: created.card.id });
    }
    await logCardEvent(tx, { userId, cardId: created.card.id, type: "captured", versionId: created.version.id, payload: { combined_from: numbers } });
    return loadCardDTO(tx, userId, (await getCardRowById(tx, userId, created.card.id))!);
  });
}

// ---------- today strip ----------

export async function todayCards(userId: string, tzOffsetMinutes: number): Promise<CardSummaryDTO[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), isNull(cards.killedAt), sql`(${cards.capturedAt} - make_interval(mins => ${tzOffsetMinutes}))::date = (now() - make_interval(mins => ${tzOffsetMinutes}))::date`))
    .orderBy(desc(cards.capturedAt))
    .limit(50);
  return loadSummaries(db, userId, rows);
}

void performances;
