// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { bitOrderSchema } from "@/lib/validation";
import { reorderBit } from "@/server/services/bits";

export const PUT = handler({ body: bitOrderSchema }, async (ctx) => {
  return reorderBit(ctx.userId, ctx.params.id, ctx.body.item_ids);
});
