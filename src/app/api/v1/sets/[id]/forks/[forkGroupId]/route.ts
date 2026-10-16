// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { getFork } from "@/server/services/sets";

export const GET = handler({}, async (ctx) => {
  return getFork(ctx.userId, ctx.params.id, ctx.params.forkGroupId);
});
