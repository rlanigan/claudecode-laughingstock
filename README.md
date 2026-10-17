# Cards — Comedy Card Writer

A personal comedy-writing tool: capture funny thoughts as cards, refine and workshop them into jokes, assemble bits and sets, and keep the whole lineage automatically. Built from `HANDOFF.md`.

## Run it locally (macOS)

You need Node.js 22+, pnpm and PostgreSQL 16. With Homebrew:

```bash
brew install node postgresql@16
brew services start postgresql@16
npm install -g pnpm
```

Create the database once (the app expects user `cards`, password `cards`, database `cards`):

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createuser -s cards
psql postgres -c "ALTER USER cards PASSWORD 'cards';"
createdb -O cards cards
```

(If you prefer Docker, `docker compose up -d db` starts the same database.)

Set up and start the app:

```bash
pnpm install
cp -n .env.example .env.local
sed -i '' '/^AUTH_SECRET=/d;/^CRON_SECRET=/d' .env.local
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
pnpm db:migrate      # creates the schema
pnpm db:seed         # demo data for demo@example.com (optional)
pnpm dev             # http://localhost:3000
```

**Signing in:** there is no email provider configured locally, so the magic link is printed in the terminal running `pnpm dev`. Enter `demo@example.com` (or any address — `ALLOWED_EMAILS` is empty in development), then copy the printed link into the browser.

Make the window narrower than 768 px to see the phone layout. The small D1/P1 badges in the header are screen IDs from the handoff; set `NEXT_PUBLIC_SHOW_SCREEN_IDS=false` to hide them.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server / production build / serve |
| `pnpm db:migrate` | Apply `drizzle/*.sql` migrations (`DATABASE_URL_UNPOOLED`, then `DATABASE_URL`) |
| `pnpm db:seed` | Load the §16.4 demo library for `SEED_USER_EMAIL` |
| `pnpm test` | Unit, integration and API tests (needs a `cards_test` database: `createdb -O cards cards_test`) |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | TypeScript, ESLint, Prettier |

## Layout

```
drizzle/            SQL migrations (hand-maintained; src/db/schema.ts mirrors them)
scripts/            migrate, reset-db, seed
src/app/            Next.js routes — one page.tsx per URL, api/v1 route handlers
src/components/     UI by area: shell, ui, capture, cards, lineage, search
src/domain/         pure business rules (versioning, status, tags, sets, heuristics) — no I/O
src/server/         db, auth, http wrapper, repos, services
src/lib/            API client, Zod validation, offline draft/outbox, hooks
tests/              unit, integration, api, e2e
```

## Status

Done: auth, capture (phone + desktop, offline outbox), inbox/review, card detail with parts/tags/themes, versioning and the lineage graph with diffs, boards index, tags & themes, search, settings, performed log, and the complete API for boards, workshop, bits, sets, anchors/forks/variants and performances (covered by integration tests).

Not built yet: the Board canvas (D2), Workshop (D5/P5), Bit editor (D3) and Set screens (D6/D7/P6).
