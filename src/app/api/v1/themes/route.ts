// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { created, handler } from "@/server/http";
import { themeCreateSchema } from "@/lib/validation";
import { createTheme, listThemes } from "@/server/services/tags";
import { z } from "zod";

export const GET = handler({ query: z.object({ q: z.string().optional() }) }, async (ctx) => {
  return listThemes(ctx.userId, ctx.query.q);
});

export const POST = handler({ body: themeCreateSchema }, async (ctx) => {
  const r = await createTheme(ctx.userId, ctx.body);
  return r.created ? created({ theme: r.theme }) : { theme: r.theme };
});
