import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db";
import { users } from "@/db/schema";
import { ensureUserBootstrap } from "@/server/services/users";

export async function freshUser(prefix = "u"): Promise<string> {
  const db = getDb();
  const [row] = await db.insert(users).values({ email: `${prefix}-${randomUUID()}@example.com`, name: prefix }).returning();
  await ensureUserBootstrap(db, row.id);
  return row.id;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
