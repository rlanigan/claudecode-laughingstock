// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { partPatchSchema } from "@/lib/validation";
import { deletePart, patchPart } from "@/server/services/cards";

export const PATCH = handler({ body: partPatchSchema }, async (ctx) => {
  return { part: await patchPart(ctx.userId, ctx.params.id, ctx.body) };
});

export const DELETE = handler({}, async (ctx) => {
  await deletePart(ctx.userId, ctx.params.id);
  return null;
});
