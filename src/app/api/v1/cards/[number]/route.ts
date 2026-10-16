// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { editCardSchema } from "@/lib/validation";
import { deleteCardForever, editCard, getCard } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const GET = handler({}, async (ctx) => {
  return { card: await getCard(ctx.userId, num(ctx.params.number)) };
});

export const PATCH = handler({ body: editCardSchema }, async (ctx) => {
  return editCard(ctx.userId, num(ctx.params.number), ctx.body);
});

export const DELETE = handler({}, async (ctx) => {
  await deleteCardForever(ctx.userId, num(ctx.params.number));
  return null;
});
