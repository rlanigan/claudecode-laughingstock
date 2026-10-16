// Zod schemas shared by the API routes and the client (HANDOFF.md §10).
import { z } from "zod";

export const uuid = z.string().uuid();
export const cardNumber = z.coerce.number().int().min(1);

export const cardFormEnum = z.enum(["observation", "line", "premise", "story", "act_out", "tag_line"]);
export const laughSizeEnum = z.enum(["table", "big", "unsure"]);
export const partKindEnum = z.enum(["alt_line", "tag_line", "context", "note", "question"]);
export const captureSourceEnum = z.enum(["phone", "desktop", "import"]);
export const contextTypeEnum = z.enum(["inbox", "review", "board", "bit", "set", "lineage"]);

const nullableText = (max: number) => z.string().max(max).nullable().optional();

export const captureSchema = z
  .object({
    client_id: uuid.optional(),
    text: z.string().max(20201).optional(),
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(20000).optional(),
    context: nullableText(5000),
    details: nullableText(5000),
    form: cardFormEnum.nullable().optional(),
    kind: z.enum(["note", "joke"]).default("note"),
    subjects: z.array(z.string().max(60)).max(20).default([]),
    capture_source: captureSourceEnum,
    captured_at: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => (v.text !== undefined) !== (v.body !== undefined || v.title !== undefined), {
    message: "Provide either text or title/body.",
    path: ["text"],
  });
export type CaptureInput = z.infer<typeof captureSchema>;

export const listCardsQuery = z.object({
  view: z.enum(["inbox", "all", "killed"]).default("all"),
  kind: z.enum(["note", "joke"]).optional(),
  form: z.string().optional(),
  status: z.string().optional(),
  subject: z.string().optional(),
  theme: z.string().optional(),
  source: z.enum(["phone", "desktop"]).optional(),
  since: z.string().optional(),
  untagged: z.enum(["true", "false"]).optional(),
  on_board: z.enum(["true", "false"]).optional(),
  sort: z.enum(["newest", "oldest", "recently_edited", "title"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
  q: z.string().max(200).optional(),
});
export type ListCardsQuery = z.infer<typeof listCardsQuery>;

export const editCardSchema = z
  .object({
    rev: z.number().int(),
    context: z.object({ type: contextTypeEnum, id: uuid.nullable().optional() }).default({ type: "review", id: null }),
    version_label: z.string().optional(),
    title: z.string().max(200).nullable().optional(),
    body: z.string().max(20000).optional(),
    text: z.string().max(20201).optional(),
    context_text: nullableText(5000),
    details: nullableText(5000),
    form: cardFormEnum.nullable().optional(),
    laugh_size: laughSizeEnum.nullable().optional(),
    save_as_new_version: z.boolean().optional(),
  })
  .refine((v) => !(v.text !== undefined && (v.title !== undefined || v.body !== undefined)), {
    message: "text is mutually exclusive with title/body",
    path: ["text"],
  });
export type EditCardInput = z.infer<typeof editCardSchema>;

export const versionsActionSchema = z.object({ mode: z.enum(["fork", "restore", "seal"]), from_label: z.string() });
export const pinSchema = z.object({ version_label: z.string(), scope: z.literal("all_boards").default("all_boards") });
export const containerRef = z.object({ type: z.enum(["board", "bit"]), id: uuid });
export const detachSchema = z.object({ version_label: z.string().optional(), container: containerRef.optional() });
export const splitSchema = z.object({ version_label: z.string().optional(), split_at: z.number().int().min(1), container: containerRef.optional() });
export const combineSchema = z.object({ card_numbers: z.array(cardNumber).min(2).max(20), title: z.string().max(200).optional() });

export const partCreateSchema = z.object({ kind: partKindEnum, body: z.string().trim().min(1).max(5000), position: z.number().int().min(0).optional() });
export const partPatchSchema = z.object({ body: z.string().trim().min(1).max(5000).optional(), kind: partKindEnum.optional() });
export const orderSchema = z.object({ ids: z.array(uuid).min(0) });
export const partOrderSchema = z.object({ part_ids: z.array(uuid) });

export const subjectsPutSchema = z.object({ names: z.array(z.string().max(60)).max(20) });
export const subjectsQuery = z.object({ q: z.string().optional(), sort: z.enum(["name", "count"]).default("name"), filter: z.enum(["all", "once", "unused"]).default("all") });
export const suggestQuery = z.object({ text: z.string().max(25000).default(""), card_number: z.string().optional() });
export const renameSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const mergeSchema = z.object({ into_id: uuid });
export const themeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  card_numbers: z.array(cardNumber).optional(),
  source: z.enum(["manual", "workshop_answer"]).default("manual"),
  source_ref_id: uuid.optional(),
});
export const cardThemesPutSchema = z.object({ theme_ids: z.array(uuid) });

// Boards
export const boardCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const boardPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), position: z.number().int().optional(), archived: z.boolean().optional() });
export const boardItemCreateSchema = z.object({ card_number: cardNumber, x: z.number().optional(), y: z.number().optional() });
export const boardItemPatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  cluster_id: uuid.nullable().optional(),
  cluster_position: z.number().int().optional(),
  use_latest: z.literal(true).optional(),
  /** When dropping onto another loose card: create a cluster with it. */
  cluster_with_item_id: uuid.optional(),
});
export const clusterCreateSchema = z.object({ item_ids: z.array(uuid).min(1) });
export const clusterPatchSchema = z.object({ name: z.string().trim().max(80).nullable().optional(), use_as_theme: z.boolean().optional(), order: z.array(uuid).optional() });
export const clusterBitSchema = z.object({ name: z.string().trim().min(1).max(80).optional() });

