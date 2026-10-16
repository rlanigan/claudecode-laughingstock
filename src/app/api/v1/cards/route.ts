// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { captureSchema, listCardsQuery } from "@/lib/validation";
import { captureCard, listCards } from "@/server/services/cards";

export const GET = handler({ query: listCardsQuery }, async (ctx) => {
  return listCards(ctx.userId, ctx.query);
});

export const POST = handler({ body: captureSchema }, async (ctx) => {
  const { card, created: isNew } = await captureCard(ctx.userId, ctx.body);
  return isNew ? created({ card }) : { card };
});
