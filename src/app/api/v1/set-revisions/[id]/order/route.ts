// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { revisionOrderSchema } from "@/lib/validation";
import { putRevisionOrder } from "@/server/services/sets";

export const PUT = handler({ body: revisionOrderSchema }, async (ctx) => {
  return putRevisionOrder(ctx.userId, ctx.params.id, ctx.body);
});
