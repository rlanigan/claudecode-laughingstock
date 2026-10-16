// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { tidyBoard } from "@/server/services/boards";

export const POST = handler({}, async (ctx) => {
  return tidyBoard(ctx.userId, ctx.params.id);
});
