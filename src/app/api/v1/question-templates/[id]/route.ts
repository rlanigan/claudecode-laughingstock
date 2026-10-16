// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { templatePatchSchema } from "@/lib/validation";
import { patchTemplate } from "@/server/services/workshop";

export const PATCH = handler({ body: templatePatchSchema }, async (ctx) => {
  return { template: await patchTemplate(ctx.userId, ctx.params.id, ctx.body) };
});
