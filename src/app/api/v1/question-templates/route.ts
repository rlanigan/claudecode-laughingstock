// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { templateCreateSchema } from "@/lib/validation";
import { createTemplate, listTemplates } from "@/server/services/workshop";
import { z } from "zod";

export const GET = handler(
  { query: z.object({ include_archived: z.enum(["true", "false"]).default("false") }) },
  async (ctx) => {
    return listTemplates(ctx.userId, ctx.query.include_archived === "true");
  },
);

export const POST = handler({ body: templateCreateSchema }, async (ctx) => {
  return created({ template: await createTemplate(ctx.userId, ctx.body) });
});
