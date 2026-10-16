// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { workingPutSchema } from "@/lib/validation";
import { putWorking } from "@/server/services/sets";

export const PUT = handler({ body: workingPutSchema }, async (ctx) => {
  return putWorking(ctx.userId, ctx.params.id, ctx.body);
});
