// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { orderSchema } from "@/lib/validation";
import { reorderTemplates } from "@/server/services/workshop";

export const PUT = handler({ body: orderSchema }, async (ctx) => {
  return reorderTemplates(ctx.userId, ctx.body.ids);
});
