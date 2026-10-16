import { loadEnv } from "../scripts/load-env";

loadEnv();
process.env.TEST_DATABASE_URL ??= "postgres://cards:cards@localhost:5432/cards_test";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
