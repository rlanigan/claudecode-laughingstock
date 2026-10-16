// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { sessionPatchSchema } from "@/lib/validation";
import { getSession, patchSession } from "@/server/services/workshop";

export const GET = handler({}, async (ctx) => {
  return { session: await getSession(ctx.userId, ctx.params.id) };
});

export const PATCH = handler({ body: sessionPatchSchema }, async (ctx) => {
  return { session: await patchSession(ctx.userId, ctx.params.id, ctx.body) };
});
