// DTO shapes shared by the API and the UI (HANDOFF.md §38.3).
export type CardKind = "note" | "joke";
export type CardForm = "observation" | "line" | "premise" | "story" | "act_out" | "tag_line";
export type CardStatus = "raw" | "workshopped" | "promoted" | "tested" | "landed" | "killed";
export type InboxState = "inbox" | "filed";
export type CaptureSource = "phone" | "desktop" | "share_sheet" | "voice_memo" | "hotkey" | "import";
export type VersionContext =
  | "capture"
  | "inbox"
  | "review"
  | "board"
  | "workshop"
  | "bit"
  | "set"
  | "lineage"
  | "import";
export type PartKind = "alt_line" | "tag_line" | "context" | "note" | "question";
export type LaughSize = "table" | "big" | "unsure";
export type QuestionCategory = "analyze" | "audience" | "build" | "rating";
export type SetStatus = "idea" | "wip" | "workshopping" | "ready" | "retired";
export type RevisionKind = "working" | "anchor" | "variant";
export type VariantState = "open" | "picked" | "unpicked";
export type TransitionKind = "written" | "hard_cut";
export type PerformanceResult = "landed" | "flat" | "cut";

export const CARD_FORMS: CardForm[] = ["observation", "line", "premise", "story", "act_out", "tag_line"];
export const FORM_LABELS: Record<CardForm, string> = {
  observation: "Observation",
  line: "Line",
  premise: "Premise",
  story: "Story",
  act_out: "Act-out",
  tag_line: "Tag line",
};
export const PART_KINDS: PartKind[] = ["alt_line", "tag_line", "context", "note", "question"];
export const PART_LABELS: Record<PartKind, string> = {
  alt_line: "Alt line",
  tag_line: "Tag line",
  context: "Context",
  note: "Note",
  question: "Question",
};

export interface VersionDTO {
  id: string;
  label: string;
  depth: number;
  branch: string;
  parent_label: string | null;
  title: string | null;
  body: string;
  context: string | null;
  details: string | null;
  created_context: VersionContext;
  created_context_label: string | null;
  change_note: string | null;
  edit_count: number;
  word_count: number;
  sealed: boolean;
  created_at: string;
  last_edited_at: string;
}

export interface SubjectDTO {
  id: string;
  name: string;
}
export interface ThemeDTO {
  id: string;
  name: string;
  source: "workshop_answer" | "cluster" | "manual";
}
export interface PartDTO {
  id: string;
  kind: PartKind;
  body: string;
  position: number;
  created_on_version_label: string | null;
}

export interface CardSummaryDTO {
  id: string;
  number: number;
  display_number: string;
  display_title: string;
  body_excerpt: string;
  kind: CardKind;
  form: CardForm | null;
  form_inferred: boolean;
  status: CardStatus;
  inbox_state: InboxState;
  capture_source: CaptureSource;
  captured_at: string;
  updated_at: string;
  killed_at: string | null;
  current_version_label: string;
  subjects: SubjectDTO[];
  themes: ThemeDTO[];
  usage_label: string | null;
  /** Full body of the current version (needed by the feed and board cards). */
  body: string;
  title: string | null;
}

export interface CardPlacementsDTO {
  boards: { id: string; name: string; item_id: string; pinned_version_label: string }[];
  bits: { id: string; name: string; item_id: string; pinned_version_label: string }[];
  sets: { id: string; name: string; in_working: boolean; anchors: number[] }[];
  workshop: { root_node_id: string; answer_count: number; last_session_id: string | null } | null;
}

export interface CardDTO extends Omit<CardSummaryDTO, "body_excerpt"> {
  rev: number;
  laugh_size: LaughSize | null;
  current_version: VersionDTO;
  version_count: number;
  parts: PartDTO[];
  placements: CardPlacementsDTO;
}

export interface LineageLinkDTO {
  relation: "promoted_from" | "combined_from" | "split_from" | "detached_from" | "callback_to";
  direction: "incoming" | "outgoing";
  other_card: CardSummaryDTO;
  this_version_label: string | null;
  other_version_label: string | null;
}

export interface LineageDTO {
  card: CardSummaryDTO;
  versions: VersionDTO[];
  columns: { key: string; label: string; date_label: string; version_labels: string[] }[];
  links: LineageLinkDTO[];
  bit_memberships: {
    bit_id: string;
    bit_name: string;
    version_label: string;
    parents: { display_number: string; version_label: string }[];
    set_names: string[];
  }[];
  workshop_path:
    | (
        | { type: "seed"; card_number: number; text: string }
        | { type: "question"; text: string }
        | { type: "answer"; node_id: string; text: string }
      )[]
    | null;
  appears_in: {
    type: "board" | "bit" | "set" | "workshop";
    id: string;
    name: string;
    version_label: string;
    detail: string;
  }[];
  performed: PerformedAppearanceDTO[];
  related: CardSummaryDTO[];
}

