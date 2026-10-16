// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { renameSchema } from "@/lib/validation";
import { deleteTheme, renameTheme } from "@/server/services/tags";

export const PATCH = handler({ body: renameSchema }, async (ctx) => {
  return renameTheme(ctx.userId, ctx.params.id, ctx.body.name);
});

export const DELETE = handler({}, async (ctx) => {
  await deleteTheme(ctx.userId, ctx.params.id);
  return null;
});
