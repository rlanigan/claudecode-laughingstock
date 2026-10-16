import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { cardVersions } from "@/db/schema";
import { freshUser } from "../helpers";
import {
  addPart,
  captureCard,
  combineCards,
  deleteCardForever,
  detachCopy,
  editCard,
  getCard,
  keepCard,
  killCard,
  listCards,
  restoreCard,
  setCardSubjects,
  splitCard,
  versionAction,
} from "@/server/services/cards";
import { getDiff, getLineage } from "@/server/services/lineage";
import { applyTextEdit } from "@/server/services/versions";
import { requireCard, requireVersion } from "@/server/repos/cards";
import { DomainError } from "@/server/errors";

let userId: string;
beforeAll(async () => {
  userId = await freshUser("cards");
});
afterAll(async () => {
  await closeDb();
});

const capture = (text: string, extra: Partial<Parameters<typeof captureCard>[1]> = {}) =>
  captureCard(userId, { text, kind: "note", subjects: [], capture_source: "phone", ...extra });

describe("capture", () => {
  it("creates a card with v1, splits the title, numbers sequentially", async () => {
    const { card, created } = await capture("Dad's texts\nSent him three paragraphs. He replied \"k\".", { subjects: ["Parents"] });
    expect(created).toBe(true);
    expect(card.number).toBe(1);
    expect(card.display_number).toBe("#0001");
    expect(card.current_version.title).toBe("Dad's texts");
    expect(card.current_version.label).toBe("v1");
    expect(card.subjects.map((s) => s.name)).toEqual(["parents"]);
    expect(card.inbox_state).toBe("inbox");
    expect(card.status).toBe("raw");
    const second = await capture("Second");
    expect(second.card.number).toBe(2);
  });
  it("is idempotent on client_id", async () => {
    const clientId = randomUUID();
    const a = await capture("Once", { client_id: clientId });
    const b = await capture("Twice", { client_id: clientId });
    expect(b.created).toBe(false);
    expect(b.card.id).toBe(a.card.id);
    expect(b.card.current_version.body).toBe("Once");
  });
  it("rejects empty text and invalid tags", async () => {
    await expect(capture("   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(capture("ok", { subjects: ["!!!"] })).rejects.toMatchObject({ code: "TAG_INVALID" });
    await expect(capture("ok", { subjects: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toMatchObject({ code: "TAG_LIMIT" });
  });
});

describe("versioning (Rule 7.2)", () => {
  it("edits in the inbox never create v2", async () => {
    const { card } = await capture("inbox edit");
    let c = card;
    for (let i = 0; i < 5; i++) {
      const r = await editCard(userId, c.number, { rev: c.rev, context: { type: "inbox", id: null }, body: `inbox edit ${i}` });
      expect(r.created_new_version).toBe(false);
      c = r.card;
    }
    expect(c.version_count).toBe(1);
    expect(c.current_version.body).toBe("inbox edit 4");
  });

  it("filed card edits create v2, then in-place within 30 min, then v3 after", async () => {
    const { card } = await capture("filed edit");
    await keepCard(userId, card.number);
    const db = getDb();
    const row = await requireCard(db, userId, card.number);
    const v1 = await requireVersion(db, row.id, "v1");
    const t0 = new Date("2026-10-01T10:00:00Z");
    const r1 = await applyTextEdit(db, userId, row, v1, { body: "filed edit A" }, { type: "review", refId: null, label: "Review" }, { now: t0 });
    expect(r1.createdNew).toBe(true);
    expect(r1.version.label).toBe("v2");
    const r2 = await applyTextEdit(db, userId, { ...row, currentVersionId: r1.version.id }, r1.version, { body: "filed edit B" }, { type: "review", refId: null, label: "Review" }, { now: new Date(t0.getTime() + 10 * 60_000) });
    expect(r2.createdNew).toBe(false);
    expect(r2.version.label).toBe("v2");
    expect(r2.version.editCount).toBe(2);
    const r3 = await applyTextEdit(db, userId, { ...row, currentVersionId: r2.version.id }, r2.version, { body: "filed edit C" }, { type: "review", refId: null, label: "Review" }, { now: new Date(t0.getTime() + 41 * 60_000) });
    expect(r3.createdNew).toBe(true);
    expect(r3.version.label).toBe("v3");
    const lineage = await getLineage(userId, card.number);
    expect(lineage.versions.map((v) => v.label)).toEqual(["v1", "v2", "v3"]);
    expect(lineage.versions[2].parent_label).toBe("v2");
  });

  it("branches: editing v2 from lineage when v3 exists → v3b, child → v4b, second child of v3 → v4c", async () => {
    const { card } = await capture("branches");
    await keepCard(userId, card.number);
    const db = getDb();
    const row = await requireCard(db, userId, card.number);
    const v1 = await requireVersion(db, row.id, "v1");
    const ctx = { type: "lineage" as const, refId: null, label: "Lineage" };
    const v2 = (await applyTextEdit(db, userId, row, v1, { body: "b2" }, ctx, { forceNew: true })).version;
    const v3 = (await applyTextEdit(db, userId, row, v2, { body: "b3" }, ctx, { forceNew: true })).version;
    const v3b = (await applyTextEdit(db, userId, row, v2, { body: "b3b" }, ctx, { forceNew: true })).version;
    expect(v3.label).toBe("v3");
    expect(v3b.label).toBe("v3b");
    const v4b = (await applyTextEdit(db, userId, row, v3b, { body: "b4b" }, ctx, { forceNew: true })).version;
    expect(v4b.label).toBe("v4b");
    const v4 = (await applyTextEdit(db, userId, row, v3, { body: "b4" }, ctx, { forceNew: true })).version;
    expect(v4.label).toBe("v4");
    const v4c = (await applyTextEdit(db, userId, row, v3, { body: "b4c" }, ctx, { forceNew: true })).version;
    expect(v4c.label).toBe("v4c");
  });

  it("restore creates a new version with the old text; sealed versions always branch", async () => {
    const { card } = await capture("restore me");
    await keepCard(userId, card.number);
    const e1 = await editCard(userId, card.number, { rev: card.rev, context: { type: "review", id: null }, body: "changed", save_as_new_version: true });
    expect(e1.version.label).toBe("v2");
    const r = await versionAction(userId, card.number, "restore", "v1");
    expect(r.version.label).toBe("v3");
    expect(r.version.body).toBe("restore me");
    expect(r.version.parent_label).toBe("v2");
    await versionAction(userId, card.number, "seal", "v3");
    const db = getDb();
    const row = await requireCard(db, userId, card.number);
    const v3 = await requireVersion(db, row.id, "v3");
    expect(v3.sealedAt).not.toBeNull();
    const r2 = await applyTextEdit(db, userId, row, v3, { body: "after seal" }, { type: "lineage", refId: null, label: "Lineage" });
    expect(r2.createdNew).toBe(true);
    expect(r2.version.label).toBe("v4");
    const diff = await getDiff(userId, card.number, "v1", "v2");
    expect(diff.ops.some((o) => o.op === "insert")).toBe(true);
  });

  it("rejects stale revs with CONFLICT", async () => {
    const { card } = await capture("conflict");
    await expect(editCard(userId, card.number, { rev: card.rev + 5, context: { type: "inbox", id: null }, body: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("actions, parts, tags", () => {
  it("keep files; kill/restore toggles status and lists", async () => {
    const { card } = await capture("kill me");
    const kept = await keepCard(userId, card.number);
    expect(kept.inbox_state).toBe("filed");
    const killed = await killCard(userId, card.number);
    expect(killed.status).toBe("killed");
    const inboxList = await listCards(userId, { view: "all", sort: "newest", limit: 100 });
    expect(inboxList.items.find((c) => c.number === card.number)).toBeUndefined();
    const killedList = await listCards(userId, { view: "killed", sort: "newest", limit: 100 });
    expect(killedList.items.find((c) => c.number === card.number)).toBeDefined();
    const restored = await restoreCard(userId, card.number);
    expect(restored.status).toBe("raw");
    expect(restored.inbox_state).toBe("filed");
  });

  it("parts never create versions; subjects replace the set", async () => {
    const { card } = await capture("parts");
    const p = await addPart(userId, card.number, { kind: "tag_line", body: "Not ok. He saved a letter." });
    expect(p.created_on_version_label).toBe("v1");
    const after = await getCard(userId, card.number);
    expect(after.version_count).toBe(1);
    expect(after.parts).toHaveLength(1);
    const subs = await setCardSubjects(userId, card.number, ["Dad", "#texting"]);
    expect(subs.map((s) => s.name).sort()).toEqual(["dad", "texting"]);
    const subs2 = await setCardSubjects(userId, card.number, ["dad"]);
    expect(subs2.map((s) => s.name)).toEqual(["dad"]);
  });

  it("delete forever requires killed, cascades versions", async () => {
    const { card } = await capture("delete me");
    await expect(deleteCardForever(userId, card.number)).rejects.toMatchObject({ code: "CARD_NOT_KILLED" });
    await killCard(userId, card.number);
    await deleteCardForever(userId, card.number);
    await expect(getCard(userId, card.number)).rejects.toBeInstanceOf(DomainError);
    const db = getDb();
    const vs = await db.select().from(cardVersions).where(eq(cardVersions.cardId, card.id));
    expect(vs).toHaveLength(0);
  });

  it("detach, split and combine create links visible in lineage without touching sources", async () => {
    const { card } = await capture("Left half. Right half.", { subjects: ["halves"] });
    const copy = await detachCopy(userId, card.number, {});
    expect(copy.number).not.toBe(card.number);
    expect(copy.inbox_state).toBe("filed");
    expect(copy.subjects.map((s) => s.name)).toEqual(["halves"]);
    const [a, b] = await splitCard(userId, card.number, { split_at: 11 });
    expect(a.current_version.body).toBe("Left half.");
    expect(b.current_version.body).toBe("Right half.");
    await expect(splitCard(userId, card.number, { split_at: 0 })).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    const combined = await combineCards(userId, [a.number, b.number]);
    expect(combined.current_version.body).toBe("Left half.\n\nRight half.");
    const original = await getCard(userId, card.number);
    expect(original.current_version.body).toBe("Left half. Right half.");
    expect(original.version_count).toBe(1);
    const lin = await getLineage(userId, card.number);
    expect(lin.links.map((l) => l.relation).sort()).toEqual(["detached_from", "split_from", "split_from"]);
    const linA = await getLineage(userId, a.number);
    expect(linA.links.map((l) => `${l.relation}:${l.direction}`).sort()).toEqual(["combined_from:outgoing", "split_from:incoming"]);
  });

  it("list filters and cursor pagination", async () => {
    const other = await freshUser("other");
    for (let i = 0; i < 5; i++) await captureCard(other, { text: `o${i}`, kind: "note", subjects: i % 2 ? ["odd"] : [], capture_source: "desktop" });
    const p1 = await listCards(other, { view: "inbox", sort: "newest", limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = await listCards(other, { view: "inbox", sort: "newest", limit: 2, cursor: p1.next_cursor! });
    expect(p2.items[0].number).toBeLessThan(p1.items[1].number);
    const untagged = await listCards(other, { view: "all", sort: "newest", limit: 10, untagged: "true" });
    expect(untagged.items).toHaveLength(3);
    const tagged = await listCards(other, { view: "all", sort: "newest", limit: 10, subject: "odd" });
    expect(tagged.items).toHaveLength(2);
    // Cross-user: user A's cards never appear for user B.
    expect((await listCards(other, { view: "all", sort: "newest", limit: 100 })).items.every((c) => c.body.startsWith("o"))).toBe(true);
    await expect(getCard(other, 9999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
