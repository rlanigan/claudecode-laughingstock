import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

declare global {
  // eslint-disable-next-line no-var
  var __ccwDb: { db: Db; client: ReturnType<typeof postgres> } | undefined;
}

function connectionUrl(): string {
  if (process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function create() {
  const url = connectionUrl();
  const client = postgres(url, {
    max: process.env.NODE_ENV === "test" ? 4 : 10,
    prepare: !/pooler|pgbouncer/i.test(url),
    onnotice: () => {},
    idle_timeout: 30,
  });
  return { db: drizzle(client, { schema, casing: undefined }), client };
}

/** Lazily created, process-wide Drizzle client (survives Next.js hot reloads). */
export function getDb(): Db {
  if (!globalThis.__ccwDb) globalThis.__ccwDb = create();
  return globalThis.__ccwDb.db;
}

export async function closeDb() {
  if (globalThis.__ccwDb) {
    await globalThis.__ccwDb.client.end();
    globalThis.__ccwDb = undefined;
  }
}

export { schema };
