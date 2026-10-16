// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { paginationQuery, sessionCreateSchema } from "@/lib/validation";
import { createSession, listSessions } from "@/server/services/workshop";

export const GET = handler({ query: paginationQuery }, async (ctx) => {
  return listSessions(ctx.userId, ctx.query.limit);
});

export const POST = handler({ body: sessionCreateSchema }, async (ctx) => {
  return created({ session: await createSession(ctx.userId, ctx.body) });
});
