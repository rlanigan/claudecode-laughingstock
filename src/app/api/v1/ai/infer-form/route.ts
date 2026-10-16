// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { aiInferFormSchema } from "@/lib/validation";
import { aiInferForm } from "@/server/services/ai";

export const POST = handler(
  { body: aiInferFormSchema, rateLimit: { key: "ai", limit: 30, windowSeconds: 60 } },
  async (ctx) => {
    return aiInferForm(ctx.userId, ctx.body.card_number);
  },
);