// Workshop
export const sessionCreateSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), participants: z.array(z.string().trim().min(1).max(60)).max(10).optional() });
export const sessionPatchSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), participants: z.array(z.string().trim().min(1).max(60)).max(10).optional(), notes: z.string().max(10000).optional(), ended: z.literal(true).optional() });
export const seedSchema = z.object({ card_number: cardNumber, session_id: uuid.optional() });
export const askQuestionSchema = z
  .object({
    template_id: uuid.optional(),
    text: z.string().trim().min(1).max(200).optional(),
    short_label: z.string().trim().min(1).max(40).optional(),
    save_to_deck: z.boolean().optional(),
    session_id: uuid.optional(),
  })
  .refine((v) => !!v.template_id || !!v.text, { message: "template_id or text required", path: ["text"] });
export const answerSchema = z.object({ text: z.string().trim().min(1).max(5000), author_label: z.string().trim().max(60).nullable().optional(), session_id: uuid.optional() });
export const nodePatchSchema = z.object({
  text: z.string().trim().min(1).max(5000).optional(),
  author_label: z.string().trim().max(60).nullable().optional(),
  laugh_size: laughSizeEnum.nullable().optional(),
  is_dead_end: z.boolean().optional(),
  angle: z.boolean().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});
export const promoteSchema = z.object({ session_id: uuid.optional() });
export const nodeThemeSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const templateCreateSchema = z.object({ text: z.string().trim().min(1).max(200), short_label: z.string().trim().min(1).max(40), category: z.enum(["analyze", "audience", "build"]) });
export const templatePatchSchema = z.object({ text: z.string().trim().min(1).max(200).optional(), short_label: z.string().trim().min(1).max(40).optional(), category: z.enum(["analyze", "audience", "build"]).optional(), archived: z.boolean().optional() });

// Bits
export const bitCreateSchema = z.object({ name: z.string().trim().min(1).max(80), card_numbers: z.array(cardNumber).optional() });
export const bitPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), duration_override_seconds: z.number().int().min(1).max(3600).nullable().optional(), archived: z.boolean().optional() });
export const bitItemCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("joke"), card_number: cardNumber, position: z.number().int().min(0).optional() }),
  z.object({ kind: z.literal("bridge"), bridge_text: z.string().trim().min(1).max(2000), position: z.number().int().min(0).optional() }),
]);
export const bitItemPatchSchema = z.object({ bridge_text: z.string().trim().min(1).max(2000).optional(), use_latest: z.literal(true).optional() });
export const bitOrderSchema = z.object({ item_ids: z.array(uuid) });

