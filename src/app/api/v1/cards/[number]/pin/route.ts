// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { pinSchema } from "@/lib/validation";
import { pinVersion } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const POST = handler({ body: pinSchema }, async (ctx) => {
  return pinVersion(ctx.userId, num(ctx.params.number), ctx.body.version_label);
});
