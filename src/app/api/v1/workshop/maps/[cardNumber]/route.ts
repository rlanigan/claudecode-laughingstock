// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { getMap } from "@/server/services/workshop";

const num = (s: string) => Number(s);

export const GET = handler({}, async (ctx) => {
  return getMap(ctx.userId, num(ctx.params.cardNumber));
});
