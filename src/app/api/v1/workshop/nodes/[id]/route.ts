// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { nodePatchSchema } from "@/lib/validation";
import { deleteNode, patchNode } from "@/server/services/workshop";

export const PATCH = handler({ body: nodePatchSchema }, async (ctx) => {
  return { node: await patchNode(ctx.userId, ctx.params.id, ctx.body) };
});

export const DELETE = handler({}, async (ctx) => {
  await deleteNode(ctx.userId, ctx.params.id);
  return null;
});
