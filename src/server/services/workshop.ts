// Workshop sessions, maps, questions, answers, promotion (F-12–F-15, Rule 7.8).
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { cardLinks, cards, questionTemplates, workshopNodes, workshopQuestions, workshopSessionSeeds, workshopSessions, type QuestionTemplate, type WorkshopNode, type WorkshopQuestion, type WorkshopSession } from "@/db/schema";
import { DomainError, limitReached, notFound } from "@/server/errors";
import { ACTIVE_SESSION_WINDOW_MS, branchPath, defaultSessionTitle, descendantIds, forkPoints, nextAngleLetter } from "@/domain/workshop";
import type { BranchDTO, MapDTO, NodeDTO, QuestionDTO, QuestionTemplateDTO, SessionSummaryDTO } from "@/types/dto";
import { getCardRowById, loadCardDTO, loadSubjectsFor, loadSummaries, loadThemesFor, requireCard } from "@/server/repos/cards";
import { createCardWithVersion, fileCard } from "./cards";
import { logCardEvent, track } from "./events";
import { recomputeCardStatus } from "./status";
import { attachTheme, ensureTheme } from "./tags";

// ---------- sessions ----------

export async function requireSession(db: DbOrTx, userId: string, id: string): Promise<WorkshopSession> {
  const row = await db.query.workshopSessions.findFirst({ where: and(eq(workshopSessions.id, id), eq(workshopSessions.userId, userId)) });
  if (!row) throw notFound("That session");
  return row;
}

export async function activeSession(db: DbOrTx, userId: string): Promise<WorkshopSession | null> {
  const row = await db.query.workshopSessions.findFirst({
    where: and(eq(workshopSessions.userId, userId), isNull(workshopSessions.endedAt), gt(workshopSessions.startedAt, new Date(Date.now() - ACTIVE_SESSION_WINDOW_MS))),
    orderBy: desc(workshopSessions.startedAt),
  });
  return row ?? null;
}

export async function createSession(userId: string, input: { title?: string; participants?: string[] }) {
  const db = getDb();
  const [row] = await db.insert(workshopSessions).values({ userId, title: input.title?.trim() || defaultSessionTitle(new Date()), participants: input.participants ?? [] }).returning();
  await track(db, userId, "workshop_session_started", { participant_count: row.participants.length });
  return sessionSummary(db, userId, row);
}

async function sessionSummary(db: DbOrTx, userId: string, s: WorkshopSession): Promise<SessionSummaryDTO> {
  const seedRows = await db
    .select({ c: cards })
    .from(workshopSessionSeeds)
    .innerJoin(cards, eq(cards.id, workshopSessionSeeds.cardId))
    .where(eq(workshopSessionSeeds.sessionId, s.id))
    .orderBy(asc(workshopSessionSeeds.position));
  const summaries = await loadSummaries(db, userId, seedRows.map((r) => r.c));
  const seeds: SessionSummaryDTO["seeds"] = [];
  let deadEnds = 0;
  let promoted = 0;
  for (const c of summaries) {
    const [stats] = await db
      .select({
        nodes: sql<number>`count(*) filter (where kind = 'answer')::int`,
        angles: sql<number>`count(*) filter (where angle_label is not null)::int`,
        promoted: sql<number>`count(*) filter (where promoted_card_id is not null)::int`,
        dead: sql<number>`count(*) filter (where is_dead_end)::int`,
      })
      .from(workshopNodes)
      .where(eq(workshopNodes.seedCardId, c.id));
    seeds.push({ card: c, node_count: stats.nodes, angle_count: stats.angles, promoted_count: stats.promoted });
    deadEnds += stats.dead;
    promoted += stats.promoted;
  }
  return { id: s.id, title: s.title, participants: s.participants, started_at: s.startedAt.toISOString(), ended_at: s.endedAt?.toISOString() ?? null, notes: s.notes, seed_count: seeds.length, seeds, dead_end_count: deadEnds, promoted_count: promoted };
}

export async function listSessions(userId: string, limit = 20) {
  const db = getDb();
  const rows = await db.select().from(workshopSessions).where(eq(workshopSessions.userId, userId)).orderBy(desc(workshopSessions.startedAt), desc(workshopSessions.id)).limit(limit);
  const items: SessionSummaryDTO[] = [];
  for (const r of rows) items.push(await sessionSummary(db, userId, r));
  const active = await activeSession(db, userId);
  return { items, active_session_id: active?.id ?? null };
}

