// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { meSettingsSchema } from "@/lib/validation";
import { updateSettings } from "@/server/services/users";

export const PATCH = handler({ body: meSettingsSchema }, async (ctx) => {
  return { settings: await updateSettings(ctx.userId, ctx.body) };
});
