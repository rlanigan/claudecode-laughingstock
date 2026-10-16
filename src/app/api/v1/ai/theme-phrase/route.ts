// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { aiThemePhraseSchema } from "@/lib/validation";
import { aiThemePhrase } from "@/server/services/ai";

export const POST = handler(
  { body: aiThemePhraseSchema, rateLimit: { key: "ai", limit: 30, windowSeconds: 60 } },
  async (ctx) => {
    return aiThemePhrase(ctx.userId, ctx.body.text);
  },
);
