// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { answerSchema } from "@/lib/validation";
import { addAnswer } from "@/server/services/workshop";

export const POST = handler({ body: answerSchema }, async (ctx) => {
  return created({ node: await addAnswer(ctx.userId, ctx.params.id, ctx.body) });
});
