import { describe, expect, it } from "vitest";
import {
  nextBranch,
  parseVersionLabel,
  shouldEditInPlace,
  shouldIncrementEditCount,
  versionLabel,
  type EditTarget,
} from "@/domain/versioning";

const base = (over: Partial<EditTarget> = {}): EditTarget => ({
  sealed: false,
  hasChildren: false,
  pinnedByOtherContainers: false,
  cardInInbox: false,
  versionContext: "review",
  versionContextRef: null,
  lastEditedAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});
const min = (m: number) => new Date(new Date("2026-10-01T10:00:00Z").getTime() + m * 60_000);

describe("shouldEditInPlace (Rule V3)", () => {
  it("inbox cards always edit in place", () => {
    expect(shouldEditInPlace(base({ cardInInbox: true, versionContext: "capture" }), "inbox", null, min(60 * 48))).toBe(
      true,
    );
  });
  it("same context within 30 min edits in place", () => {
    expect(shouldEditInPlace(base(), "review", null, min(10))).toBe(true);
    expect(shouldEditInPlace(base(), "review", null, min(30))).toBe(true);
  });
  it("same context after 31 min branches", () => {
    expect(shouldEditInPlace(base(), "review", null, min(31))).toBe(false);
  });
  it("different context branches", () => {
    expect(shouldEditInPlace(base(), "board", "b1", min(1))).toBe(false);
  });
  it("sealed, children, or other pins force a new version", () => {
    expect(shouldEditInPlace(base({ sealed: true }), "review", null, min(1))).toBe(false);
    expect(shouldEditInPlace(base({ hasChildren: true }), "review", null, min(1))).toBe(false);
    expect(shouldEditInPlace(base({ pinnedByOtherContainers: true }), "review", null, min(1))).toBe(false);
    expect(shouldEditInPlace(base({ sealed: true, cardInInbox: true }), "inbox", null, min(1))).toBe(false);
  });
});

describe("nextBranch (Rule V4)", () => {
  it("first child continues the parent line", () => {
    expect(nextBranch(2, "", new Set())).toEqual({ depth: 3, branch: "" });
  });
  it("second child of v2 becomes v3b", () => {
    expect(nextBranch(2, "", new Set([""]))).toEqual({ depth: 3, branch: "b" });
  });
  it("child of v3b becomes v4b when free", () => {
    expect(nextBranch(3, "b", new Set([""]))).toEqual({ depth: 4, branch: "b" });
  });
  it("second child of v3 when v4 and v4b exist → v4c", () => {
    expect(nextBranch(3, "", new Set(["", "b"]))).toEqual({ depth: 4, branch: "c" });
  });
  it("after z comes z2", () => {
    const used = new Set(["", ...Array.from({ length: 25 }, (_, i) => String.fromCharCode(98 + i))]);
    expect(nextBranch(1, "", used)).toEqual({ depth: 2, branch: "z2" });
  });
  it("labels", () => {
    expect(versionLabel(3, "b")).toBe("v3b");
    expect(parseVersionLabel("v3b")).toEqual({ depth: 3, branch: "b" });
    expect(parseVersionLabel("v12")).toEqual({ depth: 12, branch: "" });
    expect(parseVersionLabel("x")).toBeNull();
  });
});

describe("shouldIncrementEditCount", () => {
  it("increments only when > 2 min apart", () => {
    expect(shouldIncrementEditCount(min(0), min(1))).toBe(false);
    expect(shouldIncrementEditCount(min(0), min(3))).toBe(true);
  });
});
