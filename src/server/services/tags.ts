// Subject tags and themes: admin (S3), suggestions, cluster/workshop theme linking (Rule 7.7).
import { and, asc, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { cardSubjectTags, cardThemes, cards, subjectTags, themes } from "@/db/schema";
import { DomainError, notFound } from "@/server/errors";
import { normalizeSubject, normalizeThemeName, suggestSubjectsFromText } from "@/domain/tags";
import { requireCard } from "@/server/repos/cards";
import { logCardEvent, track } from "./events";

// ---------- subjects ----------

export async function listSubjects(userId: string, q: { q?: string; sort: "name" | "count"; filter: "all" | "once" | "unused" }) {
  const db = getDb();
  const rows = await db
    .select({
      id: subjectTags.id,
      name: subjectTags.name,
      count: sql<number>`(select count(*) from card_subject_tags cst join cards c on c.id = cst.card_id where cst.tag_id = subject_tags.id and c.killed_at is null)::int`,
      lastUsedAt: sql<string | null>`(select max(cst.created_at) from card_subject_tags cst where cst.tag_id = subject_tags.id)`,
    })
    .from(subjectTags)
    .where(and(eq(subjectTags.userId, userId), q.q ? ilike(subjectTags.name, `%${q.q.toLowerCase()}%`) : sql`true`))
    .orderBy(asc(subjectTags.name));
  let items = rows.map((r) => ({ id: r.id, name: r.name, count: r.count, last_used_at: r.lastUsedAt }));
  if (q.filter === "once") items = items.filter((i) => i.count === 1);
  if (q.filter === "unused") items = items.filter((i) => i.count === 0);
  if (q.sort === "count") items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { items };
}

export async function usageRankedSubjects(db: DbOrTx, userId: string, limit = 200): Promise<{ id: string; name: string; count: number }[]> {
  const rows = await db
    .select({ id: subjectTags.id, name: subjectTags.name, count: sql<number>`(select count(*) from card_subject_tags cst where cst.tag_id = subject_tags.id)::int` })
    .from(subjectTags)
    .where(eq(subjectTags.userId, userId))
    .orderBy(desc(sql`3`), asc(subjectTags.name))
    .limit(limit);
  return rows;
}

export async function suggestSubjects(userId: string, text: string) {
  const db = getDb();
  const existing = await usageRankedSubjects(db, userId);
  const names = suggestSubjectsFromText(text, existing);
  return { suggestions: names.map((name) => ({ name, existing: true, source: "match" as const })) };
}

export async function autocompleteSubjects(userId: string, prefix: string) {
  const db = getDb();
  const p = normalizeSubject(prefix) ?? "";
  const rows = await db
    .select({ id: subjectTags.id, name: subjectTags.name, count: sql<number>`(select count(*) from card_subject_tags cst where cst.tag_id = subject_tags.id)::int` })
    .from(subjectTags)
    .where(and(eq(subjectTags.userId, userId), p ? ilike(subjectTags.name, `${p}%`) : sql`true`))
    .orderBy(desc(sql`3`), asc(subjectTags.name))
    .limit(10);
  return rows;
}

async function requireSubject(db: DbOrTx, userId: string, id: string) {
  const row = await db.query.subjectTags.findFirst({ where: and(eq(subjectTags.id, id), eq(subjectTags.userId, userId)) });
  if (!row) throw notFound("That tag");
  return row;
}

export async function renameSubject(userId: string, id: string, rawName: string) {
  const db = getDb();
  const tag = await requireSubject(db, userId, id);
  const name = normalizeSubject(rawName);
  if (!name) throw new DomainError("TAG_INVALID", "Tags can use letters, numbers, spaces and hyphens (max 40).");
  const clash = await db.query.subjectTags.findFirst({ where: and(eq(subjectTags.userId, userId), eq(subjectTags.name, name), ne(subjectTags.id, id)) });
  if (clash) throw new DomainError("NAME_TAKEN", `You already have one called '${name}'.`, { suggest_merge_into: clash.id });
  const [row] = await db.update(subjectTags).set({ name }).where(eq(subjectTags.id, tag.id)).returning();
  return { id: row.id, name: row.name };
}

export async function mergeSubjects(userId: string, fromId: string, intoId: string) {
  const db = getDb();
  if (fromId === intoId) throw new DomainError("VALIDATION_ERROR", "Pick a different tag to merge into.");
  const from = await requireSubject(db, userId, fromId);
  const into = await requireSubject(db, userId, intoId);
  await db.transaction(async (tx) => {
    const links = await tx.select().from(cardSubjectTags).where(eq(cardSubjectTags.tagId, from.id));
    for (const l of links) await tx.insert(cardSubjectTags).values({ cardId: l.cardId, tagId: into.id, source: l.source }).onConflictDoNothing();
    await tx.delete(subjectTags).where(eq(subjectTags.id, from.id));
  });
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(cardSubjectTags).where(eq(cardSubjectTags.tagId, into.id));
  return { into: { id: into.id, name: into.name, count } };
}

export async function deleteSubject(userId: string, id: string) {
  const db = getDb();
  const tag = await requireSubject(db, userId, id);
  await db.delete(subjectTags).where(eq(subjectTags.id, tag.id));
}

// ---------- themes ----------

export async function listThemes(userId: string, q?: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: themes.id,
      name: themes.name,
      source: themes.source,
      count: sql<number>`(select count(*) from card_themes ct join cards c on c.id = ct.card_id where ct.theme_id = themes.id and c.killed_at is null)::int`,
      lastUsedAt: sql<string | null>`(select max(ct.created_at) from card_themes ct where ct.theme_id = themes.id)`,
    })
    .from(themes)
    .where(and(eq(themes.userId, userId), q ? ilike(themes.name, `%${q}%`) : sql`true`))
    .orderBy(asc(themes.name));
  return { items: rows.map((r) => ({ id: r.id, name: r.name, source: r.source, count: r.count, last_used_at: r.lastUsedAt })) };
}

