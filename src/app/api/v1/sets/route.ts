// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { archivedQuery, setCreateSchema } from "@/lib/validation";
import { createSet, listSets } from "@/server/services/sets";

export const GET = handler({ query: archivedQuery }, async (ctx) => {
  return { items: await listSets(ctx.userId, ctx.query.archived === "true") };
});

export const POST = handler({ body: setCreateSchema }, async (ctx) => {
  return created(await createSet(ctx.userId, ctx.body));
});
