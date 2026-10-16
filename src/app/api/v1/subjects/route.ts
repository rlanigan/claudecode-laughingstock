// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { subjectsQuery } from "@/lib/validation";
import { listSubjects } from "@/server/services/tags";

export const GET = handler({ query: subjectsQuery }, async (ctx) => {
  return listSubjects(ctx.userId, ctx.query);
});