export interface PerformedAppearanceDTO {
  performance_id: string;
  performed_on: string;
  venue_label: string | null;
  set_name: string;
  anchor_number: number;
  version_label: string;
  result: PerformanceResult;
}

export interface NodeDTO {
  id: string;
  kind: "root" | "answer";
  question_id: string | null;
  text: string | null;
  author_label: string | null;
  angle_label: string | null;
  laugh_size: LaughSize | null;
  is_dead_end: boolean;
  promoted_card_number: number | null;
  x: number | null;
  y: number | null;
  position: number;
  updated_at: string;
}

export interface QuestionDTO {
  id: string;
  node_id: string;
  template_id: string | null;
  text: string;
  short_label: string;
  category: Exclude<QuestionCategory, "rating">;
  system_key: string | null;
  position: number;
}

export interface QuestionTemplateDTO {
  id: string;
  system_key: string | null;
  text: string;
  short_label: string;
  category: QuestionCategory;
  position: number;
  archived: boolean;
}

export interface SessionSummaryDTO {
  id: string;
  title: string;
  participants: string[];
  started_at: string;
  ended_at: string | null;
  notes: string;
  seed_count: number;
  seeds: { card: CardSummaryDTO; node_count: number; angle_count: number; promoted_count: number }[];
  dead_end_count: number;
  promoted_count: number;
}

export interface MapDTO {
  seed: CardDTO;
  root: NodeDTO;
  nodes: NodeDTO[];
  questions: QuestionDTO[];
  angles: { letter: string; node_id: string }[];
  stats: { angle_count: number; node_count: number; promoted_count: number; dead_end_count: number };
}

export type BranchStep = { node: NodeDTO } | { question: QuestionDTO };
export interface BranchDTO {
  path: BranchStep[];
  angle: string | null;
  angle_index: number;
  angle_count: number;
  forks: { node_id: string; child_count: number }[];
}

export interface BitItemDTO {
  id: string;
  kind: "joke" | "bridge";
  position: number;
  card?: CardSummaryDTO;
  pinned_version?: VersionDTO;
  latest_version_label?: string;
  bridge_text?: string;
  edited_here_count?: number;
}

export interface BitSummaryDTO {
  id: string;
  name: string;
  item_count: number;
  joke_count: number;
  duration_seconds: number;
  created_at: string;
  updated_at: string;
  is_new: boolean;
  archived: boolean;
}

export interface BitDTO {
  bit: {
    id: string;
    name: string;
    source_cluster_id: string | null;
    source_cluster_name: string | null;
    duration_override_seconds: number | null;
    archived: boolean;
    created_at: string;
    updated_at: string;
  };
  items: BitItemDTO[];
  duration_seconds: number;
  unplaced_from_cluster: CardSummaryDTO[];
  used_in_sets: { id: string; name: string; in_working: boolean; anchors: number[] }[];
  performed: { performed_on: string; venue_label: string | null; set_name: string; anchor_number: number; result: PerformanceResult }[];
}

export interface RevisionItemDTO {
  position: number;
  bit_id: string;
  bit_name: string;
  joke_count: number;
  duration_seconds: number;
  is_new_in_revision: boolean;
  marked_cut_on: string | null;
  primary_subject: string | null;
  archived: boolean;
}

export interface TransitionDTO {
  from_bit_id: string;
  to_bit_id: string;
  state: "written" | "hard_cut" | "missing";
  text: string | null;
  callback_to_card_number: number | null;
}

export interface NoteDTO {
  kind: "warning" | "positive" | "info";
  code: string;
  text: string;
}

export type ScriptBlockDTO =
  | { type: "bit_header"; position: number; bit_id: string; name: string; duration_seconds: number }
  | { type: "joke"; bit_id: string; card_number: number; version_label: string; text: string; item_id?: string }
  | { type: "bridge"; bit_id: string; text: string; item_id?: string }
  | {
      type: "transition";
      from_bit_id: string;
      to_bit_id: string;
      state: "written" | "hard_cut" | "missing";
      text: string | null;
    };

