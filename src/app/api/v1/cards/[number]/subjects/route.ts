// Generated from HANDOFF.md §10 — thin delegation to the service layer.
import { handler } from "@/server/http";
import { subjectsPutSchema } from "@/lib/validation";
import { setCardSubjects } from "@/server/services/cards";

const num = (s: string) => Number(s);

export const PUT = handler({ body: subjectsPutSchema }, async (ctx) => {
  return { subjects: await setCardSubjects(ctx.userId, num(ctx.params.number), ctx.body.names) };
});
