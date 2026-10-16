// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { anchorSchema } from "@/lib/validation";
import { createAnchor } from "@/server/services/sets";

export const POST = handler({ body: anchorSchema }, async (ctx) => {
  return created(await createAnchor(ctx.userId, ctx.params.id, ctx.body.name));
});
