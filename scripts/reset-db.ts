/**
 * Drops and recreates the public schema, then re-applies migrations.
 * Usage: tsx scripts/reset-db.ts          (DATABASE_URL_UNPOOLED / DATABASE_URL)
 *        tsx scripts/reset-db.ts --test   (TEST_DATABASE_URL)
 */
import postgres from "postgres";
import { loadEnv } from "./load-env";
import { runMigrations } from "./migrate";

loadEnv();

export async function resetDatabase(url: string, opts: { quiet?: boolean } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema public cascade; create schema public;");
  } finally {
    await sql.end();
  }
  await runMigrations(url, opts);
}

if (process.argv[1] && process.argv[1].endsWith("reset-db.ts")) {
  const test = process.argv.includes("--test");
  const url = test
    ? (process.env.TEST_DATABASE_URL ?? "postgres://cards:cards@localhost:5432/cards_test")
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  resetDatabase(url).then(
    () => console.log("database reset"),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
