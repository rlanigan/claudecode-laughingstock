// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { versionsActionSchema } from "@/lib/validation";
import { versionAction } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({ body: versionsActionSchema }, async (ctx) => {
  const r = await versionAction(ctx.userId, num(ctx.params.number), ctx.body.mode, ctx.body.from_label);
  return r.created ? created(r) : r;
});
