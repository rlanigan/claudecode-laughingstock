// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { searchQuery } from "@/lib/validation";
import { search } from "@/server/services/search";

export const GET = handler({ query: searchQuery }, async (ctx) => {
  return {
    groups: await search(ctx.userId, {
      q: ctx.query.q,
      type: ctx.query.type,
      includeVersions: ctx.query.include_versions === "true",
      includeKilled: ctx.query.include_killed === "true",
      limit: ctx.query.limit,
    }),
  };
});
