// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { boardPatchSchema } from "@/lib/validation";
import { deleteBoard, getBoard, patchBoard } from "@/server/services/boards";

export const GET = handler({}, async (ctx) => {
  return getBoard(ctx.userId, ctx.params.id);
});

export const PATCH = handler({ body: boardPatchSchema }, async (ctx) => {
  return { board: await patchBoard(ctx.userId, ctx.params.id, ctx.body) };
});

export const DELETE = handler({}, async (ctx) => {
  await deleteBoard(ctx.userId, ctx.params.id);
  return null;
});
