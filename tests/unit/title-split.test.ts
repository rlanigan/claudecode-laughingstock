import { describe, expect, it } from "vitest";
import { displayTitle, splitTitle, wordCount, displayNumber } from "@/domain/title-split";

describe("splitTitle (Rule 7.3)", () => {
  it("splits first line into title", () => {
    expect(splitTitle("A\nB")).toEqual({ title: "A", body: "B" });
  });
  it("single line → no title", () => {
    expect(splitTitle("A")).toEqual({ title: null, body: "A" });
  });
  it("trailing blank lines → no title", () => {
    expect(splitTitle("A\n\n")).toEqual({ title: null, body: "A" });
  });
  it("first line over 200 chars → whole text is body", () => {
    const long = "x".repeat(201);
    expect(splitTitle(`${long}\nbody`)).toEqual({ title: null, body: `${long}\nbody` });
  });
  it("normalises CRLF and trims", () => {
    expect(splitTitle("  Dad's texts\r\nHe replied \"k\".  ")).toEqual({
      title: "Dad's texts",
      body: 'He replied "k".',
    });
  });
});

describe("displayTitle", () => {
  it("uses the title when present", () => {
    expect(displayTitle("T", "body")).toBe("T");
  });
  it("truncates body at a word boundary", () => {
    const t = displayTitle(null, "the quick brown fox jumps over the lazy dog again and again and again", 30);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(31);
  });
});

describe("helpers", () => {
  it("counts words", () => {
    expect(wordCount("Dad's texts", "He replied k")).toBe(5);
  });
  it("formats numbers", () => {
    expect(displayNumber(42)).toBe("#0042");
    expect(displayNumber(12345)).toBe("#12345");
  });
});
