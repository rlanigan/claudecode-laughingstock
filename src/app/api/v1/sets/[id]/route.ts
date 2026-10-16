// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { setPatchSchema } from "@/lib/validation";
import { deleteSet, getSet, patchSet } from "@/server/services/sets";

export const GET = handler({}, async (ctx) => {
  return getSet(ctx.userId, ctx.params.id);
});

export const PATCH = handler({ body: setPatchSchema }, async (ctx) => {
  return patchSet(ctx.userId, ctx.params.id, ctx.body);
});

export const DELETE = handler({}, async (ctx) => {
  await deleteSet(ctx.userId, ctx.params.id);
  return null;
});
