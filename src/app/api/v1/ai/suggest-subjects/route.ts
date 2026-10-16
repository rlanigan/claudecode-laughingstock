// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { aiSuggestSchema } from "@/lib/validation";
import { aiSuggestSubjects } from "@/server/services/ai";

export const POST = handler(
  { body: aiSuggestSchema, rateLimit: { key: "ai", limit: 30, windowSeconds: 60 } },
  async (ctx) => {
    return aiSuggestSubjects(ctx.userId, ctx.body.text, ctx.body.context);
  },
);
