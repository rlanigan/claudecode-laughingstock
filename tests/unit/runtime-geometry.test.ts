import { describe, expect, it } from "vitest";
import { bitDurationSeconds, formatMmSs, parseMmSs, transitionSeconds } from "@/domain/runtime";
import { clusterBounds, landingSlot, placeBesideTarget, tidyLayout } from "@/domain/board-geometry";

describe("runtime", () => {
  it("rounds bit duration to 5 s and honours overrides", () => {
    expect(bitDurationSeconds(150, 150, null)).toBe(60);
    expect(bitDurationSeconds(152, 150, null)).toBe(60);
    expect(bitDurationSeconds(160, 150, null)).toBe(65);
    expect(bitDurationSeconds(160, 150, 42)).toBe(42);
    expect(bitDurationSeconds(150, 100, null)).toBe(90);
  });
  it("transition seconds are not rounded", () => {
    expect(transitionSeconds(15, 150)).toBe(6);
  });
  it("formats and parses m:ss", () => {
    expect(formatMmSs(65)).toBe("1:05");
    expect(formatMmSs(0)).toBe("0:00");
    expect(parseMmSs("5:00")).toBe(300);
    expect(parseMmSs("300")).toBe(300);
    expect(parseMmSs("x")).toBeNull();
  });
});

describe("board geometry", () => {
  it("cluster bounds pad 16 px and 20 px on top", () => {
    expect(clusterBounds([{ x: 100, y: 100, w: 190, h: 110 }])).toEqual({ x: 84, y: 64, w: 222, h: 162 });
  });
  it("landing slot finds the first free grid cell", () => {
    expect(landingSlot([])).toEqual({ x: 24, y: 24 });
    expect(landingSlot([{ x: 24, y: 24, w: 190, h: 110 }])).toEqual({ x: 234, y: 24 });
  });
  it("places beside target, wrapping at the canvas edge", () => {
    expect(placeBesideTarget({ x: 100, y: 50, w: 190, h: 110 })).toEqual({ x: 306, y: 50 });
    expect(placeBesideTarget({ x: 3900, y: 50, w: 190, h: 110 })).toEqual({ x: 3900, y: 176 });
  });
  it("tidy lays clusters in a 2-column grid and loose cards below", () => {
    const out = tidyLayout([{ id: "c1", itemIds: ["a", "b", "c"] }], ["l1"]);
    expect(out.a.y).toBe(out.b.y);
    expect(out.b.x).toBeGreaterThan(out.a.x);
    expect(out.c.y).toBeGreaterThan(out.a.y);
    expect(out.l1.y).toBeGreaterThan(out.c.y);
  });
});
