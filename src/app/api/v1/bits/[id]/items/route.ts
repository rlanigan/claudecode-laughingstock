// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { bitItemCreateSchema } from "@/lib/validation";
import { addBitItem } from "@/server/services/bits";

export const POST = handler({ body: bitItemCreateSchema }, async (ctx) => {
  return created(await addBitItem(ctx.userId, ctx.params.id, ctx.body));
});
