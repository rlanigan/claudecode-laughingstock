import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { freshUser } from "../helpers";
import { captureCard, editCard, getCard, killCard, deleteCardForever, setCardSubjects } from "@/server/services/cards";
import { addBitItem, createBit, deleteBit, getBit, reorderBit } from "@/server/services/bits";
import { createAnchor, createFork, createSet, deleteTransition, discardRevision, getFork, getRevision, getSet, pickVariant, putRevisionOrder, putTransition, putWorking, restoreAnchor } from "@/server/services/sets";
import { createPerformance, deleteMark, putMark } from "@/server/services/performances";
import { getLineage } from "@/server/services/lineage";
import { updateSettings } from "@/server/services/users";

let userId: string;
beforeAll(async () => {
  userId = await freshUser("sets");
});
afterAll(async () => {
  await closeDb();
});

async function joke(text: string, subjects: string[] = []) {
  const { card } = await captureCard(userId, { text, kind: "joke", subjects, capture_source: "desktop" });
  return card;
}

describe("bits and sets (Rule 7.9)", () => {
  it("builds a set, writes transitions, anchors, forks every position, compares, picks", async () => {
    const j1 = await joke("I'm not a nervous flyer. I'm a nervous line-stander.", ["airports"]);
    const j2 = await joke("Did you pack your own bag. Like there is a service for that.", ["airports"]);
    const j3 = await joke("Hotel pillows: six of them and none is the one.", ["hotels"]);
    const j4 = await joke("Closer joke about Doug.", ["airports"]);
    const j5 = await joke('He replied "k". He saved a letter.', ["parents"]);
    const opener = await createBit(userId, { name: "Opener: the flight in", card_numbers: [j1.number] });
    const security = await createBit(userId, { name: "Airport security", card_numbers: [j2.number] });
    const pillows = await createBit(userId, { name: "Hotel pillows", card_numbers: [j3.number] });
    const closer = await createBit(userId, { name: "Closer: Doug callback", card_numbers: [j4.number] });
    const dad = await createBit(userId, { name: "Dad's texts", card_numbers: [j5.number] });
    await addBitItem(userId, security.bit.id, { kind: "bridge", bridge_text: "Walk on. Mention the flight in, keep it light." });
    expect((await getBit(userId, security.bit.id)).items.map((i) => i.kind)).toEqual(["joke", "bridge"]);
    await expect(addBitItem(userId, security.bit.id, { kind: "joke", card_number: j2.number })).rejects.toMatchObject({ code: "ALREADY_IN_BIT" });

    const set = await createSet(userId, { name: "Tight 5 · Oct", target_duration_seconds: 300 });
    expect(set.working.items).toHaveLength(0);
    await expect(createAnchor(userId, set.set.id, "Empty")).rejects.toMatchObject({ code: "WORKING_EMPTY" });
    const order = [opener.bit.id, security.bit.id, pillows.bit.id, closer.bit.id];
    const w = await putWorking(userId, set.set.id, { rev: set.working.rev, bit_ids: order });
    expect(w.working.items.map((i) => i.bit_name)).toEqual(["Opener: the flight in", "Airport security", "Hotel pillows", "Closer: Doug callback"]);
    expect(w.working.transitions.map((t) => t.state)).toEqual(["missing", "missing", "missing"]);
    expect(w.working.transitions_to_write).toBe(3);
    expect(w.working.notes.map((n) => n.code)).toContain("P3");
    expect(w.working.notes.find((n) => n.code === "H3")?.text).toBe("Airports bits back to back: yes");
    await expect(putWorking(userId, set.set.id, { rev: 1, bit_ids: order })).rejects.toMatchObject({ code: "CONFLICT" });

    await putTransition(userId, set.set.id, { from_bit_id: opener.bit.id, to_bit_id: security.bit.id, kind: "written", text: "I'm not a nervous flyer. I'm a nervous line-stander." });
    await putTransition(userId, set.set.id, { from_bit_id: pillows.bit.id, to_bit_id: closer.bit.id, kind: "written", text: "Callback: Doug packed this one too.", callback_to_card_number: j2.number });
    await putTransition(userId, set.set.id, { from_bit_id: security.bit.id, to_bit_id: pillows.bit.id, kind: "hard_cut" });
    let s = await getSet(userId, set.set.id);
    expect(s.working.transitions.map((t) => t.state)).toEqual(["written", "hard_cut", "written"]);
    expect(s.working.transitions_to_write).toBe(0);
    expect(s.working.callbacks).toEqual([{ card_number: j2.number, label: "Airport security", valid: true }]);
    expect(s.changed_since_anchor).toBe(true);

    // Anchor v1.
    const { anchor: v1 } = await createAnchor(userId, set.set.id, "First pass");
    expect(v1.anchor_number).toBe(1);
    expect(v1.kind).toBe("anchor");
    s = await getSet(userId, set.set.id);
    expect(s.changed_since_anchor).toBe(false);
    expect(s.set.current_anchor_number).toBe(1);
    expect(s.anchors.map((a) => a.label)).toEqual(["v1"]);
    // Anchors reject order changes and seal their versions.
    await expect(putRevisionOrder(userId, v1.id, { rev: v1.rev, bit_ids: [...order].reverse() })).rejects.toMatchObject({ code: "REVISION_FROZEN" });
    const lin = await getLineage(userId, j2.number);
    expect(lin.versions[0].sealed).toBe(true);
    expect(lin.appears_in.find((a) => a.type === "set")?.detail).toBe("v1 (anchor v1)");

    // Editing a sealed card in its bit creates v2 and the working copy is "changed".
    const c2 = await getCard(userId, j2.number);
    const e = await editCard(userId, j2.number, { rev: c2.rev, context: { type: "bit", id: security.bit.id }, version_label: "v1", body: "Did you pack your own bag? No. I have a guy. Doug." });
    expect(e.created_new_version).toBe(true);
    expect(e.version.label).toBe("v2");
    expect(e.card.placements.bits[0].pinned_version_label).toBe("v2");
    await putWorking(userId, set.set.id, { rev: (await getSet(userId, set.set.id)).working.rev, bit_ids: order });
    s = await getSet(userId, set.set.id);
    expect(s.changed_since_anchor).toBe(true);
    const { anchor: v2 } = await createAnchor(userId, set.set.id, "Tightened opener");
    expect(v2.anchor_number).toBe(2);
    expect(v2.parent_anchor_number).toBe(1);

    // Fork: insert Dad's texts at every position → 5 variants.
    await expect(createFork(userId, set.set.id, { base_revision_id: v2.id, mode: "insert_all_positions", bit_id: opener.bit.id })).rejects.toMatchObject({ code: "BIT_ALREADY_IN_BASE" });
    const fork = await createFork(userId, set.set.id, { base_revision_id: v2.id, mode: "insert_all_positions", bit_id: dad.bit.id });
    expect(fork.variants.map((v) => v.variant_letter)).toEqual(["A", "B", "C", "D", "E"]);
    expect(fork.variants.map((v) => v.ordering_code)).toEqual(["e a b c d", "a e b c d", "a b e c d", "a b c e d", "a b c d e"]);
    expect(fork.variants.map((v) => v.variant_description)).toEqual(["Open with it", "After Opener: the flight in", "After Airport security", "After Hotel pillows", "Put it last"]);
    expect(fork.variants[0].notes.map((n) => n.code)).toContain("H1");
    expect(fork.variants[4].notes.map((n) => n.code)).toContain("H2");
    expect(fork.variants[1].transitions_to_write).toBe(2);
    expect(fork.variants[0].transitions_to_write).toBe(1);
    expect(fork.variants[0].notes.map((n) => n.code)).toContain("P1");
    expect(fork.variants[1].items[1].is_new_in_revision).toBe(true);
    expect(fork.variants[1].differs.sort()).toEqual(["Airport security", "Closer: Doug callback", "Dad's texts", "Hotel pillows"]);

    // Discard one, add a duplicate, pick B.
    await discardRevision(userId, fork.variants[3].id);
    expect((await getFork(userId, set.set.id, fork.fork_group_id)).variants).toHaveLength(4);
    const picked = await pickVariant(userId, fork.variants[1].id, { name: "Oct 2 mic order" });
    expect(picked.anchor.anchor_number).toBe(3);
    expect(picked.anchor.variant_state).toBe("picked");
    expect(picked.anchor.items.map((i) => i.bit_name)[1]).toBe("Dad's texts");
    s = await getSet(userId, set.set.id);
    expect(s.set.current_anchor_number).toBe(3);
    expect(s.working.items.map((i) => i.bit_id)).toEqual([opener.bit.id, dad.bit.id, security.bit.id, pillows.bit.id, closer.bit.id]);
    expect(s.changed_since_anchor).toBe(false);
    expect(s.variants.map((v) => `${v.label}:${v.variant_state}`).sort()).toEqual(["A:unpicked", "C:unpicked", "E:unpicked"]);
    // Transition for (opener, security) is no longer adjacent but still in the library; (security, pillows) still adjacent.
    expect(s.working.transitions.map((t) => t.state)).toEqual(["missing", "missing", "hard_cut", "written"]);

    // Unpicked variants can be picked later → v4; working copy changes require a resolution first.
    await putWorking(userId, set.set.id, { rev: s.working.rev, bit_ids: [opener.bit.id, security.bit.id, pillows.bit.id, closer.bit.id, dad.bit.id] });
    await expect(pickVariant(userId, fork.variants[0].id, { name: "Open with dad" })).rejects.toMatchObject({ code: "WORKING_COPY_CHANGED" });
    const picked2 = await pickVariant(userId, fork.variants[0].id, { name: "Open with dad", working_copy_resolution: "anchor_first", anchor_first_name: "Before dad opens" });
    expect(picked2.anchor.anchor_number).toBe(5);
    s = await getSet(userId, set.set.id);
    expect(s.anchors.map((a) => `${a.label}:${a.name}`)).toEqual(["v1:First pass", "v2:Tightened opener", "v3:Oct 2 mic order", "v4:Before dad opens", "v5:Open with dad"]);

    // Restore v2 as working copy brings its order (and reorder keeps the live transition for adjacent pairs).
    const restored = await restoreAnchor(userId, v2.id, {});
    expect(restored.working.items.map((i) => i.bit_id)).toEqual(order);
    expect(restored.working.transitions.map((t) => t.state)).toEqual(["written", "hard_cut", "written"]);
    await deleteTransition(userId, set.set.id, security.bit.id, pillows.bit.id);
    expect((await getSet(userId, set.set.id)).working.transitions[1].state).toBe("missing");

    // No merge endpoint exists for revisions.
    const setsModule = await import("@/server/services/sets");
    expect(Object.keys(setsModule).filter((k) => /merge/i.test(k))).toEqual([]);

    // Performances: log against v3, mark bits, statuses propagate to jokes.
    const v3id = s.anchors.find((a) => a.label === "v3")!.revision_id;
    await expect(createPerformance(userId, { set_id: set.set.id, revision_id: s.working.id, performed_on: "2026-10-02" })).rejects.toMatchObject({ code: "REVISION_NOT_ANCHOR" });
    const perf = await createPerformance(userId, { set_id: set.set.id, revision_id: v3id, performed_on: "2026-10-02", venue_label: "open mic" });
    expect(perf.anchor_number).toBe(3);
    expect(perf.is_active).toBe(true);
    await expect(putMark(userId, perf.id, "00000000-0000-0000-0000-000000000000", { result: "landed" })).rejects.toMatchObject({ code: "BIT_NOT_IN_REVISION" });
    await putMark(userId, perf.id, security.bit.id, { result: "flat" });
    expect((await getCard(userId, j2.number)).status).toBe("tested");
    const perf2 = await createPerformance(userId, { set_id: set.set.id, revision_id: v3id, performed_on: "2026-10-09", venue_label: "open mic" });
    await putMark(userId, perf2.id, security.bit.id, { result: "landed" });
    expect((await getCard(userId, j2.number)).status).toBe("landed");
    const lin2 = await getLineage(userId, j2.number);
    expect(lin2.performed.map((p) => `${p.performed_on}:${p.version_label}:${p.result}`)).toEqual(["2026-10-09:v2:landed", "2026-10-02:v2:flat"]);
    await deleteMark(userId, perf2.id, security.bit.id);
    expect((await getCard(userId, j2.number)).status).toBe("tested");
    await putMark(userId, perf2.id, dad.bit.id, { result: "cut" });
    const sAfter = await getSet(userId, set.set.id);
    expect(sAfter.active_performance?.id).toBe(perf2.id);
    expect((await getRevision(userId, v3id)).items.find((i) => i.bit_id === dad.bit.id)?.marked_cut_on).toBe("2026-10-09");

    // Deleting a bit in history is blocked; a card in history can't be deleted forever.
    await expect(deleteBit(userId, security.bit.id)).rejects.toMatchObject({ code: "BIT_IN_HISTORY" });
    await killCard(userId, j2.number);
    await expect(deleteCardForever(userId, j2.number)).rejects.toMatchObject({ code: "CARD_IN_HISTORY" });
  });

  it("runtime uses reading speed and overrides; reorder validates membership", async () => {
    const words = Array.from({ length: 150 }, (_, i) => `w${i}`).join(" ");
    const j = await joke(words);
    const bit = await createBit(userId, { name: "Long one", card_numbers: [j.number] });
    expect(bit.duration_seconds).toBe(60);
    await updateSettings(userId, { reading_wpm: 100 });
    expect((await getBit(userId, bit.bit.id)).duration_seconds).toBe(90);
    await updateSettings(userId, { reading_wpm: 150 });
    const bridge = await addBitItem(userId, bit.bit.id, { kind: "bridge", bridge_text: "bridge words here", position: 0 });
    expect(bridge.bit.items.map((i) => i.kind)).toEqual(["bridge", "joke"]);
    const ids = bridge.bit.items.map((i) => i.id).reverse();
    expect((await reorderBit(userId, bit.bit.id, ids)).items.map((i) => i.kind)).toEqual(["joke", "bridge"]);
    await expect(reorderBit(userId, bit.bit.id, ids.slice(1))).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
    await setCardSubjects(userId, j.number, ["long"]);
    const s = await createSet(userId, { name: "Runtime set" });
    const w = await putWorking(userId, s.set.id, { rev: s.working.rev, bit_ids: [bit.bit.id] });
    expect(w.working.runtime_seconds).toBe(60);
    expect(w.working.items[0].primary_subject).toBe("long");
  });
});
