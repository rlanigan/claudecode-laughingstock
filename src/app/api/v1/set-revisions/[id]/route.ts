// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { revisionQuery } from "@/lib/validation";
import { discardRevision, getRevision } from "@/server/services/sets";

export const GET = handler({ query: revisionQuery }, async (ctx) => {
  return getRevision(ctx.userId, ctx.params.id, ctx.query.include === "script");
});

export const DELETE = handler({}, async (ctx) => {
  await discardRevision(ctx.userId, ctx.params.id);
  return null;
});
