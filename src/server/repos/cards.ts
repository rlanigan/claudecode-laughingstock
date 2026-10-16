// User-scoped card loaders and DTO assembly.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import {
  bitItems,
  bits,
  boardItems,
  boards,
  cardParts,
  cardSubjectTags,
  cardThemes,
  cardVersions,
  cards,
  setRevisionItems,
  setRevisions,
  sets,
  subjectTags,
  themes,
  workshopNodes,
  workshopSessionSeeds,
  type Card,
  type CardVersion,
} from "@/db/schema";
import { notFound } from "@/server/errors";
import { displayNumber, displayTitle } from "@/domain/title-split";
import type { CardDTO, CardPlacementsDTO, CardSummaryDTO, PartDTO, SubjectDTO, ThemeDTO, VersionDTO } from "@/types/dto";

export async function getCardRow(db: DbOrTx, userId: string, number: number): Promise<Card | null> {
  const row = await db.query.cards.findFirst({ where: and(eq(cards.userId, userId), eq(cards.number, number)) });
  return row ?? null;
}

export async function getCardRowById(db: DbOrTx, userId: string, id: string): Promise<Card | null> {
  const row = await db.query.cards.findFirst({ where: and(eq(cards.userId, userId), eq(cards.id, id)) });
  return row ?? null;
}

export async function requireCard(db: DbOrTx, userId: string, number: number): Promise<Card> {
  const row = await getCardRow(db, userId, number);
  if (!row) throw notFound("That card");
  return row;
}

export async function requireCardById(db: DbOrTx, userId: string, id: string): Promise<Card> {
  const row = await getCardRowById(db, userId, id);
  if (!row) throw notFound("That card");
  return row;
}

export async function loadVersions(db: DbOrTx, cardId: string): Promise<CardVersion[]> {
  return db.query.cardVersions.findMany({ where: eq(cardVersions.cardId, cardId), orderBy: [asc(cardVersions.depth), asc(cardVersions.branch)] });
}

export async function requireVersion(db: DbOrTx, cardId: string, label: string): Promise<CardVersion> {
  const v = await db.query.cardVersions.findFirst({ where: and(eq(cardVersions.cardId, cardId), eq(cardVersions.label, label)) });
  if (!v) throw notFound("That version");
  return v;
}

export async function getVersionById(db: DbOrTx, id: string): Promise<CardVersion | null> {
  return (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, id) })) ?? null;
}

export function versionToDTO(v: CardVersion, parentLabel: string | null): VersionDTO {
  return {
    id: v.id,
    label: v.label!,
    depth: v.depth,
    branch: v.branch,
    parent_label: parentLabel,
    title: v.title,
    body: v.body,
    context: v.context,
    details: v.details,
    created_context: v.createdContext,
    created_context_label: v.createdContextLabel,
    change_note: v.changeNote,
    edit_count: v.editCount,
    word_count: v.wordCount,
    sealed: v.sealedAt !== null,
    created_at: v.createdAt.toISOString(),
    last_edited_at: v.lastEditedAt.toISOString(),
  };
}

export async function versionDTOWithParent(db: DbOrTx, v: CardVersion): Promise<VersionDTO> {
  let parentLabel: string | null = null;
  if (v.parentVersionId) {
    const p = await getVersionById(db, v.parentVersionId);
    parentLabel = p?.label ?? null;
  }
  return versionToDTO(v, parentLabel);
}

export async function loadSubjectsFor(db: DbOrTx, cardIds: string[]): Promise<Map<string, SubjectDTO[]>> {
  const out = new Map<string, SubjectDTO[]>();
  if (!cardIds.length) return out;
  const rows = await db
    .select({ cardId: cardSubjectTags.cardId, id: subjectTags.id, name: subjectTags.name })
    .from(cardSubjectTags)
    .innerJoin(subjectTags, eq(subjectTags.id, cardSubjectTags.tagId))
    .where(inArray(cardSubjectTags.cardId, cardIds))
    .orderBy(asc(subjectTags.name));
  for (const r of rows) {
    const l = out.get(r.cardId) ?? [];
    l.push({ id: r.id, name: r.name });
    out.set(r.cardId, l);
  }
  return out;
}

