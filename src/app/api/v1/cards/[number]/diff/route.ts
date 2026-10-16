// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { getDiff } from "@/server/services/lineage";
import { z } from "zod";

const num = (s: string) => Number(s);

export const GET = handler({ query: z.object({ from: z.string(), to: z.string() }) }, async (ctx) => {
  return getDiff(ctx.userId, num(ctx.params.number), ctx.query.from, ctx.query.to);
});
