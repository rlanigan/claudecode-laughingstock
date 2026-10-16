import { describe, expect, it } from "vitest";
import { branchPath, descendantIds, forkPoints, nextAngleLetter } from "@/domain/workshop";
import type { NodeDTO, QuestionDTO } from "@/types/dto";

const node = (id: string, over: Partial<NodeDTO> = {}): NodeDTO => ({
  id,
  kind: "answer",
  question_id: null,
  text: id,
  author_label: null,
  angle_label: null,
  laugh_size: null,
  is_dead_end: false,
  promoted_card_number: null,
  x: null,
  y: null,
  position: 0,
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});
const q = (id: string, node_id: string, position = 0): QuestionDTO => ({
  id,
  node_id,
  template_id: null,
  text: id,
  short_label: id,
  category: "analyze",
  system_key: null,
  position,
});

describe("nextAngleLetter", () => {
  it("assigns A, B and reuses freed letters", () => {
    expect(nextAngleLetter(new Set())).toBe("A");
    expect(nextAngleLetter(new Set(["A"]))).toBe("B");
    expect(nextAngleLetter(new Set(["B"]))).toBe("A");
    expect(nextAngleLetter(new Set(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))))).toBeNull();
  });
});

describe("branchPath (Rule 7.8)", () => {
  // root -q1-> a1 -q2-> a2 (older), a3 (newer, dead end), a4 (newest, live) -q3-> a5
  const map = {
    nodes: [
      node("root", { kind: "root", text: null }),
      node("a1", { question_id: "q1", angle_label: "A" }),
      node("a2", { question_id: "q2", updated_at: "2026-10-02T00:00:00Z" }),
      node("a3", { question_id: "q2", updated_at: "2026-10-05T00:00:00Z", is_dead_end: true, position: 1 }),
      node("a4", { question_id: "q2", updated_at: "2026-10-03T00:00:00Z", position: 2 }),
      node("a5", { question_id: "q3", updated_at: "2026-10-04T00:00:00Z" }),
    ],
    questions: [q("q1", "root"), q("q2", "a1"), q("q3", "a4")],
  };
  it("descends into the most recently updated live subtree", () => {
    expect(branchPath(map, "a1")).toEqual(["root", "q1", "a1", "q2", "a4", "q3", "a5"]);
  });
  it("starts from the root when no angle", () => {
    expect(branchPath(map, null)).toEqual(["root", "q1", "a1", "q2", "a4", "q3", "a5"]);
  });
  it("falls back to dead ends when every child is one", () => {
    const m2 = {
      nodes: [node("root", { kind: "root", text: null }), node("x", { question_id: "q1", is_dead_end: true })],
      questions: [q("q1", "root")],
    };
    expect(branchPath(m2, null)).toEqual(["root", "q1", "x"]);
  });
  it("reports fork points and descendants", () => {
    expect(forkPoints(map)).toEqual([{ node_id: "a1", child_count: 3 }]);
    expect(descendantIds(map, "a1")).toEqual({ nodeIds: ["a2", "a3", "a4", "a5"], questionIds: ["q2", "q3"] });
  });
});
