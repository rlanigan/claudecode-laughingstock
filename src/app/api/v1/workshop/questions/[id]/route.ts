// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { deleteQuestion } from "@/server/services/workshop";

export const DELETE = handler({}, async (ctx) => {
  await deleteQuestion(ctx.userId, ctx.params.id);
  return null;
});
