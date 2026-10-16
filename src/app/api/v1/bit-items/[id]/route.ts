// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { bitItemPatchSchema } from "@/lib/validation";
import { patchBitItem, removeBitItem } from "@/server/services/bits";

export const PATCH = handler({ body: bitItemPatchSchema }, async (ctx) => {
  return patchBitItem(ctx.userId, ctx.params.id, ctx.body);
});

export const DELETE = handler({}, async (ctx) => {
  await removeBitItem(ctx.userId, ctx.params.id);
  return null;
});