// Sets
export const setStatusEnum = z.enum(["idea", "wip", "workshopping", "ready", "retired"]);
export const setCreateSchema = z.object({ name: z.string().trim().min(1).max(80), target_duration_seconds: z.number().int().min(30).max(14400).nullable().optional(), status: setStatusEnum.optional() });
export const setPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), status: setStatusEnum.optional(), target_duration_seconds: z.number().int().min(30).max(14400).nullable().optional(), archived: z.boolean().optional() });
export const workingPutSchema = z.object({ rev: z.number().int(), bit_ids: z.array(uuid) });
export const transitionPutSchema = z.object({
  from_bit_id: uuid,
  to_bit_id: uuid,
  kind: z.enum(["written", "hard_cut"]),
  text: z.string().max(1000).optional(),
  callback_to_card_number: cardNumber.nullable().optional(),
});
export const transitionDeleteQuery = z.object({ from_bit_id: uuid, to_bit_id: uuid });
export const anchorSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const forkSchema = z.object({ base_revision_id: uuid, mode: z.enum(["insert_all_positions", "duplicate"]), bit_id: uuid.optional() });
export const revisionOrderSchema = z.object({ rev: z.number().int(), bit_ids: z.array(uuid) });
export const resolutionEnum = z.enum(["anchor_first", "discard"]);
export const pickSchema = z.object({ name: z.string().trim().min(1).max(80), working_copy_resolution: resolutionEnum.optional(), anchor_first_name: z.string().trim().min(1).max(80).optional() });
export const restoreRevisionSchema = z.object({ working_copy_resolution: resolutionEnum.optional(), anchor_first_name: z.string().trim().min(1).max(80).optional() });
export const revisionQuery = z.object({ include: z.string().optional() });

// Performances
export const performanceCreateSchema = z
  .object({
    set_id: uuid,
    revision_id: uuid.optional(),
    anchor_working_copy_as: z.string().trim().min(1).max(80).optional(),
    performed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    venue_label: z.string().trim().max(80).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((v) => !!v.revision_id !== !!v.anchor_working_copy_as, { message: "Provide revision_id or anchor_working_copy_as", path: ["revision_id"] });
export const performancePatchSchema = z.object({ performed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), venue_label: z.string().trim().max(80).nullable().optional(), notes: z.string().max(5000).optional() });
export const markSchema = z.object({ result: z.enum(["landed", "flat", "cut"]), note: z.string().max(2000).optional() });
export const performancesQuery = z.object({ set_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().optional() });

// Search
export const searchQuery = z.object({
  q: z.string().max(200).default(""),
  type: z.enum(["all", "cards", "bits", "sets", "boards", "subjects", "themes"]).default("all"),
  include_versions: z.enum(["true", "false"]).default("false"),
  include_killed: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

// Account
export const meSettingsSchema = z.object({ ai_assist_enabled: z.boolean().optional(), reading_wpm: z.number().int().min(90).max(220).optional(), dismissed_hints: z.array(z.string().max(60)).max(50).optional() });
export const meNameSchema = z.object({ name: z.string().max(80).nullable() });
export const deleteMeSchema = z.object({ confirm: z.literal("DELETE") });
export const paginationQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() });
export const archivedQuery = z.object({ archived: z.enum(["true", "false"]).default("false"), not_in_set: uuid.optional() });

// AI
export const aiSuggestSchema = z.object({ text: z.string().max(5000), context: z.string().max(1000).optional() });
export const aiInferFormSchema = z.object({ card_number: cardNumber });
export const aiThemePhraseSchema = z.object({ text: z.string().max(2000) });
