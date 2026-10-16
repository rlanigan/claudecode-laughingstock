// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { clusterPatchSchema } from "@/lib/validation";
import { deleteCluster, patchCluster } from "@/server/services/boards";

export const PATCH = handler({ body: clusterPatchSchema }, async (ctx) => {
  return { cluster: await patchCluster(ctx.userId, ctx.params.id, ctx.body) };
});

export const DELETE = handler({}, async (ctx) => {
  await deleteCluster(ctx.userId, ctx.params.id);
  return null;
});