export async function getSession(userId: string, id: string) {
  const db = getDb();
  return sessionSummary(db, userId, await requireSession(db, userId, id));
}

export async function patchSession(userId: string, id: string, patch: { title?: string; participants?: string[]; notes?: string; ended?: true }) {
  const db = getDb();
  await requireSession(db, userId, id);
  const [row] = await db
    .update(workshopSessions)
    .set({ title: patch.title?.trim(), participants: patch.participants, notes: patch.notes, endedAt: patch.ended ? new Date() : undefined })
    .where(eq(workshopSessions.id, id))
    .returning();
  return sessionSummary(db, userId, row);
}

// ---------- seeding ----------

export async function seedCard(userId: string, input: { card_number: number; session_id?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const card = await requireCard(tx, userId, input.card_number);
    if (card.killedAt) throw new DomainError("CARD_KILLED", "Restore this card first.");
    let session = input.session_id ? await requireSession(tx, userId, input.session_id) : await activeSession(tx, userId);
    let createdSession = false;
    if (!session) {
      [session] = await tx.insert(workshopSessions).values({ userId, title: defaultSessionTitle(new Date()) }).returning();
      createdSession = true;
      await track(tx, userId, "workshop_session_started", { participant_count: 0 });
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workshopSessionSeeds).where(eq(workshopSessionSeeds.sessionId, session.id));
    await tx.insert(workshopSessionSeeds).values({ sessionId: session.id, cardId: card.id, position: n }).onConflictDoNothing();
    let root = await tx.query.workshopNodes.findFirst({ where: and(eq(workshopNodes.seedCardId, card.id), eq(workshopNodes.kind, "root")) });
    if (!root) {
      [root] = await tx.insert(workshopNodes).values({ userId, seedCardId: card.id, kind: "root", seedVersionId: card.currentVersionId, createdInSessionId: session.id }).returning();
    }
    await fileCard(tx, userId, card, "seeded_in_workshop", { refType: "session", refId: session.id, label: session.title });
    await tx.update(workshopSessions).set({ updatedAt: new Date() }).where(eq(workshopSessions.id, session.id));
    await track(tx, userId, "card_sent_to_workshop", {});
    return { session_id: session.id, root_node_id: root.id, created_session: createdSession };
  });
}

// ---------- map ----------

function nodeDTO(n: WorkshopNode, promotedNumber: number | null): NodeDTO {
  return { id: n.id, kind: n.kind, question_id: n.questionId, text: n.text, author_label: n.authorLabel, angle_label: n.angleLabel, laugh_size: n.laughSize, is_dead_end: n.isDeadEnd, promoted_card_number: promotedNumber, x: n.x, y: n.y, position: n.position, updated_at: n.updatedAt.toISOString() };
}

function questionDTO(q: WorkshopQuestion, systemKey: string | null): QuestionDTO {
  return { id: q.id, node_id: q.nodeId, template_id: q.templateId, text: q.text, short_label: q.shortLabel, category: q.category as QuestionDTO["category"], system_key: systemKey, position: q.position };
}

async function loadMap(db: DbOrTx, userId: string, cardId: string) {
  const nodes = await db.select().from(workshopNodes).where(eq(workshopNodes.seedCardId, cardId)).orderBy(asc(workshopNodes.position), asc(workshopNodes.createdAt));
  const questions = await db
    .select({ q: workshopQuestions, systemKey: questionTemplates.systemKey })
    .from(workshopQuestions)
    .leftJoin(questionTemplates, eq(questionTemplates.id, workshopQuestions.templateId))
    .where(eq(workshopQuestions.seedCardId, cardId))
    .orderBy(asc(workshopQuestions.position), asc(workshopQuestions.createdAt));
  const promotedIds = nodes.map((n) => n.promotedCardId).filter((x): x is string => !!x);
  const promoted = promotedIds.length ? await db.select({ id: cards.id, number: cards.number }).from(cards).where(inArray(cards.id, promotedIds)) : [];
  const pNum = new Map(promoted.map((p) => [p.id, p.number]));
  void userId;
  return {
    nodes: nodes.map((n) => nodeDTO(n, n.promotedCardId ? (pNum.get(n.promotedCardId) ?? null) : null)),
    questions: questions.map((r) => questionDTO(r.q, r.systemKey)),
  };
}

