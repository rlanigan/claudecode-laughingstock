// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { promoteSchema } from "@/lib/validation";
import { promoteNode } from "@/server/services/workshop";

export const POST = handler({ body: promoteSchema }, async (ctx) => {
  return created({ card: await promoteNode(ctx.userId, ctx.params.id, ctx.body.session_id) });
});