export async function loadThemesFor(db: DbOrTx, cardIds: string[]): Promise<Map<string, ThemeDTO[]>> {
  const out = new Map<string, ThemeDTO[]>();
  if (!cardIds.length) return out;
  const rows = await db
    .select({ cardId: cardThemes.cardId, id: themes.id, name: themes.name, source: themes.source })
    .from(cardThemes)
    .innerJoin(themes, eq(themes.id, cardThemes.themeId))
    .where(inArray(cardThemes.cardId, cardIds))
    .orderBy(asc(themes.name));
  for (const r of rows) {
    const l = out.get(r.cardId) ?? [];
    if (!l.some((t) => t.id === r.id)) l.push({ id: r.id, name: r.name, source: r.source });
    out.set(r.cardId, l);
  }
  return out;
}

/** "↳ Tight 5" when the card's bits are in one set's working copy, "↳ N sets" when more. */
export async function loadUsageLabels(db: DbOrTx, cardIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!cardIds.length) return out;
  const rows = await db
    .selectDistinct({ cardId: bitItems.cardId, setId: sets.id, setName: sets.name })
    .from(bitItems)
    .innerJoin(setRevisionItems, eq(setRevisionItems.bitId, bitItems.bitId))
    .innerJoin(setRevisions, and(eq(setRevisions.id, setRevisionItems.revisionId), eq(setRevisions.kind, "working")))
    .innerJoin(sets, eq(sets.id, setRevisions.setId))
    .where(inArray(bitItems.cardId, cardIds));
  const bySet = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  for (const r of rows) {
    const s = bySet.get(r.cardId!) ?? new Set();
    s.add(r.setId);
    bySet.set(r.cardId!, s);
    names.set(r.setId, r.setName);
  }
  for (const id of cardIds) {
    const s = bySet.get(id);
    if (!s || s.size === 0) out.set(id, null);
    else if (s.size === 1) out.set(id, `↳ ${names.get([...s][0])}`);
    else out.set(id, `↳ ${s.size} sets`);
  }
  return out;
}

export async function loadSummaries(db: DbOrTx, _userId: string, rows: Card[]): Promise<CardSummaryDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const versionIds = rows.map((r) => r.currentVersionId!).filter(Boolean);
  const versions = versionIds.length ? await db.query.cardVersions.findMany({ where: inArray(cardVersions.id, versionIds) }) : [];
  const vById = new Map(versions.map((v) => [v.id, v]));
  const [subjects, themeMap, usage] = await Promise.all([loadSubjectsFor(db, ids), loadThemesFor(db, ids), loadUsageLabels(db, ids)]);
  return rows.map((c) => {
    const v = vById.get(c.currentVersionId!);
    const body = v?.body ?? "";
    return {
      id: c.id,
      number: c.number,
      display_number: displayNumber(c.number),
      display_title: displayTitle(v?.title ?? null, body),
      body_excerpt: body.length > 200 ? `${body.slice(0, 200)}…` : body,
      body,
      title: v?.title ?? null,
      kind: c.kind,
      form: c.form,
      form_inferred: c.formSource === "inferred",
      status: c.status,
      inbox_state: c.inboxState,
      capture_source: c.captureSource,
      captured_at: c.capturedAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
      killed_at: c.killedAt?.toISOString() ?? null,
      current_version_label: v?.label ?? "v1",
      subjects: subjects.get(c.id) ?? [],
      themes: themeMap.get(c.id) ?? [],
      usage_label: usage.get(c.id) ?? null,
    };
  });
}

export async function loadParts(db: DbOrTx, cardId: string): Promise<PartDTO[]> {
  const rows = await db
    .select({ id: cardParts.id, kind: cardParts.kind, body: cardParts.body, position: cardParts.position, label: cardVersions.label })
    .from(cardParts)
    .leftJoin(cardVersions, eq(cardVersions.id, cardParts.createdOnVersionId))
    .where(eq(cardParts.cardId, cardId))
    .orderBy(asc(cardParts.position), asc(cardParts.createdAt));
  return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, position: r.position, created_on_version_label: r.label ?? null }));
}

