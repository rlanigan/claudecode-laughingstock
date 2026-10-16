// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { splitSchema } from "@/lib/validation";
import { splitCard } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({ body: splitSchema }, async (ctx) => {
  return created({ cards: await splitCard(ctx.userId, num(ctx.params.number), ctx.body) });
});
