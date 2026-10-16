import { eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { cardCounters, cards, performances, questionTemplates, userSettings, users } from "@/db/schema";
import { env } from "@/server/env";
import type { MeDTO, SettingsDTO } from "@/types/dto";
import { DomainError } from "@/server/errors";

/** The seven default question templates (HANDOFF.md §16.3). */
export const DEFAULT_QUESTION_TEMPLATES = [
  { position: 1, systemKey: "why_funny", text: "Why is this funny?", shortLabel: "Why is this funny?", category: "analyze" },
  { position: 2, systemKey: "point", text: "What is the point you are making?", shortLabel: "What's the point?", category: "analyze" },
  { position: 3, systemKey: "relating", text: "How are we relating to the audience?", shortLabel: "How are we relating?", category: "audience" },
  { position: 4, systemKey: "context", text: "What context does the audience need?", shortLabel: "What context do they need?", category: "audience" },
  { position: 5, systemKey: "enter", text: "How do we enter this angle?", shortLabel: "How do we enter?", category: "build" },
  { position: 6, systemKey: "punchline", text: "What's the punch line?", shortLabel: "Punchline?", category: "build" },
  { position: 7, systemKey: "laugh_size", text: "Is it a big laugh or a table laugh?", shortLabel: "Big or table laugh?", category: "rating" },
] as const;

/** Idempotent per-user bootstrap: settings, counters, default deck. */
export async function ensureUserBootstrap(db: DbOrTx, userId: string) {
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  await db.insert(cardCounters).values({ userId }).onConflictDoNothing();
  for (const t of DEFAULT_QUESTION_TEMPLATES) {
    await db
      .insert(questionTemplates)
      .values({ userId, systemKey: t.systemKey, text: t.text, shortLabel: t.shortLabel, category: t.category, position: t.position })
      .onConflictDoNothing();
  }
}

export async function getSettings(db: DbOrTx, userId: string): Promise<SettingsDTO> {
  let row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  if (!row) {
    await ensureUserBootstrap(db, userId);
    row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  }
  return {
    ai_assist_enabled: row!.aiAssistEnabled,
    ai_available: env.aiEnabled,
    reading_wpm: row!.readingWpm,
    dismissed_hints: row!.dismissedHints,
  };
}

export async function getReadingWpm(db: DbOrTx, userId: string): Promise<number> {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId), columns: { readingWpm: true } });
  return row?.readingWpm ?? 150;
}

export async function getMe(userId: string): Promise<MeDTO> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new DomainError("UNAUTHENTICATED", "Signed out.");
  const settings = await getSettings(db, userId);
  const [{ inbox, killed }] = await db
    .select({
      inbox: sql<number>`count(*) filter (where ${cards.inboxState} = 'inbox' and ${cards.killedAt} is null)::int`,
      killed: sql<number>`count(*) filter (where ${cards.killedAt} is not null)::int`,
    })
    .from(cards)
    .where(eq(cards.userId, userId));
  const [{ perf }] = await db
    .select({ perf: sql<number>`count(*)::int` })
    .from(performances)
    .where(eq(performances.userId, userId));
  return {
    user: { id: user.id, email: user.email, name: user.name },
    settings,
    counts: { inbox, killed, performances: perf },
  };
}

export async function updateName(userId: string, name: string | null) {
  const db = getDb();
  const [row] = await db.update(users).set({ name: name?.trim() || null }).where(eq(users.id, userId)).returning();
  return { id: row.id, email: row.email, name: row.name };
}

export async function updateSettings(
  userId: string,
  patch: { ai_assist_enabled?: boolean; reading_wpm?: number; dismissed_hints?: string[] },
): Promise<SettingsDTO> {
  const db = getDb();
  await ensureUserBootstrap(db, userId);
  if (patch.ai_assist_enabled && !env.aiEnabled) {
    throw new DomainError("AI_DISABLED_BY_SERVER", "AI assist isn't available on this server.");
  }
  const set: Partial<typeof userSettings.$inferInsert> = {};
  if (patch.ai_assist_enabled !== undefined) {
    set.aiAssistEnabled = patch.ai_assist_enabled;
    if (patch.ai_assist_enabled) set.aiConsentAt = sql`coalesce(${userSettings.aiConsentAt}, now())` as unknown as Date;
  }
  if (patch.reading_wpm !== undefined) set.readingWpm = patch.reading_wpm;
  if (patch.dismissed_hints !== undefined) set.dismissedHints = patch.dismissed_hints;
  if (Object.keys(set).length) await db.update(userSettings).set(set).where(eq(userSettings.userId, userId));
  return getSettings(db, userId);
}

export async function deleteAccount(userId: string) {
  const db = getDb();
  await db.delete(users).where(eq(users.id, userId));
}
