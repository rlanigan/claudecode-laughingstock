// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { clusterBitSchema } from "@/lib/validation";
import { bitFromCluster } from "@/server/services/boards";

export const POST = handler({ body: clusterBitSchema }, async (ctx) => {
  return created({ bit: await bitFromCluster(ctx.userId, ctx.params.id, ctx.body.name) });
});
