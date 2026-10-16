// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { cardCounts } from "@/server/services/cards";

export const GET = handler({}, async (ctx) => {
  return cardCounts(ctx.userId);
});
