import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { freshUser } from "../helpers";
import { captureCard, getCard, editCard, pinVersion } from "@/server/services/cards";
import { addItem, bitFromCluster, createBoard, createCluster, deleteCluster, getBoard, patchCluster, patchItem, removeItem, tidyBoard } from "@/server/services/boards";
import { listThemes, mergeSubjects, listSubjects, renameSubject } from "@/server/services/tags";
import { getLineage } from "@/server/services/lineage";

let userId: string;
beforeAll(async () => {
  userId = await freshUser("boards");
});
afterAll(async () => {
  await closeDb();
});

describe("boards and clusters (F-11, Rule 7.7, Rule 7.14)", () => {
  it("places cards, clusters by dropping, names clusters as themes, starts a bit", async () => {
    const board = await createBoard(userId, "Travel");
    await expect(createBoard(userId, " travel ")).rejects.toMatchObject({ code: "NAME_TAKEN" });
    const a = (await captureCard(userId, { text: "TSA asked if I packed my own bag", kind: "note", subjects: ["airports"], capture_source: "phone" })).card;
    const b = (await captureCard(userId, { text: "The bin is wet", kind: "note", subjects: ["airports", "bins"], capture_source: "phone" })).card;
    const c = (await captureCard(userId, { text: "Hotel pillows", kind: "note", subjects: ["hotels"], capture_source: "phone" })).card;

    const ia = await addItem(userId, board.id, { card_number: a.number });
    expect(ia).toMatchObject({ x: 24, y: 24, pinned_version_label: "v1" });
    expect((await getCard(userId, a.number)).inbox_state).toBe("filed");
    const ib = await addItem(userId, board.id, { card_number: b.number });
    expect(ib).toMatchObject({ x: 234, y: 24 });
    await expect(addItem(userId, board.id, { card_number: a.number })).rejects.toMatchObject({ code: "ALREADY_ON_BOARD" });
    const ic = await addItem(userId, board.id, { card_number: c.number, x: 900, y: 600 });

    // Drop b on a → unnamed cluster with both.
    const dropped = await patchItem(userId, ib.id, { cluster_with_item_id: ia.id });
    expect(dropped.created_cluster_id).not.toBeNull();
    let bd = await getBoard(userId, board.id);
    expect(bd.clusters).toHaveLength(1);
    expect(bd.clusters[0].name).toBeNull();
    expect(bd.clusters[0].member_count).toBe(2);
    expect(bd.clusters[0].aggregated_subjects[0]).toEqual({ name: "airports", count: 2 });
    expect(bd.items.find((i) => i.id === ib.id)!.x).toBe(ia.x + 190 + 16);

    // Naming it creates a theme (use_as_theme default on) and attaches it to members.
    const cluster = await patchCluster(userId, bd.clusters[0].id, { name: "Airport security" });
    expect(cluster.theme_id).not.toBeNull();
    expect((await getCard(userId, a.number)).themes.map((t) => t.name)).toEqual(["Airport security"]);
    // Member joins → inherits; leaves → loses only the cluster-sourced link.
    await patchItem(userId, ic.id, { cluster_id: cluster.id });
    expect((await getCard(userId, c.number)).themes.map((t) => t.name)).toEqual(["Airport security"]);
    await patchItem(userId, ic.id, { cluster_id: null });
    expect((await getCard(userId, c.number)).themes).toEqual([]);
    // Rename re-points to a new theme; old links gone.
    await patchCluster(userId, cluster.id, { name: "Security theatre" });
    expect((await getCard(userId, a.number)).themes.map((t) => t.name)).toEqual(["Security theatre"]);
    // Toggle off removes links but keeps the theme.
    await patchCluster(userId, cluster.id, { use_as_theme: false });
    expect((await getCard(userId, a.number)).themes).toEqual([]);
    expect((await listThemes(userId)).items.map((t) => t.name).sort()).toEqual(["Airport security", "Security theatre"]);
    await patchCluster(userId, cluster.id, { use_as_theme: true });

    // Suggested order and bit from cluster.
    bd = await getBoard(userId, board.id);
    const members = bd.items.filter((i) => i.cluster_id === cluster.id).sort((x, y) => (x.cluster_position ?? 0) - (y.cluster_position ?? 0));
    await patchCluster(userId, cluster.id, { order: [members[1].id, members[0].id] });
    const bit = await bitFromCluster(userId, cluster.id);
    expect(bit.bit.name).toBe("Security theatre");
    expect(bit.items.map((i) => i.card!.number)).toEqual([members[1].card.number, members[0].card.number]);
    expect(bit.unplaced_from_cluster).toEqual([]);
    expect(bd.clusters[0].used_in).toEqual([]);
    expect((await getBoard(userId, board.id)).clusters[0].used_in[0]).toMatchObject({ type: "bit", count: 2 });

    // Editing in the bit leaves the board pin; push to board updates it.
    const card = await getCard(userId, a.number);
    const edited = await editCard(userId, a.number, { rev: card.rev, context: { type: "bit", id: bit.bit.id }, version_label: "v1", body: "TSA asked if I packed my own bag, like there is a service for that" });
    expect(edited.version.label).toBe("v2");
    expect(edited.card.placements.boards[0].pinned_version_label).toBe("v1");
    expect(edited.card.placements.bits[0].pinned_version_label).toBe("v2");
    expect((await pinVersion(userId, a.number, "v2")).updated_board_items).toBe(1);
    expect((await getCard(userId, a.number)).placements.boards[0].pinned_version_label).toBe("v2");
    expect((await getLineage(userId, a.number)).appears_in.map((x) => `${x.type}:${x.version_label}`).sort()).toEqual(["bit:v2", "board:v2"]);

    // Removing the last member deletes the cluster; ungroup keeps cards.
    const [m1, m2] = members;
    await removeItem(userId, m1.id);
    expect((await getBoard(userId, board.id)).clusters[0].member_count).toBe(1);
    const extra = await createCluster(userId, board.id, [ic.id]);
    expect(extra.member_count).toBe(1);
    await deleteCluster(userId, extra.id);
    const after = await getBoard(userId, board.id);
    expect(after.items.find((i) => i.id === ic.id)!.cluster_id).toBeNull();
    await removeItem(userId, m2.id);
    expect((await getBoard(userId, board.id)).clusters).toHaveLength(0);

    const tidy = await tidyBoard(userId, board.id);
    expect(tidy.items).toHaveLength(1);
  });

  it("tag hygiene: rename, merge", async () => {
    const x = (await captureCard(userId, { text: "dad one", kind: "note", subjects: ["dads"], capture_source: "phone" })).card;
    await captureCard(userId, { text: "dad two", kind: "note", subjects: ["dad"], capture_source: "phone" });
    const list = (await listSubjects(userId, { sort: "count", filter: "all" })).items;
    const dads = list.find((t) => t.name === "dads")!;
    const dad = list.find((t) => t.name === "dad")!;
    await expect(renameSubject(userId, dads.id, "dad")).rejects.toMatchObject({ code: "NAME_TAKEN" });
    const merged = await mergeSubjects(userId, dads.id, dad.id);
    expect(merged.into.count).toBe(2);
    expect((await getCard(userId, x.number)).subjects.map((s) => s.name)).toEqual(["dad"]);
    expect((await listSubjects(userId, { sort: "name", filter: "all" })).items.find((t) => t.name === "dads")).toBeUndefined();
  });
});
