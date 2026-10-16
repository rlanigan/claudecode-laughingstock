// Rule 7.4 — recompute cards.status from kill state, kind, workshop answers and performances.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { cards, performanceMarks, performances, setRevisionItems, workshopNodes } from "@/db/schema";
import { deriveStatus, type Appearance } from "@/domain/status";
import type { PerformedAppearanceDTO } from "@/types/dto";

/**
 * Card appearances in performances: for each mark, the joke items of that bit's snapshot in the
 * performed anchor give (card_id, version_id). Returns rows for the given card ids.
 */
export async function loadAppearances(
  db: DbOrTx,
  userId: string,
  cardIds: string[],
): Promise<Map<string, (Appearance & PerformedAppearanceDTO & { card_id: string })[]>> {
  const out = new Map<string, (Appearance & PerformedAppearanceDTO & { card_id: string })[]>();
  if (cardIds.length === 0) return out;
  const rows = await db.execute(sql`
    select pm.performance_id, p.performed_on::text as performed_on, p.venue_label, s.name as set_name,
           r.anchor_number, pm.result, pm.updated_at,
           j->>'card_id' as card_id, j->>'version_label' as version_label
    from performance_marks pm
    join performances p on p.id = pm.performance_id
    join sets s on s.id = p.set_id
    join set_revisions r on r.id = p.revision_id
    join set_revision_items ri on ri.revision_id = p.revision_id and ri.bit_id = pm.bit_id
    cross join lateral jsonb_array_elements(coalesce(ri.bit_snapshot->'items', '[]'::jsonb)) j
    where pm.user_id = ${userId} and j->>'kind' = 'joke'
      and (j->>'card_id')::uuid in ${sql.raw(`(${cardIds.map((id) => `'${id}'`).join(",")})`)}
  `);
  for (const r of rows as unknown as Record<string, unknown>[]) {
    const cardId = r.card_id as string;
    const list = out.get(cardId) ?? [];
    list.push({
      card_id: cardId,
      performedOn: r.performed_on as string,
      updatedAt: new Date(r.updated_at as string),
      result: r.result as Appearance["result"],
      performance_id: r.performance_id as string,
      performed_on: r.performed_on as string,
      venue_label: (r.venue_label as string | null) ?? null,
      set_name: r.set_name as string,
      anchor_number: Number(r.anchor_number),
      version_label: r.version_label as string,
    });
    out.set(cardId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.performed_on < b.performed_on ? 1 : a.performed_on > b.performed_on ? -1 : b.updatedAt.getTime() - a.updatedAt.getTime()));
  }
  return out;
}

export async function recomputeCardStatus(db: DbOrTx, userId: string, cardIds: string[]) {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: cards.id, kind: cards.kind, killedAt: cards.killedAt, status: cards.status })
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, ids)));
  const answerCounts = await db
    .select({ seedCardId: workshopNodes.seedCardId, n: sql<number>`count(*)::int` })
    .from(workshopNodes)
    .where(and(eq(workshopNodes.kind, "answer"), inArray(workshopNodes.seedCardId, ids)))
    .groupBy(workshopNodes.seedCardId);
  const answers = new Map(answerCounts.map((r) => [r.seedCardId, r.n]));
  const appearances = await loadAppearances(db, userId, ids);
  for (const row of rows) {
    const status = deriveStatus({
      killed: row.killedAt !== null,
      kind: row.kind,
      hasWorkshopAnswers: (answers.get(row.id) ?? 0) > 0,
      appearances: appearances.get(row.id) ?? [],
    });
    if (status !== row.status) await db.update(cards).set({ status }).where(eq(cards.id, row.id));
  }
}

/** Cards appearing in the snapshot of a revision item for a given bit (for status recompute after marks). */
export async function cardIdsInRevisionBit(db: DbOrTx, revisionId: string, bitId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select distinct j->>'card_id' as card_id
    from set_revision_items ri
    cross join lateral jsonb_array_elements(coalesce(ri.bit_snapshot->'items', '[]'::jsonb)) j
    where ri.revision_id = ${revisionId} and ri.bit_id = ${bitId} and j->>'kind' = 'joke'`);
  return (rows as unknown as { card_id: string }[]).map((r) => r.card_id);
}

export async function cardIdsInPerformance(db: DbOrTx, performanceId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select distinct j->>'card_id' as card_id
    from performance_marks pm
    join set_revision_items ri on ri.bit_id = pm.bit_id
    join performances p on p.id = pm.performance_id and p.revision_id = ri.revision_id
    cross join lateral jsonb_array_elements(coalesce(ri.bit_snapshot->'items', '[]'::jsonb)) j
    where pm.performance_id = ${performanceId} and j->>'kind' = 'joke'`);
  return (rows as unknown as { card_id: string }[]).map((r) => r.card_id);
}

// Keep imports referenced for type checking of unused tables in some bundlers.
void performanceMarks;
void performances;
void setRevisionItems;
