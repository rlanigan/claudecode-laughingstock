import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { workshopSessions } from "@/db/schema";
import { freshUser } from "../helpers";
import { captureCard, getCard } from "@/server/services/cards";
import { addAnswer, askQuestion, deleteNode, getBranch, getMap, getSession, listTemplates, patchNode, promoteNode, saveNodeTheme, seedCard } from "@/server/services/workshop";
import { getLineage } from "@/server/services/lineage";

let userId: string;
beforeAll(async () => {
  userId = await freshUser("ws");
});
afterAll(async () => {
  await closeDb();
});

describe("workshop (Rule 7.8)", () => {
  it("seeds join the active session; a second seed within 6h joins the same one", async () => {
    const a = await captureCard(userId, { text: "Dad's texts\nHe replied k.", kind: "note", subjects: ["parents"], capture_source: "phone" });
    const b = await captureCard(userId, { text: "Airport pretzel", kind: "note", subjects: [], capture_source: "phone" });
    const s1 = await seedCard(userId, { card_number: a.card.number });
    expect(s1.created_session).toBe(true);
    const s2 = await seedCard(userId, { card_number: b.card.number });
    expect(s2.created_session).toBe(false);
    expect(s2.session_id).toBe(s1.session_id);
    const session = await getSession(userId, s1.session_id);
    expect(session.seeds.map((s) => s.card.number)).toEqual([a.card.number, b.card.number]);
    expect((await getCard(userId, a.card.number)).inbox_state).toBe("filed");
    // Age the session beyond 6 hours → next seed creates a new session.
    await getDb().update(workshopSessions).set({ startedAt: new Date(Date.now() - 7 * 3600_000) }).where(eq(workshopSessions.id, s1.session_id));
    const s3 = await seedCard(userId, { card_number: b.card.number });
    expect(s3.created_session).toBe(true);
  });

  it("questions, answers, angles, rating, promotion, themes, branch path", async () => {
    const seed = await captureCard(userId, { text: "Dad's texts 2\nSent him three paragraphs. He replied k.", kind: "note", subjects: ["parents"], capture_source: "phone" });
    const { root_node_id, session_id } = await seedCard(userId, { card_number: seed.card.number });
    const templates = (await listTemplates(userId)).items;
    const byKey = Object.fromEntries(templates.map((t) => [t.system_key, t]));
    expect(templates.map((t) => t.category)).toEqual(["analyze", "analyze", "audience", "audience", "build", "build", "rating"]);

    // Rating template never creates a question.
    const rating = await askQuestion(userId, root_node_id, { template_id: byKey.laugh_size.id });
    expect(rating.rating).toBe(true);

    const q1 = await askQuestion(userId, root_node_id, { template_id: byKey.relating.id, session_id });
    expect(q1.question!.short_label).toBe("How are we relating?");
    const a1 = await addAnswer(userId, q1.question!.id, { text: "Everyone has a parent who texts like it costs money.", author_label: "Sam", session_id });
    const a1b = await addAnswer(userId, q1.question!.id, { text: "Second answer", session_id });
    expect(a1b.position).toBe(1);
    expect((await getCard(userId, seed.card.number)).status).toBe("workshopped");

    // Angles: A, B, then remove A and the next gets A again.
    const angled = await patchNode(userId, a1.id, { angle: true });
    expect(angled.angle_label).toBe("A");
    const angledB = await patchNode(userId, a1b.id, { angle: true });
    expect(angledB.angle_label).toBe("B");
    await patchNode(userId, a1.id, { angle: false });
    expect((await patchNode(userId, a1.id, { angle: true })).angle_label).toBe("A");

    const q2 = await askQuestion(userId, a1.id, { template_id: byKey.enter.id, session_id });
    const a2 = await addAnswer(userId, q2.question!.id, { text: "Read the three paragraphs out loud. Slowly.", session_id });
    const q3 = await askQuestion(userId, a2.id, { template_id: byKey.punchline.id, session_id });
    const a3 = await addAnswer(userId, q3.question!.id, { text: 'He replied "k". Not "ok". He saved a letter.', session_id });
    await patchNode(userId, a3.id, { laugh_size: "table" });

    // Custom one-off question works without saving to the deck.
    const custom = await askQuestion(userId, a1b.id, { text: "What would Sam say?", save_to_deck: false });
    expect(custom.question!.template_id).toBeNull();
    expect((await listTemplates(userId)).items).toHaveLength(7);

    // Promote once; second time → ALREADY_PROMOTED.
    const joke = await promoteNode(userId, a3.id, session_id);
    expect(joke.kind).toBe("joke");
    expect(joke.form).toBe("line");
    expect(joke.status).toBe("promoted");
    expect(joke.inbox_state).toBe("filed");
    expect(joke.laugh_size).toBe("table");
    expect(joke.subjects.map((s) => s.name)).toEqual(["parents"]);
    await expect(promoteNode(userId, a3.id)).rejects.toMatchObject({ code: "ALREADY_PROMOTED" });
    const lineage = await getLineage(userId, joke.number);
    expect(lineage.workshop_path?.map((s) => s.type)).toEqual(["seed", "question", "answer", "question", "answer", "question", "answer"]);
    expect(lineage.links[0]).toMatchObject({ relation: "promoted_from", direction: "incoming" });

    // Themes only from point/analyze answers.
    await expect(saveNodeTheme(userId, a1.id, "x")).rejects.toMatchObject({ code: "NOT_A_POINT_ANSWER" });
    const qp = await askQuestion(userId, root_node_id, { template_id: byKey.point.id });
    const ap = await addAnswer(userId, qp.question!.id, { text: "Effort isn't love to him. Showing up is." });
    const theme = await saveNodeTheme(userId, ap.id, "Effort isn't love, showing up is");
    expect(theme.created).toBe(true);
    expect((await getCard(userId, seed.card.number)).themes.map((t) => t.name)).toEqual(["Effort isn't love, showing up is"]);

    // Branch path for angle A follows the latest subtree.
    const branch = await getBranch(userId, seed.card.number, "A");
    const texts = branch.path.map((s) => ("node" in s ? (s.node.text ?? "root") : `Q:${s.question.short_label}`));
    expect(texts).toEqual(["root", "Q:How are we relating?", "Everyone has a parent who texts like it costs money.", "Q:How do we enter?", "Read the three paragraphs out loud. Slowly.", "Q:Punchline?", 'He replied "k". Not "ok". He saved a letter.']);
    expect(branch.angle_count).toBe(2);

    // Dead end is skipped when a live sibling exists.
    const a2b = await addAnswer(userId, q2.question!.id, { text: "Dead idea" });
    await patchNode(userId, a2b.id, { is_dead_end: true });
    const branch2 = await getBranch(userId, seed.card.number, "A");
    expect(branch2.path.some((s) => "node" in s && s.node.text === "Dead idea")).toBe(false);

    // Deleting an answer with a promoted descendant keeps the joke and nulls the link node.
    const map = await getMap(userId, seed.card.number);
    expect(map.stats.promoted_count).toBe(1);
    await deleteNode(userId, a1.id);
    const jokeAfter = await getCard(userId, joke.number);
    expect(jokeAfter.kind).toBe("joke");
    const lin2 = await getLineage(userId, joke.number);
    expect(lin2.links).toHaveLength(1);
    expect(lin2.workshop_path).toBeNull();
    expect((await getMap(userId, seed.card.number)).stats.promoted_count).toBe(0);
  });
});
