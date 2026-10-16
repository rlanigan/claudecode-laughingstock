// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { restoreRevisionSchema } from "@/lib/validation";
import { restoreAnchor } from "@/server/services/sets";

export const POST = handler({ body: restoreRevisionSchema }, async (ctx) => {
  return restoreAnchor(ctx.userId, ctx.params.id, ctx.body);
});
