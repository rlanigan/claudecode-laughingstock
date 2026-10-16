// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { seedSchema } from "@/lib/validation";
import { seedCard } from "@/server/services/workshop";

export const POST = handler({ body: seedSchema }, async (ctx) => {
  return created(await seedCard(ctx.userId, ctx.body));
});
