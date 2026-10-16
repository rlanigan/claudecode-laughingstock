// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { mergeSchema } from "@/lib/validation";
import { mergeSubjects } from "@/server/services/tags";

export const POST = handler({ body: mergeSchema }, async (ctx) => {
  return mergeSubjects(ctx.userId, ctx.params.id, ctx.body.into_id);
});
