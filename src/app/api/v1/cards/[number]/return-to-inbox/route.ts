// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { returnToInbox } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({}, async (ctx) => {
  return { card: await returnToInbox(ctx.userId, num(ctx.params.number)) };
});