/** Find or create a theme by name. */
export async function ensureTheme(db: DbOrTx, userId: string, rawName: string, source: "workshop_answer" | "cluster" | "manual", sourceRefId: string | null) {
  const name = normalizeThemeName(rawName);
  if (!name) throw new DomainError("VALIDATION_ERROR", "Theme names are 1–120 characters.");
  const existing = await db.query.themes.findFirst({ where: and(eq(themes.userId, userId), eq(themes.nameKey, name.toLowerCase())) });
  if (existing) return { theme: existing, created: false };
  const [row] = await db.insert(themes).values({ userId, name, source, sourceRefId }).returning();
  await track(db, userId, "theme_created", { source });
  return { theme: row, created: true };
}

export async function attachTheme(db: DbOrTx, userId: string, cardId: string, themeId: string, source: "user" | "cluster" | "workshop_answer" | "inherited", sourceRefId: string | null) {
  const r = await db.insert(cardThemes).values({ cardId, themeId, source, sourceRefId }).onConflictDoNothing().returning();
  if (r.length) await logCardEvent(db, { userId, cardId, type: "theme_added", payload: { theme_id: themeId, source } });
}

export async function createTheme(userId: string, input: { name: string; card_numbers?: number[]; source: "manual" | "workshop_answer"; source_ref_id?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { theme, created } = await ensureTheme(tx, userId, input.name, input.source, input.source_ref_id ?? null);
    for (const n of input.card_numbers ?? []) {
      const card = await requireCard(tx, userId, n);
      await attachTheme(tx, userId, card.id, theme.id, "user", null);
    }
    return { theme: { id: theme.id, name: theme.name, source: theme.source }, created };
  });
}

async function requireTheme(db: DbOrTx, userId: string, id: string) {
  const row = await db.query.themes.findFirst({ where: and(eq(themes.id, id), eq(themes.userId, userId)) });
  if (!row) throw notFound("That theme");
  return row;
}

export async function renameTheme(userId: string, id: string, rawName: string) {
  const db = getDb();
  const theme = await requireTheme(db, userId, id);
  const name = normalizeThemeName(rawName);
  if (!name) throw new DomainError("VALIDATION_ERROR", "Theme names are 1–120 characters.");
  const clash = await db.query.themes.findFirst({ where: and(eq(themes.userId, userId), eq(themes.nameKey, name.toLowerCase()), ne(themes.id, id)) });
  if (clash) throw new DomainError("NAME_TAKEN", `You already have one called '${name}'.`, { suggest_merge_into: clash.id });
  const [row] = await db.update(themes).set({ name }).where(eq(themes.id, theme.id)).returning();
  return { id: row.id, name: row.name, source: row.source };
}

export async function mergeThemes(userId: string, fromId: string, intoId: string) {
  const db = getDb();
  if (fromId === intoId) throw new DomainError("VALIDATION_ERROR", "Pick a different theme to merge into.");
  const from = await requireTheme(db, userId, fromId);
  const into = await requireTheme(db, userId, intoId);
  await db.transaction(async (tx) => {
    const links = await tx.select().from(cardThemes).where(eq(cardThemes.themeId, from.id));
    for (const l of links) await tx.insert(cardThemes).values({ cardId: l.cardId, themeId: into.id, source: l.source, sourceRefId: l.sourceRefId }).onConflictDoNothing();
    await tx.delete(themes).where(eq(themes.id, from.id));
  });
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(cardThemes).where(eq(cardThemes.themeId, into.id));
  return { into: { id: into.id, name: into.name, count } };
}

export async function deleteTheme(userId: string, id: string) {
  const db = getDb();
  const theme = await requireTheme(db, userId, id);
  await db.delete(themes).where(eq(themes.id, theme.id));
}

/** Top subject tags by usage (for the rail). */
export async function topSubjects(userId: string, limit = 5) {
  const db = getDb();
  const rows = await usageRankedSubjects(db, userId, 500);
  const used = rows.filter((r) => r.count > 0);
  return { top: used.slice(0, limit), more: Math.max(0, used.length - limit) };
}

void cards;
void isNull;
void inArray;
