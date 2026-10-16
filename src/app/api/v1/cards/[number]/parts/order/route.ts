// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { partOrderSchema } from "@/lib/validation";
import { reorderParts } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const PUT = handler({ body: partOrderSchema }, async (ctx) => {
  return { parts: await reorderParts(ctx.userId, num(ctx.params.number), ctx.body.part_ids) };
});
