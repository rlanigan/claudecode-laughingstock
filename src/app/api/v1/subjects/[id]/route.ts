// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { renameSchema } from "@/lib/validation";
import { deleteSubject, renameSubject } from "@/server/services/tags";

export const PATCH = handler({ body: renameSchema }, async (ctx) => {
  return renameSubject(ctx.userId, ctx.params.id, ctx.body.name);
});

export const DELETE = handler({}, async (ctx) => {
  await deleteSubject(ctx.userId, ctx.params.id);
  return null;
});
