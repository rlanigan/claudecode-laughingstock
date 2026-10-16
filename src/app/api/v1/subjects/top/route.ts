// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { topSubjects } from "@/server/services/tags";

export const GET = handler({}, async (ctx) => {
  return topSubjects(ctx.userId);
});
