-- Comedy Card Writer — initial schema (HANDOFF.md §6.3). Hand-maintained; the Drizzle schema in
-- src/db/schema.ts mirrors this file. Extensions and generated/deferrable constraints that
-- drizzle-kit cannot express live here on purpose.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ===== Enums =====
create type card_kind as enum ('note','joke');
create type card_form as enum ('observation','line','premise','story','act_out','tag_line');
create type form_source as enum ('user','inferred');
create type card_status as enum ('raw','workshopped','promoted','tested','landed','killed');
create type inbox_state as enum ('inbox','filed');
create type capture_source as enum ('phone','desktop','share_sheet','voice_memo','hotkey','import');
create type version_context as enum ('capture','inbox','review','board','workshop','bit','set','lineage','import');
create type part_kind as enum ('alt_line','tag_line','context','note','question');
create type card_link_relation as enum ('promoted_from','combined_from','split_from','detached_from','callback_to');
create type card_event_type as enum ('captured','edited','version_created','kept','returned_to_inbox','killed','restored',
  'tagged','untagged','form_set','theme_added','theme_removed','part_added','added_to_board','removed_from_board',
  'pin_changed','seeded_in_workshop','promoted','added_to_bit','removed_from_bit','added_to_set','anchored',
  'performed','detached','split','combined');
create type theme_source as enum ('workshop_answer','cluster','manual');
create type question_category as enum ('analyze','audience','build','rating');
create type laugh_size as enum ('table','big','unsure');
create type workshop_node_kind as enum ('root','answer');
create type bit_item_kind as enum ('joke','bridge');
create type set_status as enum ('idea','wip','workshopping','ready','retired');
create type revision_kind as enum ('working','anchor','variant');
create type variant_state as enum ('open','picked','unpicked');
create type fork_mode as enum ('insert_all_positions','duplicate');
create type transition_kind as enum ('written','hard_cut');
create type performance_result as enum ('landed','flat','cut');
create type attachment_kind as enum ('audio');
create type transcript_status as enum ('none','pending','done','failed');
create type job_status as enum ('queued','running','succeeded','failed','dead');

-- ===== Identity (Auth.js-compatible) =====
create table users (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) <= 80),
  email text not null unique check (email = lower(email) and char_length(email) <= 254),
  email_verified timestamptz,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table accounts (
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text, access_token text, expires_at integer, token_type text,
  scope text, id_token text, session_state text,
  primary key (provider, provider_account_id)
);

create table sessions (
  session_token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires timestamptz not null
);
create index sessions_user_idx on sessions(user_id);

create table verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

create table user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  ai_assist_enabled boolean not null default false,
  ai_consent_at timestamptz,
  reading_wpm integer not null default 150 check (reading_wpm between 90 and 220),
  dismissed_hints text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table card_counters (
  user_id uuid primary key references users(id) on delete cascade,
  next_number integer not null default 1 check (next_number >= 1)
);

-- ===== Cards =====
create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  number integer not null check (number >= 1),
  kind card_kind not null default 'note',
  form card_form,
  form_source form_source,
  status card_status not null default 'raw',
  inbox_state inbox_state not null default 'inbox',
  capture_source capture_source not null,
  client_id uuid,
  captured_at timestamptz not null default now(),
  current_version_id uuid,
  laugh_size laugh_size,
  killed_at timestamptz,
  rev integer not null default 1,
  search_tsv tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, number),
  check ((form is null) = (form_source is null))
);
create unique index cards_user_client_uidx on cards(user_id, client_id) where client_id is not null;
create index cards_inbox_idx on cards(user_id, captured_at desc, id desc) where inbox_state = 'inbox' and killed_at is null;
create index cards_feed_idx on cards(user_id, captured_at desc, id desc);
create index cards_updated_idx on cards(user_id, updated_at desc);
create index cards_killed_idx on cards(user_id, killed_at desc) where killed_at is not null;
create index cards_search_idx on cards using gin(search_tsv);

