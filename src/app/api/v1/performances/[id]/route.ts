// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { performancePatchSchema } from "@/lib/validation";
import { deletePerformance, getPerformance, patchPerformance } from "@/server/services/performances";

export const GET = handler({}, async (ctx) => {
  return { performance: await getPerformance(ctx.userId, ctx.params.id) };
});

export const PATCH = handler({ body: performancePatchSchema }, async (ctx) => {
  return { performance: await patchPerformance(ctx.userId, ctx.params.id, ctx.body) };
});

export const DELETE = handler({}, async (ctx) => {
  await deletePerformance(ctx.userId, ctx.params.id);
  return null;
});