export async function getMap(userId: string, cardNumber: number): Promise<MapDTO> {
  const db = getDb();
  const card = await requireCard(db, userId, cardNumber);
  const map = await loadMap(db, userId, card.id);
  const root = map.nodes.find((n) => n.kind === "root");
  if (!root) throw notFound("That map");
  const angles = map.nodes.filter((n) => n.angle_label).sort((a, b) => a.angle_label!.localeCompare(b.angle_label!)).map((n) => ({ letter: n.angle_label!, node_id: n.id }));
  return {
    seed: await loadCardDTO(db, userId, card),
    root,
    nodes: map.nodes,
    questions: map.questions,
    angles,
    stats: { angle_count: angles.length, node_count: map.nodes.filter((n) => n.kind === "answer").length, promoted_count: map.nodes.filter((n) => n.promoted_card_number !== null).length, dead_end_count: map.nodes.filter((n) => n.is_dead_end).length },
  };
}

export async function getBranch(userId: string, cardNumber: number, angle?: string): Promise<BranchDTO> {
  const db = getDb();
  const card = await requireCard(db, userId, cardNumber);
  const map = await loadMap(db, userId, card.id);
  const angles = map.nodes.filter((n) => n.angle_label).sort((a, b) => a.angle_label!.localeCompare(b.angle_label!));
  let start: NodeDTO | null = null;
  let angleIndex = -1;
  if (angle) {
    angleIndex = angles.findIndex((n) => n.angle_label === angle.toUpperCase());
    if (angleIndex >= 0) start = angles[angleIndex];
  } else if (angles.length) {
    angleIndex = 0;
    start = angles[0];
  }
  const ids = branchPath(map, start?.id ?? null);
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const qById = new Map(map.questions.map((q) => [q.id, q]));
  const path: BranchDTO["path"] = ids.map((id) => (nodeById.has(id) ? { node: nodeById.get(id)! } : { question: qById.get(id)! }));
  return { path, angle: start?.angle_label ?? null, angle_index: angleIndex, angle_count: angles.length, forks: forkPoints(map) };
}

// ---------- questions and answers ----------

async function requireNode(db: DbOrTx, userId: string, id: string): Promise<WorkshopNode> {
  const row = await db.query.workshopNodes.findFirst({ where: and(eq(workshopNodes.id, id), eq(workshopNodes.userId, userId)) });
  if (!row) throw notFound("That node");
  return row;
}

async function requireQuestion(db: DbOrTx, userId: string, id: string): Promise<WorkshopQuestion> {
  const row = await db.query.workshopQuestions.findFirst({ where: and(eq(workshopQuestions.id, id), eq(workshopQuestions.userId, userId)) });
  if (!row) throw notFound("That question");
  return row;
}

async function nodeCount(db: DbOrTx, seedCardId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(workshopNodes).where(eq(workshopNodes.seedCardId, seedCardId));
  return n;
}

