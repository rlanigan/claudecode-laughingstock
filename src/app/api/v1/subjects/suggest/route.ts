// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { suggestQuery } from "@/lib/validation";
import { suggestSubjects } from "@/server/services/tags";

export const GET = handler({ query: suggestQuery }, async (ctx) => {
  return suggestSubjects(ctx.userId, ctx.query.text);
});
