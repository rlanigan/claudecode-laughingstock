// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { archivedQuery, boardCreateSchema } from "@/lib/validation";
import { createBoard, listBoards } from "@/server/services/boards";

export const GET = handler({ query: archivedQuery }, async (ctx) => {
  return { items: await listBoards(ctx.userId, ctx.query.archived === "true") };
});

export const POST = handler({ body: boardCreateSchema }, async (ctx) => {
  return created({ board: await createBoard(ctx.userId, ctx.body.name) });
});
