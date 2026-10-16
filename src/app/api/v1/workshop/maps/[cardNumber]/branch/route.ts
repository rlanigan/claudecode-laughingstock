// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { getBranch } from "@/server/services/workshop";
import { z } from "zod";

const num = (s: string) => Number(s);

export const GET = handler({ query: z.object({ angle: z.string().optional() }) }, async (ctx) => {
  return getBranch(ctx.userId, num(ctx.params.cardNumber), ctx.query.angle);
});
