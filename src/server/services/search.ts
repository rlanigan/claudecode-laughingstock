// Global search (F-22, §18).
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import type { SearchResultDTO } from "@/types/dto";
import { displayTitle } from "@/domain/title-split";

export interface SearchOptions {
  q: string;
  type: "all" | "cards" | "bits" | "sets" | "boards" | "subjects" | "themes";
  includeVersions: boolean;
  includeKilled: boolean;
  limit: number;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Builds a snippet with only <mark> tags around case-insensitive matches of the query terms. */
export function snippet(text: string, q: string, max = 160): string {
  const terms = q
    .replace(/["\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
  const flat = text.replace(/\s+/g, " ").trim();
  let start = 0;
  const lower = flat.toLowerCase();
  const first = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  if (first.length) start = Math.max(0, Math.min(...first) - 40);
  let window = flat.slice(start, start + max);
  if (start > 0) window = `…${window}`;
  if (start + max < flat.length) window = `${window}…`;
  if (!terms.length) return escapeHtml(window);
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return window
    .split(re)
    .map((part, i) => (i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
}

export async function search(userId: string, opts: SearchOptions): Promise<SearchResultDTO> {
  const db = getDb();
  const q = opts.q.replace(/\s+/g, " ").trim().slice(0, 200);
  const out: SearchResultDTO = { cards: [], bits: [], sets: [], boards: [], subjects: [], themes: [] };
  if (!q) return out;
  const like = `%${q}%`;
  const want = (t: SearchOptions["type"]) => opts.type === "all" || opts.type === t;
  const numberMatch = /^#?(\d{1,6})$/.exec(q);

  if (want("cards")) {
    const killedFilter = opts.includeKilled ? sql`true` : sql`c.killed_at is null`;
    const rows = await db.execute(sql`
      with matches as (
        select c.id, c.number, c.status, c.killed_at, v.title, v.body, v.context, v.details,
               ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', ${q})) as rank,
               (c.search_tsv @@ websearch_to_tsquery('english', ${q})) as fts,
               (v.title ilike ${like}) as in_title,
               (v.body ilike ${like}) as in_body,
               (coalesce(v.context,'') ilike ${like} or coalesce(v.details,'') ilike ${like}) as in_context,
               exists (select 1 from card_parts p where p.card_id = c.id and p.body ilike ${like}) as in_part,
               ${opts.includeVersions ? sql`exists (select 1 from card_versions ov where ov.card_id = c.id and ov.id <> c.current_version_id and (ov.body ilike ${like} or coalesce(ov.title,'') ilike ${like}))` : sql`false`} as in_old,
               ${numberMatch ? sql`(c.number = ${Number(numberMatch[1])})` : sql`false`} as is_number,
               c.updated_at
        from cards c join card_versions v on v.id = c.current_version_id
        where c.user_id = ${userId} and ${killedFilter}
      )
      select * from matches
      where fts or in_title or in_body or in_context or in_part or in_old or is_number
      order by is_number desc, rank desc, updated_at desc
      limit ${opts.limit}`);
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const matched = r.in_title ? "title" : r.in_body || r.fts ? "body" : r.in_context ? "context" : r.in_part ? "part" : r.in_old ? "old_version" : "body";
      const source = matched === "title" ? (r.title as string) : matched === "context" ? `${r.context ?? ""} ${r.details ?? ""}` : (r.body as string);
      out.cards.push({
        number: Number(r.number),
        display_title: displayTitle((r.title as string | null) ?? null, r.body as string),
        snippet_html: snippet(source, q),
        status: r.status as SearchResultDTO["cards"][number]["status"],
        killed: r.killed_at !== null,
        matched_in: matched,
      });
    }
  }
  if (want("bits")) {
    const rows = await db.execute(sql`
      select b.id, b.name from bits b where b.user_id = ${userId} and b.archived_at is null and (b.name ilike ${like}
        or exists (select 1 from bit_items bi join card_versions v on v.id = bi.pinned_version_id where bi.bit_id = b.id and (v.body ilike ${like} or coalesce(v.title,'') ilike ${like})))
      order by (b.name ilike ${like}) desc, b.updated_at desc limit ${opts.limit}`);
    for (const r of rows as unknown as { id: string; name: string }[]) out.bits.push({ id: r.id, name: r.name, snippet_html: snippet(r.name, q) });
  }
  if (want("sets")) {
    const rows = await db.execute(sql`
      select s.id, s.name from sets s where s.user_id = ${userId} and s.archived_at is null and (s.name ilike ${like}
        or exists (select 1 from set_revisions r where r.set_id = s.id and coalesce(r.name,'') ilike ${like}))
      order by s.updated_at desc limit ${opts.limit}`);
    for (const r of rows as unknown as { id: string; name: string }[]) out.sets.push({ id: r.id, name: r.name, snippet_html: snippet(r.name, q) });
  }
  if (want("boards")) {
    const rows = await db.execute(sql`
      select b.id, b.name from boards b where b.user_id = ${userId} and b.archived_at is null and (b.name ilike ${like}
        or exists (select 1 from board_clusters bc where bc.board_id = b.id and coalesce(bc.name,'') ilike ${like}))
      order by b.updated_at desc limit ${opts.limit}`);
    for (const r of rows as unknown as { id: string; name: string }[]) out.boards.push({ id: r.id, name: r.name, snippet_html: snippet(r.name, q) });
  }
  if (want("subjects")) {
    const rows = await db.execute(sql`
      select t.id, t.name, (select count(*) from card_subject_tags cst where cst.tag_id = t.id)::int as count
      from subject_tags t where t.user_id = ${userId} and (t.name ilike ${like} or similarity(t.name, ${q}) > 0.3)
      order by similarity(t.name, ${q}) desc, count desc limit ${opts.limit}`);
    for (const r of rows as unknown as { id: string; name: string; count: number }[]) out.subjects.push(r);
  }
  if (want("themes")) {
    const rows = await db.execute(sql`
      select t.id, t.name, (select count(*) from card_themes ct where ct.theme_id = t.id)::int as count
      from themes t where t.user_id = ${userId} and (t.name ilike ${like} or similarity(t.name, ${q}) > 0.3)
      order by similarity(t.name, ${q}) desc, count desc limit ${opts.limit}`);
    for (const r of rows as unknown as { id: string; name: string; count: number }[]) out.themes.push(r);
  }
  return out;
}
