// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { askQuestionSchema } from "@/lib/validation";
import { askQuestion } from "@/server/services/workshop";

export const POST = handler({ body: askQuestionSchema }, async (ctx) => {
  const r = await askQuestion(ctx.userId, ctx.params.id, ctx.body);
  return r.rating ? { rating: true } : created({ question: r.question });
});
