import { describe, expect, it } from "vitest";
import { primarySubject, setNotes } from "@/domain/heuristics";

const names = { o: "Opener: the flight in", s: "Airport security", h: "Hotel pillows", c: "Closer: Doug callback", d: "Dad's texts", p: "Airport people" };
const subjects = { o: "airports", s: "airports", h: "hotels", c: "airports", d: "parents", p: "airports" };
const base = {
  names,
  primarySubjects: subjects,
  callbacks: [],
  runtimeSeconds: 280,
  targetSeconds: 300,
};
const codes = (n: ReturnType<typeof setNotes>) => n.map((x) => x.code);

describe("setNotes (Rule 7.9 heuristics)", () => {
  it("H1/H2/P3 fire on opener and closer positions", () => {
    const n = setNotes({ ...base, bitIds: ["d", "o", "s", "h", "c"] });
    expect(codes(n)).toContain("H1");
    expect(codes(n)).toContain("P3");
    const n2 = setNotes({ ...base, bitIds: ["o", "s", "h", "c", "d"] });
    expect(codes(n2)).toContain("H2");
    expect(codes(n2)).not.toContain("P3");
  });
  it("H3 reports same-subject adjacency on the working copy", () => {
    const n = setNotes({ ...base, bitIds: ["o", "s", "h", "c"] });
    expect(n.find((x) => x.code === "H3")?.text).toBe("Airports bits back to back: yes");
    const n2 = setNotes({ ...base, bitIds: ["o", "h", "s"] });
    expect(n2.find((x) => x.code === "H3")?.text).toBe("Same-subject bits back to back: no");
  });
  it("H4 odd fit for an inserted bit between two same-subject bits", () => {
    const n = setNotes({ ...base, bitIds: ["o", "d", "s", "h", "c"], insertedBitId: "d", baseBitIds: ["o", "s", "h", "c"] });
    expect(codes(n)).toContain("H4");
    const n2 = setNotes({ ...base, bitIds: ["o", "s", "d", "h", "c"], insertedBitId: "d", baseBitIds: ["o", "s", "h", "c"] });
    expect(codes(n2)).not.toContain("H4");
  });
  it("P2 keeps run intact only when the base run is still adjacent", () => {
    const n = setNotes({ ...base, bitIds: ["o", "s", "d", "h", "c"], insertedBitId: "d", baseBitIds: ["o", "s", "h", "c"] });
    expect(codes(n)).toContain("P2");
    const n2 = setNotes({ ...base, bitIds: ["o", "d", "s", "h", "c"], insertedBitId: "d", baseBitIds: ["o", "s", "h", "c"] });
    expect(codes(n2)).not.toContain("P2");
  });
  it("H5 callback order and missing target", () => {
    const n = setNotes({ ...base, bitIds: ["o", "s"], callbacks: [{ fromPosition: 0, targetFirstPosition: 1, cardNumber: 421 }] });
    expect(n.find((x) => x.code === "H5")?.text).toBe("Callback to #0421 comes before its setup.");
    const n2 = setNotes({ ...base, bitIds: ["o", "s"], callbacks: [{ fromPosition: 1, targetFirstPosition: null, cardNumber: 421 }] });
    expect(n2.find((x) => x.code === "H5")?.text).toBe("Callback to #0421, which isn't in this set.");
    const n3 = setNotes({ ...base, bitIds: ["o", "s"], callbacks: [{ fromPosition: 1, targetFirstPosition: 0, cardNumber: 421 }] });
    expect(codes(n3)).not.toContain("H5");
  });
  it("H6 over target", () => {
    const n = setNotes({ ...base, bitIds: ["o"], runtimeSeconds: 365, targetSeconds: 300 });
    expect(n.find((x) => x.code === "H6")?.text).toBe("Over target by 1:05.");
    expect(codes(setNotes({ ...base, bitIds: ["o"], runtimeSeconds: 300 }))).not.toContain("H6");
  });
  it("P1 fewest transitions only when another column has more", () => {
    expect(codes(setNotes({ ...base, bitIds: ["o"], siblingTransitionsToWrite: [2, 3], ownTransitionsToWrite: 2 }))).toContain("P1");
    expect(codes(setNotes({ ...base, bitIds: ["o"], siblingTransitionsToWrite: [2, 2], ownTransitionsToWrite: 2 }))).not.toContain("P1");
  });
});

describe("primarySubject", () => {
  it("picks the most frequent, ties alphabetical, null when none", () => {
    expect(primarySubject([["dad", "texting"], ["dad"], ["texting", "airports"]])).toBe("dad");
    expect(primarySubject([["b"], ["a"]])).toBe("a");
    expect(primarySubject([[], []])).toBeNull();
  });
});
