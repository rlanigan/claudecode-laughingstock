// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { combineSchema } from "@/lib/validation";
import { combineCards } from "@/server/services/cards";

export const POST = handler({ body: combineSchema }, async (ctx) => {
  return created({ card: await combineCards(ctx.userId, ctx.body.card_numbers, ctx.body.title) });
});
