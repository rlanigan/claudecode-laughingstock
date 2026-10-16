// Rule 7.8 — workshop rules (angle letters, phone branch path).
import type { NodeDTO, QuestionDTO } from "@/types/dto";

export const MAX_ANGLES = 26;

/** First unused letter A–Z, or null when every letter is taken. */
export function nextAngleLetter(used: Set<string>): string | null {
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  return null;
}

export interface MapShape {
  nodes: NodeDTO[];
  questions: QuestionDTO[];
}

interface Index {
  nodeById: Map<string, NodeDTO>;
  questionById: Map<string, QuestionDTO>;
  questionsOfNode: Map<string, QuestionDTO[]>;
  answersOfQuestion: Map<string, NodeDTO[]>;
}

function indexMap(map: MapShape): Index {
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const questionById = new Map(map.questions.map((q) => [q.id, q]));
  const questionsOfNode = new Map<string, QuestionDTO[]>();
  for (const q of [...map.questions].sort((a, b) => a.position - b.position)) {
    const list = questionsOfNode.get(q.node_id) ?? [];
    list.push(q);
    questionsOfNode.set(q.node_id, list);
  }
  const answersOfQuestion = new Map<string, NodeDTO[]>();
  for (const n of [...map.nodes].sort((a, b) => a.position - b.position)) {
    if (!n.question_id) continue;
    const list = answersOfQuestion.get(n.question_id) ?? [];
    list.push(n);
    answersOfQuestion.set(n.question_id, list);
  }
  return { nodeById, questionById, questionsOfNode, answersOfQuestion };
}

/** Child answers (across all questions) of a node. */
export function childAnswers(map: MapShape, nodeId: string): NodeDTO[] {
  const idx = indexMap(map);
  return (idx.questionsOfNode.get(nodeId) ?? []).flatMap((q) => idx.answersOfQuestion.get(q.id) ?? []);
}

/** Latest updated_at anywhere in the subtree rooted at nodeId (inclusive). */
export function subtreeLatest(idx: Index, nodeId: string): string {
  const node = idx.nodeById.get(nodeId);
  let latest = node?.updated_at ?? "";
  for (const q of idx.questionsOfNode.get(nodeId) ?? []) {
    for (const a of idx.answersOfQuestion.get(q.id) ?? []) {
      const t = subtreeLatest(idx, a.id);
      if (t > latest) latest = t;
    }
  }
  return latest;
}

/** Ancestor chain root → … → nodeId as alternating node/question ids. */
export function ancestorPath(map: MapShape, nodeId: string): string[] {
  const idx = indexMap(map);
  const path: string[] = [];
  let current: NodeDTO | undefined = idx.nodeById.get(nodeId);
  while (current) {
    path.unshift(current.id);
    if (!current.question_id) break;
    const q = idx.questionById.get(current.question_id);
    if (!q) break;
    path.unshift(q.id);
    current = idx.nodeById.get(q.node_id);
  }
  return path;
}

/**
 * Phone branch path (Rule 7.8): ancestors of startNodeId (or the root when null), then
 * repeatedly descend into the child answer whose subtree was most recently updated,
 * skipping dead ends unless every child is a dead end. Returns alternating node and
 * question ids, starting at the root node.
 */
export function branchPath(map: MapShape, startNodeId: string | null): string[] {
  const idx = indexMap(map);
  const root = map.nodes.find((n) => n.kind === "root");
  if (!root) return [];
  const start = startNodeId ?? root.id;
  const path = ancestorPath(map, start);
  let currentId = start;
  for (let guard = 0; guard < 10_000; guard++) {
    const questions = idx.questionsOfNode.get(currentId) ?? [];
    let best: { q: QuestionDTO; a: NodeDTO; t: string } | null = null;
    const candidates: { q: QuestionDTO; a: NodeDTO }[] = [];
    for (const q of questions) for (const a of idx.answersOfQuestion.get(q.id) ?? []) candidates.push({ q, a });
    if (candidates.length === 0) break;
    const live = candidates.filter((c) => !c.a.is_dead_end);
    const pool = live.length > 0 ? live : candidates;
    for (const c of pool) {
      const t = subtreeLatest(idx, c.a.id);
      if (!best || t > best.t) best = { ...c, t };
    }
    if (!best) break;
    path.push(best.q.id, best.a.id);
    currentId = best.a.id;
  }
  return path;
}

/** Answer nodes that have more than one child answer (for the "N branches" switcher). */
export function forkPoints(map: MapShape): { node_id: string; child_count: number }[] {
  const idx = indexMap(map);
  const out: { node_id: string; child_count: number }[] = [];
  for (const n of map.nodes) {
    const count = (idx.questionsOfNode.get(n.id) ?? []).reduce(
      (acc, q) => acc + (idx.answersOfQuestion.get(q.id)?.length ?? 0),
      0,
    );
    if (count > 1) out.push({ node_id: n.id, child_count: count });
  }
  return out;
}

/** Ids of all descendants (nodes and questions) of a node, excluding the node itself. */
export function descendantIds(map: MapShape, nodeId: string): { nodeIds: string[]; questionIds: string[] } {
  const idx = indexMap(map);
  const nodeIds: string[] = [];
  const questionIds: string[] = [];
  const walk = (id: string) => {
    for (const q of idx.questionsOfNode.get(id) ?? []) {
      questionIds.push(q.id);
      for (const a of idx.answersOfQuestion.get(q.id) ?? []) {
        nodeIds.push(a.id);
        walk(a.id);
      }
    }
  };
  walk(nodeId);
  return { nodeIds, questionIds };
}

/** The default session title, "Session · Sep 29". */
export function defaultSessionTitle(d: Date): string {
  return `Session · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export const ACTIVE_SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;
