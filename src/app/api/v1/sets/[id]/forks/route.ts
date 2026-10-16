// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { forkSchema } from "@/lib/validation";
import { createFork } from "@/server/services/sets";

export const POST = handler({ body: forkSchema }, async (ctx) => {
  return created(await createFork(ctx.userId, ctx.params.id, ctx.body));
});
