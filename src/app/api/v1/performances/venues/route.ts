// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { recentVenues } from "@/server/services/performances";

export const GET = handler({}, async (ctx) => {
  return { items: await recentVenues(ctx.userId) };
});
