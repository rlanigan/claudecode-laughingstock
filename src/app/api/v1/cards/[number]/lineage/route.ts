// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { getLineage } from "@/server/services/lineage";

const num = (s: string) => Number(s);

export const GET = handler({}, async (ctx) => {
  return getLineage(ctx.userId, num(ctx.params.number));
});
