import { and, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { analyticsEvents, cardEvents } from "@/db/schema";

type EventType = (typeof cardEvents.$inferInsert)["eventType"];

export async function logCardEvent(
  db: DbOrTx,
  input: {
    userId: string;
    cardId: string;
    type: EventType;
    versionId?: string | null;
    refType?: "board" | "bit" | "set" | "session" | "performance" | "card" | null;
    refId?: string | null;
    label?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await db.insert(cardEvents).values({
    userId: input.userId,
    cardId: input.cardId,
    eventType: input.type,
    versionId: input.versionId ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    label: input.label ?? null,
    payload: input.payload ?? {},
  });
}

/** Rule V5: at most one `edited` event per version per 10 minutes. */
export async function logEditedEventThrottled(db: DbOrTx, userId: string, cardId: string, versionId: string) {
  const last = await db.query.cardEvents.findFirst({
    where: and(eq(cardEvents.cardId, cardId), eq(cardEvents.versionId, versionId), eq(cardEvents.eventType, "edited")),
    orderBy: desc(cardEvents.occurredAt),
  });
  if (last && Date.now() - last.occurredAt.getTime() < 10 * 60 * 1000) return;
  await logCardEvent(db, { userId, cardId, type: "edited", versionId });
}

/** First-party product analytics. Properties never contain note text. */
export async function track(db: DbOrTx, userId: string | null, name: string, properties: Record<string, unknown> = {}) {
  try {
    await db.insert(analyticsEvents).values({ userId, name, properties });
  } catch {
    // analytics must never fail a request
  }
}
