// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { performanceCreateSchema, performancesQuery } from "@/lib/validation";
import { createPerformance, listPerformances } from "@/server/services/performances";

export const GET = handler({ query: performancesQuery }, async (ctx) => {
  return listPerformances(ctx.userId, ctx.query);
});

export const POST = handler({ body: performanceCreateSchema }, async (ctx) => {
  return created({ performance: await createPerformance(ctx.userId, ctx.body) });
});