create table card_versions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  parent_version_id uuid references card_versions(id) on delete restrict,
  depth integer not null check (depth >= 1),
  branch text not null default '' check (branch ~ '^([b-z]|z[0-9]+)?$'),
  label text generated always as ('v' || depth::text || branch) stored,
  title text check (title is null or char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 20000),
  context text check (context is null or char_length(context) <= 5000),
  details text check (details is null or char_length(details) <= 5000),
  created_context version_context not null,
  created_context_ref_id uuid,
  created_context_label text,
  change_note text check (change_note is null or char_length(change_note) <= 200),
  edit_count integer not null default 1 check (edit_count >= 1),
  word_count integer not null default 0,
  sealed_at timestamptz,
  last_edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (card_id, depth, branch),
  check (char_length(btrim(coalesce(title, '') || body)) > 0)
);
create index card_versions_card_idx on card_versions(card_id, created_at);
create index card_versions_parent_idx on card_versions(parent_version_id);

alter table cards add constraint cards_current_version_fk
  foreign key (current_version_id) references card_versions(id) deferrable initially deferred;

create table card_parts (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_on_version_id uuid references card_versions(id) on delete set null,
  kind part_kind not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index card_parts_card_idx on card_parts(card_id, position);

create table subject_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9 \-]{0,39}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index subject_tags_trgm_idx on subject_tags using gin(name gin_trgm_ops);

create table card_subject_tags (
  card_id uuid not null references cards(id) on delete cascade,
  tag_id uuid not null references subject_tags(id) on delete cascade,
  source text not null default 'user' check (source in ('user','suggestion','inherited')),
  created_at timestamptz not null default now(),
  primary key (card_id, tag_id)
);
create index card_subject_tags_tag_idx on card_subject_tags(tag_id);

create table themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_key text generated always as (lower(btrim(name))) stored,
  source theme_source not null,
  source_ref_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_key)
);

create table card_themes (
  card_id uuid not null references cards(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  source text not null check (source in ('user','cluster','workshop_answer','inherited')),
  source_ref_id uuid,
  created_at timestamptz not null default now(),
  primary key (card_id, theme_id)
);
create index card_themes_theme_idx on card_themes(theme_id);

-- ===== Workshop =====
create table workshop_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  participants text[] not null default '{}' check (cardinality(participants) <= 10),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text not null default '' check (char_length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workshop_sessions_user_idx on workshop_sessions(user_id, started_at desc);

create table workshop_session_seeds (
  session_id uuid not null references workshop_sessions(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  primary key (session_id, card_id)
);

create table question_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  system_key text check (system_key in ('why_funny','relating','point','context','enter','punchline','laugh_size')),
  text text not null check (char_length(btrim(text)) between 1 and 200),
  short_label text not null check (char_length(btrim(short_label)) between 1 and 40),
  category question_category not null,
  position integer not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index question_templates_system_uidx on question_templates(user_id, system_key) where system_key is not null;

create table workshop_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  seed_card_id uuid not null references cards(id) on delete cascade,
  kind workshop_node_kind not null,
  seed_version_id uuid references card_versions(id) on delete set null,
  question_id uuid,
  text text check (text is null or char_length(btrim(text)) between 1 and 5000),
  author_label text check (author_label is null or char_length(author_label) <= 60),
  angle_label text check (angle_label is null or angle_label ~ '^[A-Z]$'),
  laugh_size laugh_size,
  is_dead_end boolean not null default false,
  promoted_card_id uuid references cards(id) on delete set null,
  x real, y real,
  position integer not null default 0,
  created_in_session_id uuid references workshop_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'root' and question_id is null and text is null)
      or (kind = 'answer' and question_id is not null and text is not null))
);
create unique index workshop_root_uidx on workshop_nodes(seed_card_id) where kind = 'root';
create unique index workshop_angle_uidx on workshop_nodes(seed_card_id, angle_label) where angle_label is not null;
create index workshop_nodes_seed_idx on workshop_nodes(seed_card_id);

