// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { tidyMap } from "@/server/services/workshop";

const num = (s: string) => Number(s);

export const POST = handler({}, async (ctx) => {
  await tidyMap(ctx.userId, num(ctx.params.cardNumber));
  return { ok: true };
});
