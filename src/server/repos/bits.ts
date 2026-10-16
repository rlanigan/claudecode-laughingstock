// Shared bit loaders: items, durations, primary subjects, snapshots.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { bitItems, bits, cardSubjectTags, cardVersions, cards, subjectTags, type Bit, type BitSnapshot } from "@/db/schema";
import { bitDurationSeconds } from "@/domain/runtime";
import { primarySubject } from "@/domain/heuristics";
import { wordCount } from "@/domain/title-split";
import { notFound } from "@/server/errors";

export async function requireBit(db: DbOrTx, userId: string, id: string): Promise<Bit> {
  const row = await db.query.bits.findFirst({ where: and(eq(bits.id, id), eq(bits.userId, userId)) });
  if (!row) throw notFound("That bit");
  return row;
}

export interface LoadedBitItem {
  id: string;
  bitId: string;
  position: number;
  kind: "joke" | "bridge";
  cardId: string | null;
  cardNumber: number | null;
  pinnedVersionId: string | null;
  versionLabel: string | null;
  title: string | null;
  body: string | null;
  bridgeText: string | null;
}

export async function loadBitItems(db: DbOrTx, bitIds: string[]): Promise<Map<string, LoadedBitItem[]>> {
  const out = new Map<string, LoadedBitItem[]>();
  if (!bitIds.length) return out;
  const rows = await db
    .select({
      id: bitItems.id,
      bitId: bitItems.bitId,
      position: bitItems.position,
      kind: bitItems.kind,
      cardId: bitItems.cardId,
      cardNumber: cards.number,
      pinnedVersionId: bitItems.pinnedVersionId,
      versionLabel: cardVersions.label,
      title: cardVersions.title,
      body: cardVersions.body,
      bridgeText: bitItems.bridgeText,
    })
    .from(bitItems)
    .leftJoin(cards, eq(cards.id, bitItems.cardId))
    .leftJoin(cardVersions, eq(cardVersions.id, bitItems.pinnedVersionId))
    .where(inArray(bitItems.bitId, bitIds))
    .orderBy(asc(bitItems.position));
  for (const r of rows) {
    const list = out.get(r.bitId) ?? [];
    list.push({ ...r, versionLabel: r.versionLabel ?? null });
    out.set(r.bitId, list);
  }
  for (const id of bitIds) if (!out.has(id)) out.set(id, []);
  return out;
}

export function itemWords(items: LoadedBitItem[]): number {
  return items.reduce((acc, i) => acc + (i.kind === "joke" ? wordCount(i.title, i.body) : wordCount(i.bridgeText)), 0);
}

export function durationFor(bit: Pick<Bit, "durationOverrideSeconds">, items: LoadedBitItem[], wpm: number): number {
  return bitDurationSeconds(itemWords(items), wpm, bit.durationOverrideSeconds);
}

/** Primary subject per bit (most frequent subject tag across its joke cards). */
export async function primarySubjectsFor(db: DbOrTx, bitIds: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (!bitIds.length) return out;
  const rows = await db
    .select({ bitId: bitItems.bitId, cardId: bitItems.cardId, name: subjectTags.name })
    .from(bitItems)
    .leftJoin(cardSubjectTags, eq(cardSubjectTags.cardId, bitItems.cardId))
    .leftJoin(subjectTags, eq(subjectTags.id, cardSubjectTags.tagId))
    .where(and(inArray(bitItems.bitId, bitIds), eq(bitItems.kind, "joke")));
  const perBit = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const cardsMap = perBit.get(r.bitId) ?? new Map<string, string[]>();
    const list = cardsMap.get(r.cardId!) ?? [];
    if (r.name) list.push(r.name);
    cardsMap.set(r.cardId!, list);
    perBit.set(r.bitId, cardsMap);
  }
  for (const id of bitIds) out[id] = primarySubject([...(perBit.get(id)?.values() ?? [])]);
  return out;
}

export function snapshotFor(bit: Bit, items: LoadedBitItem[], durationSeconds: number): BitSnapshot {
  return {
    bit_id: bit.id,
    name: bit.name,
    duration_seconds: durationSeconds,
    items: items.map((i) =>
      i.kind === "joke"
        ? { kind: "joke" as const, card_id: i.cardId!, card_number: i.cardNumber!, version_id: i.pinnedVersionId!, version_label: i.versionLabel!, text: i.title ? `${i.title}\n${i.body ?? ""}` : (i.body ?? "") }
        : { kind: "bridge" as const, text: i.bridgeText ?? "" },
    ),
  };
}

export async function bitCardSubjectsAndThemes(db: DbOrTx, bitId: string): Promise<{ subjects: Set<string>; themes: Set<string> }> {
  const rows = await db.execute(sql`
    select distinct st.name as subject, null::text as theme from bit_items bi
      join card_subject_tags cst on cst.card_id = bi.card_id join subject_tags st on st.id = cst.tag_id where bi.bit_id = ${bitId}
    union all
    select distinct null::text, t.name from bit_items bi
      join card_themes ct on ct.card_id = bi.card_id join themes t on t.id = ct.theme_id where bi.bit_id = ${bitId}`);
  const subjects = new Set<string>();
  const themesSet = new Set<string>();
  for (const r of rows as unknown as { subject: string | null; theme: string | null }[]) {
    if (r.subject) subjects.add(r.subject);
    if (r.theme) themesSet.add(r.theme);
  }
  return { subjects, themes: themesSet };
}
