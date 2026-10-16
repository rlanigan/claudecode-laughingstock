// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { transitionDeleteQuery, transitionPutSchema } from "@/lib/validation";
import { deleteTransition, putTransition } from "@/server/services/sets";

export const PUT = handler({ body: transitionPutSchema }, async (ctx) => {
  return putTransition(ctx.userId, ctx.params.id, ctx.body);
});

export const DELETE = handler({ query: transitionDeleteQuery }, async (ctx) => {
  await deleteTransition(ctx.userId, ctx.params.id, ctx.query.from_bit_id, ctx.query.to_bit_id);
  return null;
});
