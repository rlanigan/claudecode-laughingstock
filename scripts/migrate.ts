/**
 * Forward-only SQL migration runner. Applies every drizzle/*.sql file in name order that has
 * not been recorded in `__migrations`, each inside its own transaction.
 *
 * Usage: tsx scripts/migrate.ts            (uses DATABASE_URL_UNPOOLED, then DATABASE_URL)
 *        tsx scripts/migrate.ts --test     (uses TEST_DATABASE_URL)
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();

export async function runMigrations(url: string, opts: { quiet?: boolean } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists __migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.resolve(process.cwd(), "drizzle");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied = new Set((await sql`select name from __migrations`).map((r) => r.name as string));
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = fs.readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into __migrations (name) values (${file})`;
      });
      if (!opts.quiet) console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const test = process.argv.includes("--test");
  const url = test
    ? (process.env.TEST_DATABASE_URL ?? "postgres://cards:cards@localhost:5432/cards_test")
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url).then(
    () => console.log("migrations up to date"),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
