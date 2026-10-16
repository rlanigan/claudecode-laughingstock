// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { detachSchema } from "@/lib/validation";
import { detachCopy } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({ body: detachSchema }, async (ctx) => {
  return created({ card: await detachCopy(ctx.userId, num(ctx.params.number), ctx.body) });
});