export async function loadPlacements(db: DbOrTx, card: Card): Promise<CardPlacementsDTO> {
  const boardRows = await db
    .select({ id: boards.id, name: boards.name, itemId: boardItems.id, label: cardVersions.label })
    .from(boardItems)
    .innerJoin(boards, eq(boards.id, boardItems.boardId))
    .innerJoin(cardVersions, eq(cardVersions.id, boardItems.pinnedVersionId))
    .where(eq(boardItems.cardId, card.id))
    .orderBy(asc(boards.name));
  const bitRows = await db
    .select({ id: bits.id, name: bits.name, itemId: bitItems.id, label: cardVersions.label })
    .from(bitItems)
    .innerJoin(bits, eq(bits.id, bitItems.bitId))
    .innerJoin(cardVersions, eq(cardVersions.id, bitItems.pinnedVersionId))
    .where(eq(bitItems.cardId, card.id))
    .orderBy(asc(bits.name));
  const setRows = bitRows.length
    ? await db
        .select({ setId: sets.id, setName: sets.name, kind: setRevisions.kind, anchorNumber: setRevisions.anchorNumber })
        .from(setRevisionItems)
        .innerJoin(setRevisions, eq(setRevisions.id, setRevisionItems.revisionId))
        .innerJoin(sets, eq(sets.id, setRevisions.setId))
        .where(inArray(setRevisionItems.bitId, bitRows.map((b) => b.id)))
    : [];
  const setsMap = new Map<string, { id: string; name: string; in_working: boolean; anchors: number[] }>();
  for (const r of setRows) {
    const s = setsMap.get(r.setId) ?? { id: r.setId, name: r.setName, in_working: false, anchors: [] };
    if (r.kind === "working") s.in_working = true;
    if (r.kind === "anchor" && r.anchorNumber !== null && !s.anchors.includes(r.anchorNumber)) s.anchors.push(r.anchorNumber);
    setsMap.set(r.setId, s);
  }
  const root = await db.query.workshopNodes.findFirst({ where: and(eq(workshopNodes.seedCardId, card.id), eq(workshopNodes.kind, "root")) });
  let workshop: CardPlacementsDTO["workshop"] = null;
  if (root) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workshopNodes)
      .where(and(eq(workshopNodes.seedCardId, card.id), eq(workshopNodes.kind, "answer")));
    const lastSeed = await db.query.workshopSessionSeeds.findFirst({ where: eq(workshopSessionSeeds.cardId, card.id), orderBy: desc(workshopSessionSeeds.addedAt) });
    workshop = { root_node_id: root.id, answer_count: n, last_session_id: lastSeed?.sessionId ?? null };
  }
  return {
    boards: boardRows.map((r) => ({ id: r.id, name: r.name, item_id: r.itemId, pinned_version_label: r.label! })),
    bits: bitRows.map((r) => ({ id: r.id, name: r.name, item_id: r.itemId, pinned_version_label: r.label! })),
    sets: [...setsMap.values()].map((s) => ({ ...s, anchors: s.anchors.sort((a, b) => a - b) })),
    workshop,
  };
}

export async function loadCardDTO(db: DbOrTx, userId: string, card: Card): Promise<CardDTO> {
  const [summary] = await loadSummaries(db, userId, [card]);
  const current = (await getVersionById(db, card.currentVersionId!))!;
  const [{ n: versionCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardVersions)
    .where(eq(cardVersions.cardId, card.id));
  const [parts, placements, currentDTO] = await Promise.all([loadParts(db, card.id), loadPlacements(db, card), versionDTOWithParent(db, current)]);
  const { body_excerpt: _excerpt, ...rest } = summary;
  return { ...rest, rev: card.rev, laugh_size: card.laughSize, current_version: currentDTO, version_count: versionCount, parts, placements };
}

export async function refreshSearch(db: DbOrTx, cardId: string) {
  await db.execute(sql`select refresh_card_search(${cardId}::uuid)`);
}

export async function bumpCard(db: DbOrTx, cardId: string, extra: Partial<typeof cards.$inferInsert> = {}) {
  await db
    .update(cards)
    .set({ rev: sql`${cards.rev} + 1`, updatedAt: new Date(), ...extra })
    .where(eq(cards.id, cardId));
}
