// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { markSchema } from "@/lib/validation";
import { deleteMark, putMark } from "@/server/services/performances";

export const PUT = handler({ body: markSchema }, async (ctx) => {
  return putMark(ctx.userId, ctx.params.id, ctx.params.bitId, ctx.body);
});

export const DELETE = handler({}, async (ctx) => {
  await deleteMark(ctx.userId, ctx.params.id, ctx.params.bitId);
  return null;
});
