// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { deleteMeSchema, meNameSchema } from "@/lib/validation";
import { deleteAccount, getMe, updateName } from "@/server/services/users";

export const GET = handler({}, async (ctx) => {
  return getMe(ctx.userId);
});

export const PATCH = handler({ body: meNameSchema }, async (ctx) => {
  return { user: await updateName(ctx.userId, ctx.body.name) };
});

export const DELETE = handler({ body: deleteMeSchema }, async (ctx) => {
  await deleteAccount(ctx.userId);
  return null;
});
