// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { autocompleteSubjects } from "@/server/services/tags";
import { z } from "zod";

export const GET = handler({ query: z.object({ q: z.string().default("") }) }, async (ctx) => {
  return { items: await autocompleteSubjects(ctx.userId, ctx.query.q) };
});