export interface RevisionDTO {
  id: string;
  set_id: string;
  kind: RevisionKind;
  anchor_number: number | null;
  name: string | null;
  parent_revision_id: string | null;
  parent_anchor_number: number | null;
  fork_group_id: string | null;
  variant_letter: string | null;
  variant_description: string | null;
  variant_state: VariantState | null;
  frozen_at: string | null;
  rev: number;
  items: RevisionItemDTO[];
  transitions: TransitionDTO[];
  runtime_seconds: number;
  transitions_to_write: number;
  notes: NoteDTO[];
  callbacks: { card_number: number; label: string; valid: boolean }[];
  shared: { from_bit_id: string; to_bit_id: string; subjects: string[]; themes: string[] }[];
  script?: ScriptBlockDTO[];
}

export interface RiverNodeDTO {
  revision_id: string;
  kind: "anchor" | "variant";
  label: string;
  name: string | null;
  parent_revision_id: string | null;
  fork_group_id: string | null;
  variant_state: VariantState | null;
  is_current: boolean;
  created_at: string;
  bit_count: number;
  performance_summary: string | null;
}

export interface PerformanceDTO {
  id: string;
  set_id: string;
  set_name: string;
  revision_id: string;
  anchor_number: number;
  anchor_name: string | null;
  performed_on: string;
  venue_label: string | null;
  notes: string;
  marks: { bit_id: string; bit_name: string; position: number; result: PerformanceResult; note: string | null }[];
  bits: { bit_id: string; bit_name: string; position: number }[];
  is_active: boolean;
  created_at: string;
}

export interface SetSummaryDTO {
  id: string;
  name: string;
  status: SetStatus;
  current_anchor: { number: number; name: string } | null;
  runtime_seconds: number;
  target_duration_seconds: number | null;
  last_performed_on: string | null;
  archived: boolean;
  updated_at: string;
}

export interface SetDTO {
  set: {
    id: string;
    name: string;
    status: SetStatus;
    target_duration_seconds: number | null;
    current_anchor_id: string | null;
    current_anchor_number: number | null;
    current_anchor_name: string | null;
    archived: boolean;
    updated_at: string;
  };
  working: RevisionDTO;
  changed_since_anchor: boolean;
  anchors: RiverNodeDTO[];
  variants: RiverNodeDTO[];
  bench: BitSummaryDTO[];
  active_performance: PerformanceDTO | null;
  reuse_candidates: { from_bit_id: string; to_bit_id: string; anchor_label: string; text: string }[];
}

export interface ForkDTO {
  fork_group: { id: string; mode: "insert_all_positions" | "duplicate"; inserted_bit_id: string | null; inserted_bit_name: string | null };
  base: RevisionDTO;
  variants: (RevisionDTO & { ordering_code: string; differs: string[] })[];
}

export interface BoardSummaryDTO {
  id: string;
  name: string;
  card_count: number;
  cluster_count: number;
  updated_at: string;
  archived: boolean;
}

export interface BoardItemDTO {
  id: string;
  card: CardSummaryDTO;
  pinned_version_label: string;
  latest_version_label: string;
  pinned_body: string;
  pinned_title: string | null;
  x: number;
  y: number;
  cluster_id: string | null;
  cluster_position: number | null;
}

export interface BoardClusterDTO {
  id: string;
  name: string | null;
  use_as_theme: boolean;
  theme_id: string | null;
  member_count: number;
  aggregated_subjects: { name: string; count: number }[];
  used_in: { type: "bit" | "set"; id: string; name: string; count: number }[];
}

export interface BoardDTO {
  board: { id: string; name: string; archived: boolean; updated_at: string };
  items: BoardItemDTO[];
  clusters: BoardClusterDTO[];
  tray: CardSummaryDTO[];
  tray_total: number;
}

export interface SettingsDTO {
  ai_assist_enabled: boolean;
  ai_available: boolean;
  reading_wpm: number;
  dismissed_hints: string[];
}

export interface MeDTO {
  user: { id: string; email: string; name: string | null };
  settings: SettingsDTO;
  counts: { inbox: number; killed: number; performances: number };
}

export interface SearchResultDTO {
  cards: {
    number: number;
    display_title: string;
    snippet_html: string;
    status: CardStatus;
    killed: boolean;
    matched_in: "title" | "body" | "context" | "part" | "old_version";
  }[];
  bits: { id: string; name: string; snippet_html: string }[];
  sets: { id: string; name: string; snippet_html: string }[];
  boards: { id: string; name: string; snippet_html: string }[];
  subjects: { id: string; name: string; count: number }[];
  themes: { id: string; name: string; count: number }[];
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
