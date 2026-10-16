// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { pickSchema } from "@/lib/validation";
import { pickVariant } from "@/server/services/sets";

export const POST = handler({ body: pickSchema }, async (ctx) => {
  return pickVariant(ctx.userId, ctx.params.id, ctx.body);
});