create table workshop_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  seed_card_id uuid not null references cards(id) on delete cascade,
  node_id uuid not null references workshop_nodes(id) on delete cascade,
  template_id uuid references question_templates(id) on delete set null,
  text text not null,
  short_label text not null,
  category question_category not null check (category <> 'rating'),
  position integer not null default 0,
  created_in_session_id uuid references workshop_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index workshop_questions_node_idx on workshop_questions(node_id);

alter table workshop_nodes add constraint workshop_nodes_question_fk
  foreign key (question_id) references workshop_questions(id) on delete cascade;
create index workshop_nodes_question_idx on workshop_nodes(question_id);

-- ===== Card links and events =====
create table card_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  relation card_link_relation not null,
  source_card_id uuid not null references cards(id) on delete cascade,
  source_version_id uuid references card_versions(id) on delete set null,
  derived_card_id uuid not null references cards(id) on delete cascade,
  derived_version_id uuid references card_versions(id) on delete set null,
  via_workshop_node_id uuid references workshop_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_card_id <> derived_card_id)
);
create index card_links_source_idx on card_links(source_card_id);
create index card_links_derived_idx on card_links(derived_card_id);

create table card_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  version_id uuid references card_versions(id) on delete set null,
  event_type card_event_type not null,
  ref_type text check (ref_type in ('board','bit','set','session','performance','card')),
  ref_id uuid,
  label text,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index card_events_card_idx on card_events(card_id, occurred_at);

-- ===== Boards =====
create table boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index boards_name_uidx on boards(user_id, lower(btrim(name)));

create table board_clusters (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text check (name is null or char_length(btrim(name)) between 1 and 80),
  use_as_theme boolean not null default true,
  theme_id uuid references themes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  pinned_version_id uuid not null references card_versions(id) on delete restrict,
  x real not null, y real not null,
  cluster_id uuid references board_clusters(id) on delete set null,
  cluster_position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, card_id),
  check ((cluster_id is null) = (cluster_position is null))
);
create index board_items_card_idx on board_items(card_id);

-- ===== Bits and sets =====
create table bits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  source_cluster_id uuid references board_clusters(id) on delete set null,
  duration_override_seconds integer check (duration_override_seconds between 1 and 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table bit_items (
  id uuid primary key default gen_random_uuid(),
  bit_id uuid not null references bits(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  position integer not null,
  kind bit_item_kind not null,
  card_id uuid references cards(id) on delete restrict,
  pinned_version_id uuid references card_versions(id) on delete restrict,
  bridge_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'joke' and card_id is not null and pinned_version_id is not null and bridge_text is null)
      or (kind = 'bridge' and card_id is null and pinned_version_id is null
          and char_length(btrim(bridge_text)) between 1 and 2000)),
  constraint bit_items_position_uq unique (bit_id, position) deferrable initially deferred
);
create unique index bit_items_card_uidx on bit_items(bit_id, card_id) where card_id is not null;
create index bit_items_card_idx on bit_items(card_id);

create table sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  status set_status not null default 'wip',
  target_duration_seconds integer check (target_duration_seconds between 30 and 14400),
  current_anchor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table set_revisions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind revision_kind not null,
  parent_revision_id uuid references set_revisions(id) on delete set null,
  anchor_number integer check (anchor_number >= 1),
  name text check (name is null or char_length(btrim(name)) between 1 and 80),
  fork_group_id uuid,
  variant_letter text check (variant_letter is null or variant_letter ~ '^[A-Z]{1,2}$'),
  variant_description text,
  variant_state variant_state,
  frozen_at timestamptz,
  rev integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'anchor' or (anchor_number is not null and name is not null and frozen_at is not null)),
  check (kind <> 'variant' or (variant_state in ('open','unpicked') and fork_group_id is not null and frozen_at is null)),
  check (kind <> 'working' or (anchor_number is null and fork_group_id is null and frozen_at is null))
);
create unique index set_revisions_working_uidx on set_revisions(set_id) where kind = 'working';
create unique index set_revisions_anchor_uidx on set_revisions(set_id, anchor_number) where anchor_number is not null;

