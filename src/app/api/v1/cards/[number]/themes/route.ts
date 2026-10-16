// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { cardThemesPutSchema } from "@/lib/validation";
import { setCardThemes } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const PUT = handler({ body: cardThemesPutSchema }, async (ctx) => {
  return { themes: await setCardThemes(ctx.userId, num(ctx.params.number), ctx.body.theme_ids) };
});
