// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { nodeDeleteImpact } from "@/server/services/workshop";

export const GET = handler({}, async (ctx) => {
  return nodeDeleteImpact(ctx.userId, ctx.params.id);
});
