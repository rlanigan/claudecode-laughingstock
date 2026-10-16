// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { todayCards } from "@/server/services/cards";
import { z } from "zod";

export const GET = handler({ query: z.object({ tz: z.coerce.number().int().default(0) }) }, async (ctx) => {
  return { items: await todayCards(ctx.userId, ctx.query.tz) };
});
