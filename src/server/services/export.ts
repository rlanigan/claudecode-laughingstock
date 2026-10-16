// Export everything as a ZIP: data.json plus one Markdown file per card, bit and set (§19).
import { asc, eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { getDb } from "@/server/db";
import * as s from "@/db/schema";
import { displayNumber } from "@/domain/title-split";
import { track } from "./events";

const slug = (name: string, id: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "item"}-${id.slice(0, 8)}`;
const fm = (obj: Record<string, unknown>) =>
  `---\n${Object.entries(obj)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n\n`;

export async function buildExport(userId: string): Promise<{ bytes: Uint8Array; cardCount: number }> {
  const db = getDb();
  const user = (await db.query.users.findFirst({ where: eq(s.users.id, userId) }))!;
  const by = <T extends { userId: string }>(rows: T[]) => rows;
  const cards = by(await db.select().from(s.cards).where(eq(s.cards.userId, userId)).orderBy(asc(s.cards.number)));
  const versions = await db.select().from(s.cardVersions).where(eq(s.cardVersions.userId, userId)).orderBy(asc(s.cardVersions.depth), asc(s.cardVersions.branch));
  const parts = await db.select().from(s.cardParts).where(eq(s.cardParts.userId, userId)).orderBy(asc(s.cardParts.position));
  const subjects = await db.select().from(s.subjectTags).where(eq(s.subjectTags.userId, userId));
  const cardSubjects = await db.select({ cardId: s.cardSubjectTags.cardId, tagId: s.cardSubjectTags.tagId, source: s.cardSubjectTags.source }).from(s.cardSubjectTags).innerJoin(s.cards, eq(s.cards.id, s.cardSubjectTags.cardId)).where(eq(s.cards.userId, userId));
  const themes = await db.select().from(s.themes).where(eq(s.themes.userId, userId));
  const cardThemes = await db.select({ cardId: s.cardThemes.cardId, themeId: s.cardThemes.themeId, source: s.cardThemes.source }).from(s.cardThemes).innerJoin(s.cards, eq(s.cards.id, s.cardThemes.cardId)).where(eq(s.cards.userId, userId));
  const links = await db.select().from(s.cardLinks).where(eq(s.cardLinks.userId, userId));
  const events = await db.select().from(s.cardEvents).where(eq(s.cardEvents.userId, userId)).orderBy(asc(s.cardEvents.occurredAt));
  const boards = await db.select().from(s.boards).where(eq(s.boards.userId, userId));
  const clusters = await db.select().from(s.boardClusters).where(eq(s.boardClusters.userId, userId));
  const boardItems = await db.select().from(s.boardItems).where(eq(s.boardItems.userId, userId));
  const sessions = await db.select().from(s.workshopSessions).where(eq(s.workshopSessions.userId, userId));
  const seeds = await db.select({ sessionId: s.workshopSessionSeeds.sessionId, cardId: s.workshopSessionSeeds.cardId, position: s.workshopSessionSeeds.position }).from(s.workshopSessionSeeds).innerJoin(s.workshopSessions, eq(s.workshopSessions.id, s.workshopSessionSeeds.sessionId)).where(eq(s.workshopSessions.userId, userId));
  const templates = await db.select().from(s.questionTemplates).where(eq(s.questionTemplates.userId, userId));
  const nodes = await db.select().from(s.workshopNodes).where(eq(s.workshopNodes.userId, userId));
  const questions = await db.select().from(s.workshopQuestions).where(eq(s.workshopQuestions.userId, userId));
  const bits = await db.select().from(s.bits).where(eq(s.bits.userId, userId));
  const bitItems = await db.select().from(s.bitItems).where(eq(s.bitItems.userId, userId)).orderBy(asc(s.bitItems.position));
  const sets = await db.select().from(s.sets).where(eq(s.sets.userId, userId));
  const revisions = await db.select().from(s.setRevisions).where(eq(s.setRevisions.userId, userId));
  const revisionItems = await db.select({ r: s.setRevisionItems }).from(s.setRevisionItems).innerJoin(s.setRevisions, eq(s.setRevisions.id, s.setRevisionItems.revisionId)).where(eq(s.setRevisions.userId, userId));
  const transitions = await db.select().from(s.setTransitions).where(eq(s.setTransitions.userId, userId));
  const revisionTransitions = await db.select({ t: s.setRevisionTransitions }).from(s.setRevisionTransitions).innerJoin(s.setRevisions, eq(s.setRevisions.id, s.setRevisionTransitions.revisionId)).where(eq(s.setRevisions.userId, userId));
  const forkGroups = await db.select({ g: s.setForkGroups }).from(s.setForkGroups).innerJoin(s.sets, eq(s.sets.id, s.setForkGroups.setId)).where(eq(s.sets.userId, userId));
  const performances = await db.select().from(s.performances).where(eq(s.performances.userId, userId));
  const marks = await db.select().from(s.performanceMarks).where(eq(s.performanceMarks.userId, userId));

  const data = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email, name: user.name },
    cards, versions, parts, subjects, card_subjects: cardSubjects, themes, card_themes: cardThemes, links, events,
    boards, clusters, board_items: boardItems,
    sessions, session_seeds: seeds, question_templates: templates, workshop_nodes: nodes, workshop_questions: questions,
    bits, bit_items: bitItems, sets, revisions, revision_items: revisionItems.map((r) => r.r), transitions, revision_transitions: revisionTransitions.map((r) => r.t), fork_groups: forkGroups.map((g) => g.g),
    performances, marks,
  };

  const files: Record<string, Uint8Array> = { "data.json": strToU8(JSON.stringify(data, null, 2)) };
  const subjectName = new Map(subjects.map((t) => [t.id, t.name]));
  const themeName = new Map(themes.map((t) => [t.id, t.name]));
  const versionsOf = new Map<string, typeof versions>();
  for (const v of versions) versionsOf.set(v.cardId, [...(versionsOf.get(v.cardId) ?? []), v]);
  const partsOf = new Map<string, typeof parts>();
  for (const p of parts) partsOf.set(p.cardId, [...(partsOf.get(p.cardId) ?? []), p]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const versionById = new Map(versions.map((v) => [v.id, v]));

  for (const c of cards) {
    const cur = versionById.get(c.currentVersionId!);
    const md =
      fm({ number: c.number, kind: c.kind, form: c.form, status: c.status, subjects: cardSubjects.filter((x) => x.cardId === c.id).map((x) => subjectName.get(x.tagId)), themes: cardThemes.filter((x) => x.cardId === c.id).map((x) => themeName.get(x.themeId)), captured_at: c.capturedAt.toISOString() }) +
      `# ${cur?.title ?? displayNumber(c.number)}\n\n${cur?.body ?? ""}\n` +
      (cur?.context ? `\n## Context\n\n${cur.context}\n` : "") +
      (cur?.details ? `\n## Details\n\n${cur.details}\n` : "") +
      ((partsOf.get(c.id)?.length ?? 0) > 0 ? `\n## Parts\n\n${partsOf.get(c.id)!.map((p) => `- **${p.kind}**: ${p.body}`).join("\n")}\n` : "") +
      `\n## History\n\n${(versionsOf.get(c.id) ?? []).map((v) => `- ${v.label} · ${v.createdContextLabel ?? v.createdContext} · ${v.createdAt.toISOString()}${v.changeNote ? ` · ${v.changeNote}` : ""}`).join("\n")}\n`;
    files[`cards/${String(c.number).padStart(4, "0")}.md`] = strToU8(md);
  }
  for (const b of bits) {
    const items = bitItems.filter((i) => i.bitId === b.id);
    const body = items
      .map((i) => {
        if (i.kind === "bridge") return `*${i.bridgeText}*`;
        const v = versionById.get(i.pinnedVersionId!);
        const c = cardById.get(i.cardId!);
        return `${v?.title ? `**${v.title}**\n` : ""}${v?.body ?? ""}\n<!-- ${c ? displayNumber(c.number) : ""} ${v?.label ?? ""} -->`;
      })
      .join("\n\n");
    files[`bits/${slug(b.name, b.id)}.md`] = strToU8(fm({ name: b.name, archived: b.archivedAt !== null }) + `# ${b.name}\n\n${body}\n`);
  }
  for (const st of sets) {
    const anchors = revisions.filter((r) => r.setId === st.id && r.kind === "anchor").sort((a, b) => (a.anchorNumber ?? 0) - (b.anchorNumber ?? 0));
    let md = fm({ name: st.name, status: st.status, target_duration_seconds: st.targetDurationSeconds }) + `# ${st.name}\n`;
    for (const a of anchors) {
      md += `\n## v${a.anchorNumber} · ${a.name} (${a.frozenAt?.toISOString() ?? ""})\n`;
      const items = revisionItems.map((r) => r.r).filter((r) => r.revisionId === a.id).sort((x, y) => x.position - y.position);
      items.forEach((it, idx) => {
        const snap = it.bitSnapshot;
        md += `\n### ${idx + 1}. ${snap?.name ?? "Bit"}\n\n`;
        for (const b of snap?.items ?? []) md += b.kind === "joke" ? `${b.text}\n\n` : `*${b.text}*\n\n`;
        const next = items[idx + 1];
        if (next) {
          const t = revisionTransitions.map((r) => r.t).find((r) => r.revisionId === a.id && r.fromBitId === it.bitId && r.toBitId === next.bitId);
          md += t ? (t.kind === "hard_cut" ? `_[hard cut]_\n` : `_${t.text}_\n`) : `_[no transition yet]_\n`;
        }
      });
    }
    files[`sets/${slug(st.name, st.id)}.md`] = strToU8(md);
  }
  const bytes = zipSync(files, { level: 6 });
  await track(db, userId, "export_downloaded", { card_count: cards.length });
  return { bytes, cardCount: cards.length };
}
