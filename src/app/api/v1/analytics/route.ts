import { z } from "zod";
import { handler } from "@/server/http";
import { getDb } from "@/server/db";
import { track } from "@/server/services/events";

const schema = z.object({ name: z.string().min(1).max(60), properties: z.record(z.string(), z.unknown()).default({}) });

export const POST = handler({ body: schema, rateLimit: { key: "analytics", limit: 300, windowSeconds: 60 } }, async (ctx) => {
  // Keep only scalar properties; never store free text longer than a label.
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.body.properties)) {
    if (typeof v === "number" || typeof v === "boolean") props[k] = v;
    else if (typeof v === "string" && v.length <= 40) props[k] = v;
  }
  await track(getDb(), ctx.userId, ctx.body.name, props);
  return null;
});