export async function askQuestion(userId: string, nodeId: string, input: { template_id?: string; text?: string; short_label?: string; save_to_deck?: boolean; session_id?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const node = await requireNode(tx, userId, nodeId);
    let template: QuestionTemplate | null = null;
    if (input.template_id) {
      template = (await tx.query.questionTemplates.findFirst({ where: and(eq(questionTemplates.id, input.template_id), eq(questionTemplates.userId, userId)) })) ?? null;
      if (!template) throw notFound("That question");
      if (template.category === "rating") return { rating: true as const, question: null };
    } else if (input.save_to_deck && input.text) {
      const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(position), 0) + 1` }).from(questionTemplates).where(eq(questionTemplates.userId, userId));
      [template] = await tx.insert(questionTemplates).values({ userId, text: input.text, shortLabel: input.short_label ?? input.text.slice(0, 40), category: "analyze", position: Number(n) }).returning();
    }
    const text = template?.text ?? input.text!;
    const shortLabel = template?.shortLabel ?? input.short_label ?? text.slice(0, 40);
    const category = (template?.category ?? "analyze") as "analyze" | "audience" | "build";
    const [{ pos }] = await tx.select({ pos: sql<number>`count(*)::int` }).from(workshopQuestions).where(eq(workshopQuestions.nodeId, node.id));
    const [q] = await tx.insert(workshopQuestions).values({ userId, seedCardId: node.seedCardId, nodeId: node.id, templateId: template?.id ?? null, text, shortLabel, category, position: pos, createdInSessionId: input.session_id ?? null }).returning();
    await tx.update(workshopNodes).set({ updatedAt: new Date() }).where(eq(workshopNodes.id, node.id));
    await track(tx, userId, "workshop_question_asked", { category, is_custom: !template?.systemKey });
    return { rating: false as const, question: questionDTO(q, template?.systemKey ?? null) };
  });
}

export async function addAnswer(userId: string, questionId: string, input: { text: string; author_label?: string | null; session_id?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const q = await requireQuestion(tx, userId, questionId);
    if ((await nodeCount(tx, q.seedCardId)) >= 1000) throw limitReached(1000, "nodes on one map");
    const [{ pos }] = await tx.select({ pos: sql<number>`count(*)::int` }).from(workshopNodes).where(eq(workshopNodes.questionId, q.id));
    const [node] = await tx.insert(workshopNodes).values({ userId, seedCardId: q.seedCardId, kind: "answer", questionId: q.id, text: input.text, authorLabel: input.author_label?.trim() || null, position: pos, createdInSessionId: input.session_id ?? null }).returning();
    await touchAncestors(tx, node);
    await recomputeCardStatus(tx, userId, [q.seedCardId]);
    await track(tx, userId, "workshop_answer_added", { has_author: !!input.author_label });
    return nodeDTO(node, null);
  });
}

/** Bump updated_at up the chain so "latest branch" selection reflects recent work. */
async function touchAncestors(db: DbOrTx, node: WorkshopNode) {
  let current: WorkshopNode | undefined = node;
  const now = new Date();
  while (current?.questionId) {
    const q: WorkshopQuestion | undefined = await db.query.workshopQuestions.findFirst({ where: eq(workshopQuestions.id, current.questionId) });
    if (!q) break;
    await db.update(workshopNodes).set({ updatedAt: now }).where(eq(workshopNodes.id, q.nodeId));
    current = await db.query.workshopNodes.findFirst({ where: eq(workshopNodes.id, q.nodeId) });
  }
}

export async function patchNode(userId: string, id: string, patch: { text?: string; author_label?: string | null; laugh_size?: "table" | "big" | "unsure" | null; is_dead_end?: boolean; angle?: boolean; x?: number | null; y?: number | null }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const node = await requireNode(tx, userId, id);
    if (node.kind === "root" && patch.text !== undefined) throw new DomainError("VALIDATION_ERROR", "Edit the seed card itself.");
    const set: Partial<typeof workshopNodes.$inferInsert> = {};
    if (patch.text !== undefined) set.text = patch.text;
    if (patch.author_label !== undefined) set.authorLabel = patch.author_label?.trim() || null;
    if (patch.laugh_size !== undefined) {
      set.laughSize = patch.laugh_size;
      if (node.promotedCardId) await tx.update(cards).set({ laughSize: patch.laugh_size }).where(eq(cards.id, node.promotedCardId));
    }
    if (patch.is_dead_end !== undefined) {
      set.isDeadEnd = patch.is_dead_end;
      if (patch.is_dead_end) await track(tx, userId, "workshop_dead_end_marked", {});
    }
    if (patch.x !== undefined) set.x = patch.x;
    if (patch.y !== undefined) set.y = patch.y;
    if (patch.angle !== undefined) {
      if (patch.angle && !node.angleLabel) {
        const used = await tx.select({ l: workshopNodes.angleLabel }).from(workshopNodes).where(and(eq(workshopNodes.seedCardId, node.seedCardId), sql`${workshopNodes.angleLabel} is not null`));
        const letter = nextAngleLetter(new Set(used.map((u) => u.l!)));
        if (!letter) throw new DomainError("ANGLE_LIMIT", "You've used every angle letter on this map.");
        set.angleLabel = letter;
        await track(tx, userId, "workshop_angle_marked", {});
      } else if (!patch.angle) set.angleLabel = null;
    }
    const [row] = await tx.update(workshopNodes).set({ ...set, updatedAt: new Date() }).where(eq(workshopNodes.id, id)).returning();
    const promotedNumber = row.promotedCardId ? ((await tx.query.cards.findFirst({ where: eq(cards.id, row.promotedCardId), columns: { number: true } }))?.number ?? null) : null;
    return nodeDTO(row, promotedNumber);
  });
}

export async function deleteNode(userId: string, id: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const node = await requireNode(tx, userId, id);
    if (node.kind === "root") throw new DomainError("ROOT_UNDELETABLE", "Remove the seed from the session instead.");
    await tx.delete(workshopNodes).where(eq(workshopNodes.id, id)); // cascades questions → answers
    await recomputeCardStatus(tx, userId, [node.seedCardId]);
  });
}

export async function deleteQuestion(userId: string, id: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const q = await requireQuestion(tx, userId, id);
    await tx.delete(workshopQuestions).where(eq(workshopQuestions.id, id));
    await recomputeCardStatus(tx, userId, [q.seedCardId]);
  });
}

/** Counts for the M10 confirmation. */
export async function nodeDeleteImpact(userId: string, id: string) {
  const db = getDb();
  const node = await requireNode(db, userId, id);
  const map = await loadMap(db, userId, node.seedCardId);
  const d = descendantIds(map, id);
  const promoted = map.nodes.filter((n) => d.nodeIds.includes(n.id) && n.promoted_card_number !== null).map((n) => n.promoted_card_number!);
  return { follow_ups: d.nodeIds.length, promoted };
}

// ---------- promotion and themes ----------

export async function promoteNode(userId: string, nodeId: string, sessionId?: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const node = await requireNode(tx, userId, nodeId);
    if (node.kind !== "answer") throw new DomainError("VALIDATION_ERROR", "Only answers can be promoted.");
    if (node.promotedCardId) {
      const existing = await tx.query.cards.findFirst({ where: eq(cards.id, node.promotedCardId), columns: { number: true } });
      throw new DomainError("ALREADY_PROMOTED", "Already promoted.", { card_number: existing?.number ?? null });
    }
    const seed = (await getCardRowById(tx, userId, node.seedCardId))!;
    const q = await requireQuestion(tx, userId, node.questionId!);
    const template = q.templateId ? await tx.query.questionTemplates.findFirst({ where: eq(questionTemplates.id, q.templateId) }) : null;
    const session = sessionId ? await requireSession(tx, userId, sessionId) : node.createdInSessionId ? await tx.query.workshopSessions.findFirst({ where: eq(workshopSessions.id, node.createdInSessionId) }) : null;
    const { card, version } = await createCardWithVersion(tx, userId, {
      kind: "joke",
      title: null,
      body: node.text!,
      form: template?.systemKey === "punchline" ? "line" : null,
      captureSource: "desktop",
      inboxState: "filed",
      laughSize: node.laughSize,
      createdContext: "workshop",
      createdContextRefId: session?.id ?? null,
      createdContextLabel: session ? `Workshop ${session.title}` : "Workshop",
    });
    const root = await tx.query.workshopNodes.findFirst({ where: and(eq(workshopNodes.seedCardId, seed.id), eq(workshopNodes.kind, "root")) });
    const seedVersionId = root?.seedVersionId ?? seed.currentVersionId;
    await tx.insert(cardLinks).values({ userId, relation: "promoted_from", sourceCardId: seed.id, sourceVersionId: seedVersionId, derivedCardId: card.id, derivedVersionId: version.id, viaWorkshopNodeId: node.id });
    const subs = (await loadSubjectsFor(tx, [seed.id])).get(seed.id) ?? [];
    for (const s of subs) await tx.execute(sql`insert into card_subject_tags (card_id, tag_id, source) values (${card.id}, ${s.id}, 'inherited') on conflict do nothing`);
    const ths = (await loadThemesFor(tx, [seed.id])).get(seed.id) ?? [];
    for (const t of ths) await attachTheme(tx, userId, card.id, t.id, "inherited", null);
    await tx.update(workshopNodes).set({ promotedCardId: card.id, updatedAt: new Date() }).where(eq(workshopNodes.id, node.id));
    await logCardEvent(tx, { userId, cardId: card.id, type: "promoted", versionId: version.id, refType: "card", refId: seed.id, label: session?.title ?? null });
    await logCardEvent(tx, { userId, cardId: seed.id, type: "promoted", refType: "card", refId: card.id, label: session?.title ?? null });
    await recomputeCardStatus(tx, userId, [seed.id, card.id]);
    await track(tx, userId, "workshop_node_promoted", { question_category: q.category });
    return loadCardDTO(tx, userId, (await getCardRowById(tx, userId, card.id))!);
  });
}

export async function saveNodeTheme(userId: string, nodeId: string, name: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const node = await requireNode(tx, userId, nodeId);
    if (node.kind !== "answer") throw new DomainError("NOT_A_POINT_ANSWER", "Themes come from answers.");
    const q = await requireQuestion(tx, userId, node.questionId!);
    const template = q.templateId ? await tx.query.questionTemplates.findFirst({ where: eq(questionTemplates.id, q.templateId) }) : null;
    if (template?.systemKey !== "point" && q.category !== "analyze") throw new DomainError("NOT_A_POINT_ANSWER", "Only answers to analysis questions become themes.");
    const { theme, created } = await ensureTheme(tx, userId, name, "workshop_answer", node.id);
    await attachTheme(tx, userId, node.seedCardId, theme.id, "workshop_answer", node.id);
    return { theme: { id: theme.id, name: theme.name, source: theme.source }, created };
  });
}

export async function tidyMap(userId: string, cardNumber: number) {
  const db = getDb();
  const card = await requireCard(db, userId, cardNumber);
  await db.update(workshopNodes).set({ x: null, y: null }).where(eq(workshopNodes.seedCardId, card.id));
}

// ---------- question deck ----------

function templateDTO(t: QuestionTemplate): QuestionTemplateDTO {
  return { id: t.id, system_key: t.systemKey, text: t.text, short_label: t.shortLabel, category: t.category, position: t.position, archived: t.archivedAt !== null };
}

export async function listTemplates(userId: string, includeArchived = false) {
  const db = getDb();
  const rows = await db.select().from(questionTemplates).where(and(eq(questionTemplates.userId, userId), includeArchived ? sql`true` : isNull(questionTemplates.archivedAt))).orderBy(asc(questionTemplates.position));
  return { items: rows.map(templateDTO) };
}

export async function createTemplate(userId: string, input: { text: string; short_label: string; category: "analyze" | "audience" | "build" }) {
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(position), 0) + 1` }).from(questionTemplates).where(eq(questionTemplates.userId, userId));
  const [row] = await db.insert(questionTemplates).values({ userId, text: input.text, shortLabel: input.short_label, category: input.category, position: Number(n) }).returning();
  return templateDTO(row);
}

