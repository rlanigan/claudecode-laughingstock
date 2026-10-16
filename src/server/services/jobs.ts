// Background jobs (§17): Postgres-backed queue drained by /api/cron/jobs and tried once via after().
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/server/db";
import { analyticsEvents, jobs, sessions, verificationTokens } from "@/db/schema";
import { logger } from "@/server/logger";

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

type JobHandler = (payload: Record<string, unknown>, userId: string | null) => Promise<void>;
const handlers: Record<string, JobHandler> = {};

export function registerJob(type: string, handler: JobHandler) {
  handlers[type] = handler;
}

export async function enqueue(db: DbOrTx, userId: string | null, type: string, payload: Record<string, unknown>, opts: { maxAttempts?: number } = {}) {
  const [row] = await db.insert(jobs).values({ userId, type, payload, maxAttempts: opts.maxAttempts ?? 5 }).returning({ id: jobs.id });
  return row.id;
}

export async function runJob(id: string): Promise<"succeeded" | "failed" | "dead" | "skipped"> {
  const db = getDb();
  const claimed = await db
    .update(jobs)
    .set({ status: "running", lockedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["queued", "failed"])))
    .returning();
  if (!claimed.length) return "skipped";
  const job = claimed[0];
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(job.payload as Record<string, unknown>, job.userId);
    await db.update(jobs).set({ status: "succeeded", lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
    return "succeeded";
  } catch (err) {
    const attempts = job.attempts + 1;
    const dead = attempts >= job.maxAttempts;
    const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
    await db
      .update(jobs)
      .set({ status: dead ? "dead" : "failed", attempts, lastError: String((err as Error)?.message ?? err).slice(0, 2000), lockedAt: null, runAfter: new Date(Date.now() + backoff * 60_000), updatedAt: new Date() })
      .where(eq(jobs.id, id));
    logger[dead ? "error" : "warn"]({ job_id: id, type: job.type, attempts, dead, err: (err as Error)?.message });
    return dead ? "dead" : "failed";
  }
}

/** Claims up to `limit` ready jobs (FOR UPDATE SKIP LOCKED) and runs them. */
export async function processJobs(limit = 25) {
  const db = getDb();
  // Reclaim jobs locked for more than 5 minutes.
  await db.update(jobs).set({ status: "queued", lockedAt: null }).where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - 5 * 60_000))));
  const rows = await db.execute(sql`
    select id from jobs where status in ('queued','failed') and run_after <= now()
    order by run_after asc limit ${limit} for update skip locked`);
  let succeeded = 0;
  let failed = 0;
  for (const r of rows as unknown as { id: string }[]) {
    const result = await runJob(r.id);
    if (result === "succeeded") succeeded++;
    else if (result !== "skipped") failed++;
  }
  return { processed: (rows as unknown as unknown[]).length, succeeded, failed };
}

export async function dailyMaintenance() {
  const db = getDb();
  await db.delete(sessions).where(lt(sessions.expires, new Date()));
  await db.delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));
  await db.delete(analyticsEvents).where(lt(analyticsEvents.occurredAt, new Date(Date.now() - 400 * 86400_000)));
  await db.delete(jobs).where(and(eq(jobs.status, "succeeded"), lt(jobs.updatedAt, new Date(Date.now() - 14 * 86400_000))));
  await db.delete(jobs).where(and(eq(jobs.status, "dead"), lt(jobs.updatedAt, new Date(Date.now() - 90 * 86400_000))));
  return { ok: true };
}
