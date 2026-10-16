// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { insertPositions } from "@/server/services/sets";
import { z } from "zod";

export const GET = handler({ query: z.object({ bit_id: z.string().uuid() }) }, async (ctx) => {
  return insertPositions(ctx.userId, ctx.params.id, ctx.query.bit_id);
});