export async function patchTemplate(userId: string, id: string, patch: { text?: string; short_label?: string; category?: "analyze" | "audience" | "build"; archived?: boolean }) {
  const db = getDb();
  const t = await db.query.questionTemplates.findFirst({ where: and(eq(questionTemplates.id, id), eq(questionTemplates.userId, userId)) });
  if (!t) throw notFound("That question");
  if (t.systemKey && patch.category && patch.category !== t.category) throw new DomainError("VALIDATION_ERROR", "Built-in questions keep their category.");
  const [row] = await db
    .update(questionTemplates)
    .set({ text: patch.text, shortLabel: patch.short_label, category: patch.category, archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null })
    .where(eq(questionTemplates.id, id))
    .returning();
  return templateDTO(row);
}

export async function reorderTemplates(userId: string, ids: string[]) {
  const db = getDb();
  const rows = await db.select({ id: questionTemplates.id }).from(questionTemplates).where(eq(questionTemplates.userId, userId));
  const have = new Set(rows.map((r) => r.id));
  if (ids.length !== have.size || !ids.every((i) => have.has(i))) throw new DomainError("ORDER_MISMATCH", "Deck order doesn't match.");
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) await tx.update(questionTemplates).set({ position: i + 1 }).where(eq(questionTemplates.id, ids[i]));
  });
  return listTemplates(userId, true);
}
