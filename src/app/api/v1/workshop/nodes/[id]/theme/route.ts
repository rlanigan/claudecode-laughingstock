// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { nodeThemeSchema } from "@/lib/validation";
import { saveNodeTheme } from "@/server/services/workshop";

export const POST = handler({ body: nodeThemeSchema }, async (ctx) => {
  const r = await saveNodeTheme(ctx.userId, ctx.params.id, ctx.body.name);
  return r.created ? created({ theme: r.theme }) : { theme: r.theme };
});
