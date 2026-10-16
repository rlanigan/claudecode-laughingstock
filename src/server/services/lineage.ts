// Lineage DTO assembly and word-level diffs (F-08).
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { diffWordsWithSpace } from "diff";
import { getDb } from "@/server/db";
import { bitItems, bits, boardItems, boards, cardLinks, cardSubjectTags, cardThemes, cardVersions, cards, setRevisionItems, setRevisions, sets, workshopNodes, workshopQuestions, workshopSessionSeeds, workshopSessions, type CardVersion } from "@/db/schema";
import { loadAppearances } from "./status";
import { loadSummaries, loadVersions, requireCard, requireVersion, versionToDTO } from "@/server/repos/cards";
import { displayNumber } from "@/domain/title-split";
import type { LineageDTO } from "@/types/dto";

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function getLineage(userId: string, number: number): Promise<LineageDTO> {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  const [summary] = await loadSummaries(db, userId, [card]);
  const versions = await loadVersions(db, card.id);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const versionDTOs = versions.map((v) => versionToDTO(v, v.parentVersionId ? (byId.get(v.parentVersionId)?.label ?? null) : null));

  // Columns: one per (context, ref) in order of first appearance.
  const columns: LineageDTO["columns"] = [];
  const colIndex = new Map<string, number>();
  for (const v of versions) {
    const key = `${v.createdContext}:${v.createdContextRefId ?? ""}`;
    if (!colIndex.has(key)) {
      colIndex.set(key, columns.length);
      columns.push({ key, label: v.createdContextLabel ?? v.createdContext, date_label: fmtDate(v.createdAt), version_labels: [] });
    }
    const col = columns[colIndex.get(key)!];
    col.version_labels.push(v.label!);
    const last = fmtDate(v.createdAt);
    if (!col.date_label.includes(last)) col.date_label = `${col.date_label.split("–")[0]}–${last}`;
  }

  // Links in both directions.
  const linkRows = await db.select().from(cardLinks).where(and(eq(cardLinks.userId, userId), or(eq(cardLinks.sourceCardId, card.id), eq(cardLinks.derivedCardId, card.id))));
  const otherIds = [...new Set(linkRows.map((l) => (l.sourceCardId === card.id ? l.derivedCardId : l.sourceCardId)))];
  const otherRows = otherIds.length ? await db.select().from(cards).where(inArray(cards.id, otherIds)) : [];
  const otherSummaries = new Map((await loadSummaries(db, userId, otherRows)).map((s) => [s.id, s]));
  const versionLabel = async (id: string | null) => (id ? ((byId.get(id)?.label ?? (await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, id) }))?.label) ?? null) : null);
  const links: LineageDTO["links"] = [];
  for (const l of linkRows) {
    const outgoing = l.sourceCardId === card.id; // this card is the source; other is derived
    const other = otherSummaries.get(outgoing ? l.derivedCardId : l.sourceCardId);
    if (!other) continue;
    links.push({
      relation: l.relation,
      direction: outgoing ? "outgoing" : "incoming",
      other_card: other,
      this_version_label: await versionLabel(outgoing ? l.sourceVersionId : l.derivedVersionId),
      other_version_label: await versionLabel(outgoing ? l.derivedVersionId : l.sourceVersionId),
    });
  }

  // Bit memberships with sibling parents and set names.
  const bitRows = await db
    .select({ bitId: bits.id, bitName: bits.name, versionId: bitItems.pinnedVersionId })
    .from(bitItems)
    .innerJoin(bits, eq(bits.id, bitItems.bitId))
    .where(and(eq(bitItems.cardId, card.id), isNull(bits.archivedAt)));
  const bitMemberships: LineageDTO["bit_memberships"] = [];
  for (const b of bitRows) {
    const siblings = await db
      .select({ number: cards.number, label: sql<string>`(select label from card_versions v where v.id = ${bitItems.pinnedVersionId})` })
      .from(bitItems)
      .innerJoin(cards, eq(cards.id, bitItems.cardId))
      .where(and(eq(bitItems.bitId, b.bitId), eq(bitItems.kind, "joke")))
      .orderBy(asc(bitItems.position));
    const setNames = await db
      .selectDistinct({ name: sets.name })
      .from(setRevisionItems)
      .innerJoin(setRevisions, eq(setRevisions.id, setRevisionItems.revisionId))
      .innerJoin(sets, eq(sets.id, setRevisions.setId))
      .where(eq(setRevisionItems.bitId, b.bitId));
    bitMemberships.push({
      bit_id: b.bitId,
      bit_name: b.bitName,
      version_label: byId.get(b.versionId!)?.label ?? "v1",
      parents: siblings.map((s) => ({ display_number: displayNumber(s.number), version_label: s.label })),
      set_names: setNames.map((s) => s.name),
    });
  }

  // Workshop path for promoted jokes.
  let workshopPath: LineageDTO["workshop_path"] = null;
  const promoted = linkRows.find((l) => l.relation === "promoted_from" && l.derivedCardId === card.id);
  if (promoted?.viaWorkshopNodeId) {
    const steps: NonNullable<LineageDTO["workshop_path"]> = [];
    let node = await db.query.workshopNodes.findFirst({ where: eq(workshopNodes.id, promoted.viaWorkshopNodeId) });
    const chain: { node: typeof node; q: typeof workshopQuestions.$inferSelect | undefined }[] = [];
    while (node && node.kind === "answer" && node.questionId) {
      const q = await db.query.workshopQuestions.findFirst({ where: eq(workshopQuestions.id, node.questionId) });
      chain.unshift({ node, q });
      node = q ? await db.query.workshopNodes.findFirst({ where: eq(workshopNodes.id, q.nodeId) }) : undefined;
    }
    const seedSummary = otherSummaries.get(promoted.sourceCardId);
    const seedVersion = promoted.sourceVersionId ? await db.query.cardVersions.findFirst({ where: eq(cardVersions.id, promoted.sourceVersionId) }) : null;
    steps.push({ type: "seed", card_number: seedSummary?.number ?? 0, text: seedVersion?.body ?? seedSummary?.body ?? "" });
    for (const c of chain) {
      if (c.q) steps.push({ type: "question", text: c.q.text });
      steps.push({ type: "answer", node_id: c.node!.id, text: c.node!.text ?? "" });
    }
    workshopPath = steps;
  }

  // Appears in.
  const appears: LineageDTO["appears_in"] = [];
  const boardRows = await db.select({ id: boards.id, name: boards.name, versionId: boardItems.pinnedVersionId }).from(boardItems).innerJoin(boards, eq(boards.id, boardItems.boardId)).where(eq(boardItems.cardId, card.id));
  for (const b of boardRows) appears.push({ type: "board", id: b.id, name: b.name, version_label: byId.get(b.versionId)?.label ?? "", detail: `shows ${byId.get(b.versionId)?.label ?? ""}` });
  for (const b of bitRows) {
    const pos = await db.query.bitItems.findFirst({ where: and(eq(bitItems.bitId, b.bitId), eq(bitItems.cardId, card.id)) });
    appears.push({ type: "bit", id: b.bitId, name: b.bitName, version_label: byId.get(b.versionId!)?.label ?? "", detail: `${byId.get(b.versionId!)?.label ?? ""}, block ${(pos?.position ?? 0) + 1}` });
  }
  const anchorRows = await db.execute(sql`
    select s.id as set_id, s.name as set_name, r.anchor_number, j->>'version_label' as version_label
    from set_revision_items ri
    join set_revisions r on r.id = ri.revision_id and r.kind = 'anchor'
    join sets s on s.id = r.set_id
    cross join lateral jsonb_array_elements(coalesce(ri.bit_snapshot->'items','[]'::jsonb)) j
    where j->>'card_id' = ${card.id} and s.user_id = ${userId}
    order by s.name, r.anchor_number`);
  for (const r of anchorRows as unknown as { set_id: string; set_name: string; anchor_number: number; version_label: string }[]) {
    appears.push({ type: "set", id: r.set_id, name: r.set_name, version_label: r.version_label, detail: `${r.version_label} (anchor v${r.anchor_number})` });
  }
  const seedSessions = await db.select({ id: workshopSessions.id, title: workshopSessions.title }).from(workshopSessionSeeds).innerJoin(workshopSessions, eq(workshopSessions.id, workshopSessionSeeds.sessionId)).where(eq(workshopSessionSeeds.cardId, card.id));
  for (const s of seedSessions) appears.push({ type: "workshop", id: s.id, name: s.title, version_label: "", detail: "seed" });

  // Performed.
  const performed = (await loadAppearances(db, userId, [card.id])).get(card.id) ?? [];

  // Related by tag/theme (max 5, excludes killed and self).
  const relatedRows = await db
    .selectDistinct({ c: cards })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.id, card.id),
        isNull(cards.killedAt),
        or(
          sql`exists (select 1 from card_subject_tags a join card_subject_tags b on a.tag_id = b.tag_id where a.card_id = ${card.id} and b.card_id = ${cards.id})`,
          sql`exists (select 1 from card_themes a join card_themes b on a.theme_id = b.theme_id where a.card_id = ${card.id} and b.card_id = ${cards.id})`,
        ),
      ),
    )
    .limit(5);
  const related = await loadSummaries(db, userId, relatedRows.map((r) => r.c));

  return {
    card: summary,
    versions: versionDTOs,
    columns,
    links,
    bit_memberships: bitMemberships,
    workshop_path: workshopPath,
    appears_in: appears,
    performed: performed.map(({ card_id: _c, performedOn: _p, updatedAt: _u, ...rest }) => rest),
    related,
  };
}

export function diffVersions(from: CardVersion, to: CardVersion) {
  const text = (v: CardVersion) => (v.title ? `${v.title}\n${v.body}` : v.body);
  const ops = diffWordsWithSpace(text(from), text(to)).map((p) => ({ op: p.added ? "insert" : p.removed ? "delete" : "equal", text: p.value }) as const);
  return ops;
}

export async function getDiff(userId: string, number: number, fromLabel: string, toLabel: string) {
  const db = getDb();
  const card = await requireCard(db, userId, number);
  const from = await requireVersion(db, card.id, fromLabel);
  const to = await requireVersion(db, card.id, toLabel);
  return { from: from.label, to: to.label, ops: diffVersions(from, to) };
}

void cardSubjectTags;
void cardThemes;
