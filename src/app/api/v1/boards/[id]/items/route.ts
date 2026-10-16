// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { boardItemCreateSchema } from "@/lib/validation";
import { addItem } from "@/server/services/boards";

export const POST = handler({ body: boardItemCreateSchema }, async (ctx) => {
  return created({ item: await addItem(ctx.userId, ctx.params.id, ctx.body) });
});