create table set_fork_groups (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  base_revision_id uuid not null references set_revisions(id) on delete cascade,
  mode fork_mode not null,
  inserted_bit_id uuid references bits(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table set_revisions add constraint set_revisions_fork_fk
  foreign key (fork_group_id) references set_fork_groups(id) on delete cascade;
create unique index set_revisions_letter_uidx on set_revisions(fork_group_id, variant_letter) where variant_letter is not null;
alter table sets add constraint sets_current_anchor_fk
  foreign key (current_anchor_id) references set_revisions(id) on delete set null;

create table set_revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references set_revisions(id) on delete cascade,
  position integer not null,
  bit_id uuid not null references bits(id) on delete restrict,
  bit_snapshot jsonb,
  constraint set_revision_items_position_uq unique (revision_id, position) deferrable initially deferred,
  unique (revision_id, bit_id)
);
create index set_revision_items_bit_idx on set_revision_items(bit_id);

create table set_transitions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  from_bit_id uuid not null references bits(id) on delete cascade,
  to_bit_id uuid not null references bits(id) on delete cascade,
  kind transition_kind not null,
  text text check (text is null or char_length(text) <= 1000),
  callback_to_card_id uuid references cards(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (set_id, from_bit_id, to_bit_id),
  check (from_bit_id <> to_bit_id),
  check (kind <> 'written' or char_length(btrim(coalesce(text, ''))) >= 1)
);

create table set_revision_transitions (
  revision_id uuid not null references set_revisions(id) on delete cascade,
  from_bit_id uuid not null,
  to_bit_id uuid not null,
  kind transition_kind not null,
  text text,
  callback_to_card_id uuid,
  primary key (revision_id, from_bit_id, to_bit_id)
);

-- ===== Performances =====
create table performances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  set_id uuid not null references sets(id) on delete cascade,
  revision_id uuid not null references set_revisions(id) on delete restrict,
  performed_on date not null,
  venue_label text check (venue_label is null or char_length(venue_label) <= 80),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index performances_set_idx on performances(set_id, performed_on desc);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind attachment_kind not null,
  storage_key text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  duration_ms integer,
  owner_type text not null check (owner_type in ('card','performance_mark','workshop_session')),
  owner_id uuid not null,
  transcript text,
  transcript_status transcript_status not null default 'none',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index attachments_owner_idx on attachments(owner_type, owner_id);

create table performance_marks (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  bit_id uuid not null references bits(id) on delete restrict,
  position integer not null,
  result performance_result not null,
  note text check (note is null or char_length(note) <= 2000),
  voice_attachment_id uuid references attachments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (performance_id, bit_id)
);

-- ===== Infrastructure =====
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  status job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs(status, run_after) where status in ('queued','failed');

create table analytics_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  name text not null,
  properties jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index analytics_events_name_idx on analytics_events(name, occurred_at);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- ===== Search vector maintenance =====
-- Called from the service layer (not a trigger) once per transaction that touches a card's
-- current version or parts.
create or replace function refresh_card_search(p_card_id uuid) returns void language sql as $$
  update cards c set search_tsv =
      setweight(to_tsvector('english', coalesce(v.title, '')), 'A')
   || setweight(to_tsvector('english', coalesce(v.body, '')), 'B')
   || setweight(to_tsvector('english', coalesce(v.context, '') || ' ' || coalesce(v.details, '')), 'C')
   || setweight(to_tsvector('english', coalesce((select string_agg(p.body, ' ') from card_parts p where p.card_id = c.id), '')), 'C')
  from card_versions v
  where c.id = p_card_id and v.id = c.current_version_id;
$$;
