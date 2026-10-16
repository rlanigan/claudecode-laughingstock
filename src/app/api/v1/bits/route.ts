// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { archivedQuery, bitCreateSchema } from "@/lib/validation";
import { createBit, listBits } from "@/server/services/bits";

export const GET = handler({ query: archivedQuery }, async (ctx) => {
  return {
    items: await listBits(ctx.userId, {
      archived: ctx.query.archived === "true",
      notInSet: ctx.query.not_in_set,
    }),
  };
});

export const POST = handler({ body: bitCreateSchema }, async (ctx) => {
  return created(await createBit(ctx.userId, ctx.body));
});
