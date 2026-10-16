import { describe, expect, it } from "vitest";
import { deriveStatus } from "@/domain/status";

const d = (s: string) => new Date(s);

describe("deriveStatus (Rule 7.4)", () => {
  it("new note is raw; with answers workshopped; killed wins", () => {
    expect(deriveStatus({ killed: false, kind: "note", hasWorkshopAnswers: false, appearances: [] })).toBe("raw");
    expect(deriveStatus({ killed: false, kind: "note", hasWorkshopAnswers: true, appearances: [] })).toBe(
      "workshopped",
    );
    expect(deriveStatus({ killed: true, kind: "note", hasWorkshopAnswers: true, appearances: [] })).toBe("killed");
  });
  it("jokes are promoted; tested after a flat mark; landed after a later landed mark", () => {
    expect(deriveStatus({ killed: false, kind: "joke", hasWorkshopAnswers: false, appearances: [] })).toBe("promoted");
    const flat = { performedOn: "2026-09-13", updatedAt: d("2026-09-13T22:00:00Z"), result: "flat" as const };
    const landed = { performedOn: "2026-09-20", updatedAt: d("2026-09-20T22:00:00Z"), result: "landed" as const };
    expect(deriveStatus({ killed: false, kind: "joke", hasWorkshopAnswers: false, appearances: [flat] })).toBe("tested");
    expect(deriveStatus({ killed: false, kind: "joke", hasWorkshopAnswers: false, appearances: [flat, landed] })).toBe(
      "landed",
    );
    // deleting the landed mark → tested
    expect(deriveStatus({ killed: false, kind: "joke", hasWorkshopAnswers: false, appearances: [flat] })).toBe("tested");
  });
  it("ties on date break by mark updated_at", () => {
    const a = { performedOn: "2026-09-20", updatedAt: d("2026-09-20T22:00:00Z"), result: "landed" as const };
    const b = { performedOn: "2026-09-20", updatedAt: d("2026-09-20T23:00:00Z"), result: "cut" as const };
    expect(deriveStatus({ killed: false, kind: "note", hasWorkshopAnswers: false, appearances: [a, b] })).toBe("tested");
  });
});
