// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { boardItemPatchSchema } from "@/lib/validation";
import { patchItem, removeItem } from "@/server/services/boards";

export const PATCH = handler({ body: boardItemPatchSchema }, async (ctx) => {
  return patchItem(ctx.userId, ctx.params.id, ctx.body);
});

export const DELETE = handler({}, async (ctx) => {
  await removeItem(ctx.userId, ctx.params.id);
  return null;
});
