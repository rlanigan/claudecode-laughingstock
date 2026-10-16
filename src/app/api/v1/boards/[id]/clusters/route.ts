// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { clusterCreateSchema } from "@/lib/validation";
import { createCluster } from "@/server/services/boards";

export const POST = handler({ body: clusterCreateSchema }, async (ctx) => {
  return created({ cluster: await createCluster(ctx.userId, ctx.params.id, ctx.body.item_ids) });
});
