// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { bitPatchSchema } from "@/lib/validation";
import { deleteBit, getBit, patchBit } from "@/server/services/bits";
import { z } from "zod";

export const GET = handler({}, async (ctx) => {
  return getBit(ctx.userId, ctx.params.id);
});

export const PATCH = handler({ body: bitPatchSchema }, async (ctx) => {
  return patchBit(ctx.userId, ctx.params.id, ctx.body);
});

export const DELETE = handler(
  { query: z.object({ force: z.enum(["true", "false"]).default("false") }) },
  async (ctx) => {
    await deleteBit(ctx.userId, ctx.params.id, ctx.query.force === "true");
    return null;
  },
);
