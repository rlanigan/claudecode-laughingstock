/**
 * Demo seed (HANDOFF.md §16.4). Development and preview only.
 * Usage: tsx scripts/seed.ts   (SEED_USER_EMAIL, default demo@example.com)
 */
import { eq } from "drizzle-orm";
import { loadEnv } from "./load-env";

loadEnv();
if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: "development" });

async function main() {
  const { getDb, closeDb } = await import("@/server/db");
  const { users } = await import("@/db/schema");
  const { ensureUserBootstrap } = await import("@/server/services/users");
  const { captureCard, editCard, addPart, keepCard, setCardSubjects } = await import("@/server/services/cards");
  const { createBoard, addItem, patchItem, patchCluster, getBoard } = await import("@/server/services/boards");
  const { createSession, seedCard, askQuestion, addAnswer, patchNode, promoteNode, saveNodeTheme, listTemplates } = await import("@/server/services/workshop");
  const { createBit, addBitItem } = await import("@/server/services/bits");
  const { createSet, putWorking, putTransition, createAnchor, createFork, pickVariant, getSet } = await import("@/server/services/sets");
  const { createPerformance, putMark } = await import("@/server/services/performances");
  const { requireCard, requireVersion } = await import("@/server/repos/cards");
  const { applyTextEdit } = await import("@/server/services/versions");

  const db = getDb();
  const email = (process.env.SEED_USER_EMAIL ?? "demo@example.com").toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    console.log(`Seed user ${email} already exists — nothing to do. Run reset-db first to reseed.`);
    await closeDb();
    return;
  }
  const [user] = await db.insert(users).values({ email, name: "Demo", emailVerified: new Date() }).returning();
  const u = user.id;
  await ensureUserBootstrap(db, u);
  const note = async (text: string, subjects: string[] = [], extra: Record<string, unknown> = {}) =>
    (await captureCard(u, { text, kind: "note", subjects, capture_source: "phone", ...extra } as Parameters<typeof captureCard>[1])).card;

  // ---- notes ----
  const premise = await note("Premise: airports are the only place adults line up on purpose", ["airports"], { form: "premise" });
  const tsa = await note("TSA agent asked if I packed my own bag, like there is a service for that", ["airports"]);
  const shoes = await note("Taking your shoes off for a stranger in a room with 400 people", ["airports"], { form: "act_out" });
  const bin = await note("The bin is wet. Why is the bin wet.", ["airports"], { form: "tag_line" });
  const gym = await note("Everyone at the airport is dressed for either the gym or a wedding. Nothing in between.", ["airports"]);
  const seatbelt = await note("The guy who stands up the second the seatbelt sign goes off.", ["airports"]);
  const pillows = await note("Hotel pillows: there are always six and none of them is the one.", ["hotels"]);
  const boarding = await note("Boarding groups are a caste system with a loyalty card.", ["airports"]);
  const pretzel = await note("Nobody has ever finished an airport pretzel.", ["airports", "food"]);
  const dadChar = await note("My dad texts like he is paying per character", ["parents"], { form: "line" });
  const mealPrep = await note("Meal prep is cooking for someone you resent, and that someone is you on Thursday", ["food"], { form: "line" });
  await note("Rental car agent upsell as hostage negotiation.", ["travel"]);
  await note("Guy on the train narrating his own podcast", ["people"]);
  const dad = await note("Dad's texts\nSent him three paragraphs about the surgery. He replied \"k\".", ["parents"], { form: "observation", context: "Hospital waiting room, Tuesday. He was sitting right next to me when he sent it." });
  await addPart(u, dad.number, { kind: "alt_line", body: 'He replied "k" like I had asked if he wanted fries.' });
  await addPart(u, dad.number, { kind: "tag_line", body: 'Not "ok". He saved a letter.' });
  await addPart(u, dad.number, { kind: "note", body: "Feels like a family bit, not a one-liner. Try it as a story." });

  // ---- versions on #tsa and #shoes (inbox v1 → board v2 → bit v3 / v3b) ----
  await keepCard(u, tsa.number);
  await keepCard(u, shoes.number);

  // ---- boards ----
  const travel = await createBoard(u, "Travel");
  await createBoard(u, "Dating");
  await createBoard(u, "Family");
  const items = {} as Record<string, string>;
  for (const c of [tsa, premise, shoes, bin, gym, seatbelt, pillows, boarding, pretzel]) items[c.id] = (await addItem(u, travel.id, { card_number: c.number })).id;
  const sec = await patchItem(u, items[premise.id], { cluster_with_item_id: items[tsa.id] });
  const secId = sec.created_cluster_id!;
  await patchItem(u, items[shoes.id], { cluster_id: secId });
  await patchItem(u, items[bin.id], { cluster_id: secId });
  await patchCluster(u, secId, { name: "Airport security" });
  const ppl = await patchItem(u, items[seatbelt.id], { cluster_with_item_id: items[gym.id] });
  await patchCluster(u, ppl.created_cluster_id!, { name: "Airport people" });
  const board = await getBoard(u, travel.id);
  const pillowItem = board.items.find((i) => i.card.number === pillows.number)!;
  await patchItem(u, pillowItem.id, { cluster_with_item_id: items[boarding.id] }).then(async (r) => {
    // leave boarding loose again, pillows alone in an Unnamed cluster
    await patchItem(u, items[boarding.id], { cluster_id: null });
    void r;
  });
  // Board edits create v2 on tsa.
  {
    const row = await requireCard(db, u, tsa.number);
    const v1 = await requireVersion(db, row.id, "v1");
    const item = board.items.find((i) => i.card.number === tsa.number)!;
    await applyTextEdit(db, u, row, v1, { body: 'So TSA asks me, did you pack your own bag? Like there is a service.' }, { type: "board", refId: travel.id, label: "Board Travel", container: { kind: "board_item", id: item.id } }, { now: new Date(Date.now() - 20 * 86400_000) });
  }

  // ---- workshop ----
  const session = await createSession(u, { title: "With Sam", participants: ["Sam"] });
  const { root_node_id } = await seedCard(u, { card_number: dad.number, session_id: session.id });
  const t = Object.fromEntries((await listTemplates(u)).items.map((x) => [x.system_key!, x.id]));
  const qWhy = (await askQuestion(u, root_node_id, { template_id: t.why_funny, session_id: session.id })).question!;
  const aWhy = await addAnswer(u, qWhy.id, { text: "A man with infinite words in person becomes a telegram over text.", author_label: "Sam", session_id: session.id });
  await patchNode(u, aWhy.id, { is_dead_end: true });
  const qRel = (await askQuestion(u, root_node_id, { template_id: t.relating, session_id: session.id })).question!;
  const aRel = await addAnswer(u, qRel.id, { text: "Everyone has a parent who texts like it costs money.", author_label: "Sam", session_id: session.id });
  await patchNode(u, aRel.id, { angle: true });
  const qEnter = (await askQuestion(u, aRel.id, { template_id: t.enter, session_id: session.id })).question!;
  const aEnter = await addAnswer(u, qEnter.id, { text: "Read the three paragraphs out loud. Slowly. Make them wait for it.", session_id: session.id });
  const qPunch = (await askQuestion(u, aEnter.id, { template_id: t.punchline, session_id: session.id })).question!;
  const aPunch = await addAnswer(u, qPunch.id, { text: 'He replied "k". Not "ok". He saved a letter.', session_id: session.id });
  await patchNode(u, aPunch.id, { laugh_size: "table" });
  const joke = await promoteNode(u, aPunch.id, session.id);
  const qPoint = (await askQuestion(u, root_node_id, { template_id: t.point, session_id: session.id })).question!;
  const aPoint = await addAnswer(u, qPoint.id, { text: "Effort isn't love to him. Showing up is. He was sitting right there.", session_id: session.id });
  await patchNode(u, aPoint.id, { angle: true });
  await saveNodeTheme(u, aPoint.id, "Effort isn't love to him, showing up is");
  const qPunch2 = (await askQuestion(u, aPoint.id, { template_id: t.punchline, session_id: session.id })).question!;
  const aPunch2 = await addAnswer(u, qPunch2.id, { text: 'He drove four hours to say "k" in person.', session_id: session.id });
  await patchNode(u, aPunch2.id, { laugh_size: "big" });

  // ---- bits ----
  const opener = await createBit(u, { name: "Opener: the flight in", card_numbers: [boarding.number] });
  const security = await createBit(u, { name: "Airport security", card_numbers: [premise.number, tsa.number, shoes.number] });
  await addBitItem(u, security.bit.id, { kind: "bridge", bridge_text: "Walk on. Mention the flight in, keep it light, get to the line fast.", position: 1 });
  const pillowsBit = await createBit(u, { name: "Hotel pillows", card_numbers: [pillows.number] });
  const dadBit = await createBit(u, { name: "Dad's texts", card_numbers: [joke.number, dad.number] });
  const closer = await createBit(u, { name: "Closer: Doug callback", card_numbers: [bin.number] });
  await createBit(u, { name: "Boarding groups", card_numbers: [gym.number] });
  await createBit(u, { name: "Meal prep", card_numbers: [mealPrep.number] });
  // Bit edit: tsa v3 (main line) and v3b (branch from v2).
  {
    const row = await requireCard(db, u, tsa.number);
    const v2 = await requireVersion(db, row.id, "v2");
    const bitItem = (await (await import("@/server/services/bits")).getBit(u, security.bit.id)).items.find((i) => i.card?.number === tsa.number)!;
    await applyTextEdit(db, u, row, v2, { body: "So TSA asks me, did you pack your own bag? Like there is a service. Like somewhere there is a guy named Doug who packs bags for a living and I skipped him to save forty dollars." }, { type: "bit", refId: security.bit.id, label: "Bit Airport security", container: { kind: "bit_item", id: bitItem.id } }, { now: new Date(Date.now() - 8 * 86400_000) });
    await applyTextEdit(db, u, row, v2, { body: "Did you pack your own bag. No, I outsourced it. I have a guy." }, { type: "lineage", refId: null, label: "Lineage" }, { forceNew: true, now: new Date(Date.now() - 5 * 86400_000) });
    await editCard(u, dadChar.number, { rev: (await requireCard(db, u, dadChar.number)).rev, context: { type: "inbox", id: null }, form: "line" });
  }

  // ---- set ----
  const set = await createSet(u, { name: "Tight 5 · Oct", target_duration_seconds: 300, status: "workshopping" });
  const order = [opener.bit.id, security.bit.id, pillowsBit.bit.id, closer.bit.id];
  let s = await putWorking(u, set.set.id, { rev: set.working.rev, bit_ids: order });
  await putTransition(u, set.set.id, { from_bit_id: opener.bit.id, to_bit_id: security.bit.id, kind: "written", text: "I'm not a nervous flyer. I'm a nervous line-stander." });
  await putTransition(u, set.set.id, { from_bit_id: pillowsBit.bit.id, to_bit_id: closer.bit.id, kind: "written", text: "Callback: Doug packed this one too.", callback_to_card_number: tsa.number });
  const v1 = (await createAnchor(u, set.set.id, "First pass")).anchor;
  s = await putWorking(u, set.set.id, { rev: (await getSet(u, set.set.id)).working.rev, bit_ids: order });
  await putTransition(u, set.set.id, { from_bit_id: security.bit.id, to_bit_id: pillowsBit.bit.id, kind: "hard_cut" });
  const v2 = (await createAnchor(u, set.set.id, "Tightened opener")).anchor;
  const fork = await createFork(u, set.set.id, { base_revision_id: v2.id, mode: "insert_all_positions", bit_id: dadBit.bit.id });
  await putTransition(u, set.set.id, { from_bit_id: dadBit.bit.id, to_bit_id: security.bit.id, kind: "written", text: 'He texted me "k" from the gate. Which brings me to airport security.' });
  await pickVariant(u, fork.variants[1].id, { name: "Oct 2 mic order" });
  void s;
  void v1;

  // ---- performances ----
  const p1 = await createPerformance(u, { set_id: set.set.id, revision_id: v2.id, performed_on: "2026-09-13", venue_label: "open mic" });
  await putMark(u, p1.id, security.bit.id, { result: "flat" });
  const p2 = await createPerformance(u, { set_id: set.set.id, revision_id: v2.id, performed_on: "2026-09-20", venue_label: "open mic" });
  await putMark(u, p2.id, security.bit.id, { result: "landed" });
  const current = await getSet(u, set.set.id);
  await createPerformance(u, { set_id: set.set.id, revision_id: current.set.current_anchor_id!, performed_on: "2026-10-02", venue_label: "open mic" });

  // ---- other sets ----
  const podcast = await createSet(u, { name: "Podcast riff", status: "wip" });
  const riffBit = await createBit(u, { name: "Outsourced bag", card_numbers: [tsa.number] });
  await putWorking(u, podcast.set.id, { rev: podcast.working.rev, bit_ids: [riffBit.bit.id] });
  await createSet(u, { name: "Hour · 2027", status: "idea" });
  await setCardSubjects(u, pretzel.number, ["airports", "food"]);

  console.log(`Seeded ${email}. Sign in with that address; the magic link prints in the server console.`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
