/**
 * Drizzle schema mirroring drizzle/0000_init.sql (HANDOFF.md §6.3).
 * Column names are snake_case in SQL; property names are camelCase here.
 * Generated columns, deferrable constraints and partial indexes are declared in SQL only.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ===== Enums =====
export const cardKind = pgEnum("card_kind", ["note", "joke"]);
export const cardForm = pgEnum("card_form", ["observation", "line", "premise", "story", "act_out", "tag_line"]);
export const formSource = pgEnum("form_source", ["user", "inferred"]);
export const cardStatus = pgEnum("card_status", ["raw", "workshopped", "promoted", "tested", "landed", "killed"]);
export const inboxState = pgEnum("inbox_state", ["inbox", "filed"]);
export const captureSource = pgEnum("capture_source", [
  "phone",
  "desktop",
  "share_sheet",
  "voice_memo",
  "hotkey",
  "import",
]);
export const versionContext = pgEnum("version_context", [
  "capture",
  "inbox",
  "review",
  "board",
  "workshop",
  "bit",
  "set",
  "lineage",
  "import",
]);
export const partKind = pgEnum("part_kind", ["alt_line", "tag_line", "context", "note", "question"]);
export const cardLinkRelation = pgEnum("card_link_relation", [
  "promoted_from",
  "combined_from",
  "split_from",
  "detached_from",
  "callback_to",
]);
export const cardEventType = pgEnum("card_event_type", [
  "captured",
  "edited",
  "version_created",
  "kept",
  "returned_to_inbox",
  "killed",
  "restored",
  "tagged",
  "untagged",
  "form_set",
  "theme_added",
  "theme_removed",
  "part_added",
  "added_to_board",
  "removed_from_board",
  "pin_changed",
  "seeded_in_workshop",
  "promoted",
  "added_to_bit",
  "removed_from_bit",
  "added_to_set",
  "anchored",
  "performed",
  "detached",
  "split",
  "combined",
]);
export const themeSource = pgEnum("theme_source", ["workshop_answer", "cluster", "manual"]);
export const questionCategory = pgEnum("question_category", ["analyze", "audience", "build", "rating"]);
export const laughSize = pgEnum("laugh_size", ["table", "big", "unsure"]);
export const workshopNodeKind = pgEnum("workshop_node_kind", ["root", "answer"]);
export const bitItemKind = pgEnum("bit_item_kind", ["joke", "bridge"]);
export const setStatus = pgEnum("set_status", ["idea", "wip", "workshopping", "ready", "retired"]);
export const revisionKind = pgEnum("revision_kind", ["working", "anchor", "variant"]);
export const variantState = pgEnum("variant_state", ["open", "picked", "unpicked"]);
export const forkMode = pgEnum("fork_mode", ["insert_all_positions", "duplicate"]);
export const transitionKind = pgEnum("transition_kind", ["written", "hard_cut"]);
export const performanceResult = pgEnum("performance_result", ["landed", "flat", "cut"]);
export const attachmentKind = pgEnum("attachment_kind", ["audio"]);
export const transcriptStatus = pgEnum("transcript_status", ["none", "pending", "done", "failed"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);

const now = () => new Date();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(now);

// ===== Identity =====
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  aiAssistEnabled: boolean("ai_assist_enabled").notNull().default(false),
  aiConsentAt: timestamp("ai_consent_at", { withTimezone: true }),
  readingWpm: integer("reading_wpm").notNull().default(150),
  dismissedHints: text("dismissed_hints").array().notNull().default(sql`'{}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cardCounters = pgTable("card_counters", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  nextNumber: integer("next_number").notNull().default(1),
});

// ===== Cards =====
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: cardKind("kind").notNull().default("note"),
    form: cardForm("form"),
    formSource: formSource("form_source"),
    status: cardStatus("status").notNull().default("raw"),
    inboxState: inboxState("inbox_state").notNull().default("inbox"),
    captureSource: captureSource("capture_source").notNull(),
    clientId: uuid("client_id"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    currentVersionId: uuid("current_version_id"),
    laughSize: laughSize("laugh_size"),
    killedAt: timestamp("killed_at", { withTimezone: true }),
    rev: integer("rev").notNull().default(1),
    searchTsv: tsvector("search_tsv"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cards_user_number_uidx").on(t.userId, t.number),
    index("cards_feed_idx").on(t.userId, t.capturedAt, t.id),
  ],
);

export const cardVersions = pgTable(
  "card_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentVersionId: uuid("parent_version_id"),
    depth: integer("depth").notNull(),
    branch: text("branch").notNull().default(""),
    label: text("label").generatedAlwaysAs(sql`'v' || depth::text || branch`),
    title: text("title"),
    body: text("body").notNull().default(""),
    context: text("context"),
    details: text("details"),
    createdContext: versionContext("created_context").notNull(),
    createdContextRefId: uuid("created_context_ref_id"),
    createdContextLabel: text("created_context_label"),
    changeNote: text("change_note"),
    editCount: integer("edit_count").notNull().default(1),
    wordCount: integer("word_count").notNull().default(0),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("card_versions_card_idx").on(t.cardId, t.createdAt)],
);

export const cardParts = pgTable("card_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdOnVersionId: uuid("created_on_version_id").references(() => cardVersions.id, { onDelete: "set null" }),
  kind: partKind("kind").notNull(),
  body: text("body").notNull(),
  position: integer("position").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subjectTags = pgTable("subject_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const cardSubjectTags = pgTable(
  "card_subject_tags",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => subjectTags.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.tagId] })],
);

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").generatedAlwaysAs(sql`lower(btrim(name))`),
  source: themeSource("source").notNull(),
  sourceRefId: uuid("source_ref_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cardThemes = pgTable(
  "card_themes",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceRefId: uuid("source_ref_id"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.themeId] })],
);

// ===== Workshop =====
export const workshopSessions = pgTable("workshop_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  participants: text("participants").array().notNull().default(sql`'{}'`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workshopSessionSeeds = pgTable(
  "workshop_session_seeds",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workshopSessions.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.cardId] })],
);

export const questionTemplates = pgTable("question_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  systemKey: text("system_key"),
  text: text("text").notNull(),
  shortLabel: text("short_label").notNull(),
  category: questionCategory("category").notNull(),
  position: integer("position").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workshopNodes = pgTable("workshop_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  seedCardId: uuid("seed_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  kind: workshopNodeKind("kind").notNull(),
  seedVersionId: uuid("seed_version_id").references(() => cardVersions.id, { onDelete: "set null" }),
  questionId: uuid("question_id"),
  text: text("text"),
  authorLabel: text("author_label"),
  angleLabel: text("angle_label"),
  laughSize: laughSize("laugh_size"),
  isDeadEnd: boolean("is_dead_end").notNull().default(false),
  promotedCardId: uuid("promoted_card_id").references(() => cards.id, { onDelete: "set null" }),
  x: real("x"),
  y: real("y"),
  position: integer("position").notNull().default(0),
  createdInSessionId: uuid("created_in_session_id").references(() => workshopSessions.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workshopQuestions = pgTable("workshop_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  seedCardId: uuid("seed_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id")
    .notNull()
    .references(() => workshopNodes.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => questionTemplates.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  shortLabel: text("short_label").notNull(),
  category: questionCategory("category").notNull(),
  position: integer("position").notNull().default(0),
  createdInSessionId: uuid("created_in_session_id").references(() => workshopSessions.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

// ===== Card links and events =====
export const cardLinks = pgTable("card_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  relation: cardLinkRelation("relation").notNull(),
  sourceCardId: uuid("source_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  sourceVersionId: uuid("source_version_id").references(() => cardVersions.id, { onDelete: "set null" }),
  derivedCardId: uuid("derived_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  derivedVersionId: uuid("derived_version_id").references(() => cardVersions.id, { onDelete: "set null" }),
  viaWorkshopNodeId: uuid("via_workshop_node_id").references(() => workshopNodes.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const cardEvents = pgTable("card_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").references(() => cardVersions.id, { onDelete: "set null" }),
  eventType: cardEventType("event_type").notNull(),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  label: text("label"),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Boards =====
export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const boardClusters = pgTable("board_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  useAsTheme: boolean("use_as_theme").notNull().default(true),
  themeId: uuid("theme_id").references(() => themes.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const boardItems = pgTable("board_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  pinnedVersionId: uuid("pinned_version_id")
    .notNull()
    .references(() => cardVersions.id, { onDelete: "restrict" }),
  x: real("x").notNull(),
  y: real("y").notNull(),
  clusterId: uuid("cluster_id").references(() => boardClusters.id, { onDelete: "set null" }),
  clusterPosition: integer("cluster_position"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ===== Bits and sets =====
export const bits = pgTable("bits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceClusterId: uuid("source_cluster_id").references(() => boardClusters.id, { onDelete: "set null" }),
  durationOverrideSeconds: integer("duration_override_seconds"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const bitItems = pgTable("bit_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bitId: uuid("bit_id")
    .notNull()
    .references(() => bits.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: bitItemKind("kind").notNull(),
  cardId: uuid("card_id").references(() => cards.id, { onDelete: "restrict" }),
  pinnedVersionId: uuid("pinned_version_id").references(() => cardVersions.id, { onDelete: "restrict" }),
  bridgeText: text("bridge_text"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sets = pgTable("sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: setStatus("status").notNull().default("wip"),
  targetDurationSeconds: integer("target_duration_seconds"),
  currentAnchorId: uuid("current_anchor_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const setRevisions = pgTable("set_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  setId: uuid("set_id")
    .notNull()
    .references(() => sets.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: revisionKind("kind").notNull(),
  parentRevisionId: uuid("parent_revision_id"),
  anchorNumber: integer("anchor_number"),
  name: text("name"),
  forkGroupId: uuid("fork_group_id"),
  variantLetter: text("variant_letter"),
  variantDescription: text("variant_description"),
  variantState: variantState("variant_state"),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  rev: integer("rev").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const setForkGroups = pgTable("set_fork_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  setId: uuid("set_id")
    .notNull()
    .references(() => sets.id, { onDelete: "cascade" }),
  baseRevisionId: uuid("base_revision_id")
    .notNull()
    .references(() => setRevisions.id, { onDelete: "cascade" }),
  mode: forkMode("mode").notNull(),
  insertedBitId: uuid("inserted_bit_id").references(() => bits.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export type BitSnapshot = {
  bit_id: string;
  name: string;
  duration_seconds: number;
  items: (
    | {
        kind: "joke";
        card_id: string;
        card_number: number;
        version_id: string;
        version_label: string;
        text: string;
      }
    | { kind: "bridge"; text: string }
  )[];
};

export const setRevisionItems = pgTable("set_revision_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  revisionId: uuid("revision_id")
    .notNull()
    .references(() => setRevisions.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  bitId: uuid("bit_id")
    .notNull()
    .references(() => bits.id, { onDelete: "restrict" }),
  bitSnapshot: jsonb("bit_snapshot").$type<BitSnapshot>(),
});

export const setTransitions = pgTable("set_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  setId: uuid("set_id")
    .notNull()
    .references(() => sets.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fromBitId: uuid("from_bit_id")
    .notNull()
    .references(() => bits.id, { onDelete: "cascade" }),
  toBitId: uuid("to_bit_id")
    .notNull()
    .references(() => bits.id, { onDelete: "cascade" }),
  kind: transitionKind("kind").notNull(),
  text: text("text"),
  callbackToCardId: uuid("callback_to_card_id").references(() => cards.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const setRevisionTransitions = pgTable(
  "set_revision_transitions",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => setRevisions.id, { onDelete: "cascade" }),
    fromBitId: uuid("from_bit_id").notNull(),
    toBitId: uuid("to_bit_id").notNull(),
    kind: transitionKind("kind").notNull(),
    text: text("text"),
    callbackToCardId: uuid("callback_to_card_id"),
  },
  (t) => [primaryKey({ columns: [t.revisionId, t.fromBitId, t.toBitId] })],
);

// ===== Performances =====
export const performances = pgTable("performances", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  setId: uuid("set_id")
    .notNull()
    .references(() => sets.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id")
    .notNull()
    .references(() => setRevisions.id, { onDelete: "restrict" }),
  performedOn: date("performed_on").notNull(),
  venueLabel: text("venue_label"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: attachmentKind("kind").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationMs: integer("duration_ms"),
  ownerType: text("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  transcript: text("transcript"),
  transcriptStatus: transcriptStatus("transcript_status").notNull().default("none"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const performanceMarks = pgTable("performance_marks", {
  id: uuid("id").primaryKey().defaultRandom(),
  performanceId: uuid("performance_id")
    .notNull()
    .references(() => performances.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bitId: uuid("bit_id")
    .notNull()
    .references(() => bits.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  result: performanceResult("result").notNull(),
  note: text("note"),
  voiceAttachmentId: uuid("voice_attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ===== Infrastructure =====
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: jobStatus("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  properties: jsonb("properties").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type Card = typeof cards.$inferSelect;
export type CardVersion = typeof cardVersions.$inferSelect;
export type CardPart = typeof cardParts.$inferSelect;
export type SubjectTag = typeof subjectTags.$inferSelect;
export type Theme = typeof themes.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type BoardCluster = typeof boardClusters.$inferSelect;
export type BoardItem = typeof boardItems.$inferSelect;
export type WorkshopSession = typeof workshopSessions.$inferSelect;
export type WorkshopNode = typeof workshopNodes.$inferSelect;
export type WorkshopQuestion = typeof workshopQuestions.$inferSelect;
export type QuestionTemplate = typeof questionTemplates.$inferSelect;
export type Bit = typeof bits.$inferSelect;
export type BitItem = typeof bitItems.$inferSelect;
export type SetRow = typeof sets.$inferSelect;
export type SetRevision = typeof setRevisions.$inferSelect;
export type SetRevisionItem = typeof setRevisionItems.$inferSelect;
export type SetTransition = typeof setTransitions.$inferSelect;
export type Performance = typeof performances.$inferSelect;
export type PerformanceMark = typeof performanceMarks.$inferSelect;
