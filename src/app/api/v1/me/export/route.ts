// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { buildExport } from "@/server/services/export";

export const GET = handler({ rateLimit: { key: "export", limit: 5, windowSeconds: 3600 } }, async (ctx) => {
  const { bytes } = await buildExport(ctx.userId);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="cards-export-${date}.zip"`,
    },
  });
});
