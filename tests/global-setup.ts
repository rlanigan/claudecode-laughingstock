import { loadEnv } from "../scripts/load-env";
import { resetDatabase } from "../scripts/reset-db";

export default async function globalSetup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://cards:cards@localhost:5432/cards_test";
  process.env.TEST_DATABASE_URL = url;
  await resetDatabase(url, { quiet: true });
}
