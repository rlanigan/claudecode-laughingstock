// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { duplicateRevision } from "@/server/services/sets";

export const POST = handler({}, async (ctx) => {
  return created(await duplicateRevision(ctx.userId, ctx.params.id));
});
