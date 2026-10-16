import { describe, expect, it } from "vitest";
import { normalizeSubject, normalizeSubjects, suggestSubjectsFromText } from "@/domain/tags";

describe("normalizeSubject (Rule 7.6)", () => {
  it("lowercases, strips #, replaces _ and collapses whitespace", () => {
    expect(normalizeSubject(" #Dad_Jokes ")).toBe("dad jokes");
    expect(normalizeSubject("Air   ports")).toBe("air ports");
  });
  it("rejects empty and > 40 chars", () => {
    expect(normalizeSubject("   ")).toBeNull();
    expect(normalizeSubject("!!!")).toBeNull();
    expect(normalizeSubject("a".repeat(41))).toBeNull();
    expect(normalizeSubject("a".repeat(40))).toBe("a".repeat(40));
  });
  it("does not singularise", () => {
    expect(normalizeSubject("dads")).toBe("dads");
  });
  it("dedupes in bulk", () => {
    expect(normalizeSubjects(["Dad", "dad", "#dad", "!!!"])).toEqual({ names: ["dad"], invalid: ["!!!"] });
  });
});

describe("suggestSubjectsFromText", () => {
  const existing = [
    { name: "airports", count: 5 },
    { name: "dad", count: 9 },
    { name: "hotels", count: 2 },
    { name: "dating apps", count: 1 },
  ];
  it("matches whole words with simple plural stripping, ranked by usage", () => {
    expect(suggestSubjectsFromText("My dad hates airport lines and dating apps", existing)).toEqual([
      "dad",
      "airports",
      "dating apps",
    ]);
  });
  it("does not match substrings", () => {
    expect(suggestSubjectsFromText("daddy issues at the hotel", existing)).toEqual(["hotels"]);
  });
});
