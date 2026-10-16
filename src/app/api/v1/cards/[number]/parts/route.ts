// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { partCreateSchema } from "@/lib/validation";
import { addPart } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({ body: partCreateSchema }, async (ctx) => {
  return created({ part: await addPart(ctx.userId, num(ctx.params.number), ctx.body) });
});
