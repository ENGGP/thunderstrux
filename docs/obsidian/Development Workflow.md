---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Engineering Delivery Workflow]]", "[[Seeding and Data]]"]
sources: [package.json, docker-compose.dev.yml, scripts/run-e2e.mjs]
---

# Development Workflow

For the end-to-end engineering, review, validation, and PR sequence used by the recent remediation slices, start with [[Engineering Delivery Workflow]] and the latest [[Project Handover]]. This page holds local Docker and command details.

## Dependency security validation

See [[Dependency Automation]] for the current security baseline, Prisma override, and removal condition. Run `pnpm install --frozen-lockfile`, `pnpm prisma:generate`, `pnpm typecheck`, `pnpm test` against a disposable `_test` PostgreSQL database, `pnpm build`, and `pnpm audit --audit-level high`. The audit includes development dependencies and must exit zero. A lockfile-only update does not refresh host node_modules or a running Docker dependency volume. Preserve database volumes when updating dependencies.

## Standard Local Setup

### Safe baseline verification

Start from refreshed local `main` and create a `codex/...` branch in the primary folder as specified by [[Engineering Delivery Workflow]]. Run `node scripts/run-e2e.mjs baseline` for isolated production builds, the runner guard tests (`pnpm test:e2e:guards`, which include the readiness schema-contract check), typecheck, the full integration suite and dependency audit. Use `pnpm test:e2e` for browser/signed-webhook coverage and `pnpm ops:test` for disposable recovery rehearsal. These projects do not reuse development data or its dependency volume.

The integration launcher and SQL reset helper share one URL guard: PostgreSQL only, a single simple database name ending in `_test`, with connection parameters such as `schema=public` retained. A name such as `project_test_archive` is refused before Prisma reset or SQL. The launcher retains precedence `INTEGRATION_DATABASE_URL`, then `TEST_DATABASE_URL`, then its disposable default; the reset helper checks `DATABASE_URL`. E2E fixtures retain their stricter exact Compose URL requirement. A `_test` name is a necessary guard, not evidence that an arbitrary external database is disposable: use only explicitly run-owned test infrastructure.

The real Redis integration regression also requires `INTEGRATION_REDIS_URL` pointing to a run-owned disposable Redis service. The baseline Docker runner and manual Dependency Validation job provide it automatically. It uses a random key prefix and deletes only those keys; its TCP outage fixture interrupts only the test client's connections. Never supply development or production Redis for integration tests.

### Integration test speed (2026-10-17)

**Current state: the original, slower reset is active; the fast reset is kept but switched off.** By the maintainer's decision, the suite again empties the database with the original `TRUNCATE ... RESTART IDENTITY CASCADE` of the same table list, and gives every fixture user its own bcrypt hash of the test password, exactly as before PR #93. The fast path below is still in `tests/helpers/db-reset.ts` and `tests/helpers/test-data.ts` and runs only when the test process has `THUNDERSTRUX_FAST_TEST_RESET=1`. Nothing sets it today: the baseline runner (`node scripts/run-e2e.mjs baseline`) does not pass it, so turning it on for the baseline means adding `THUNDERSTRUX_FAST_TEST_RESET: "1"` to the runner's `environment` in `docker-compose.e2e.yml`; for a local `vitest run`, set it in the shell.

| Mode | Reset | Fixture password | Integration suite | Evidence |
| --- | --- | --- | --- | --- |
| Default (active) | `TRUNCATE` of the listed tables | One bcrypt hash per user | 582.7 s (9.7 min); whole baseline 11 min | `p216-0dca1807d327a688b829f716` on `b60c980`, 511/511 in 67 files, clean audit |
| Fast (switched off) | Children-first `DELETE` planned from the foreign keys | One shared bcrypt hash per run | 70.6 s; whole baseline 2.6 min | `p216-8aeddde4a63a314200b94b0c` on `9d3aeb9` (PR #93), 511/511 in 67 files; still passes when switched on (`test-database-safety`, `commerce-orders`, `account-closure`: 26 tests in 5 s) |

Keep in mind with the default: its `TRUNCATE` table list is maintained by hand, so a new model must be added to it (the `test-database-safety` test fails if a model is left out). The fast path reads tables from the database and needs no list. What follows describes the fast path, its upsides and its limits.

Before every integration test, `tests/helpers/db-reset.ts` empties the disposable `_test` database, and fixture users are created by `tests/helpers/test-data.ts`. Two changes made the suite about ten times faster with the same tests, the same assertions and the same code paths:

- **Children-first `DELETE` instead of `TRUNCATE`.** The reset used `TRUNCATE ... RESTART IDENTITY CASCADE`, which replaces the files of every table and index and took about 480 ms per test whether the database held ten rows or none: about 4 of the suite's 11 minutes. It now runs one `DO` block of `DELETE` statements, about 4 ms. The order is planned once per run from the database's own foreign keys, children before parents, so no `ON DELETE SET NULL` or `CASCADE` action fires and the update-guarding triggers (append-only commerce history, fixed purchase snapshots, buyer capture, account closure) never see a write. The one key cycle, an organisation's logo and cover pointing at its assets and each asset pointing back, is broken first by clearing those nullable columns. A future cycle with nothing nullable to clear falls back to the old `TRUNCATE`.
- **One shared password hash.** Every fixture user hashed `password123` with bcrypt (about 60 ms each, several users per test). The hash is now made once per run and reused. It is still a real bcrypt hash, so sign-in, password change, recovery and closure tests still go through the normal password check; signup and password changes still hash through application code.

Measured: the integration suite went from 674 s (baseline `p216-3a8e989002acb0b37bee0c5a`) to 70.6 s (baseline `p216-8aeddde4a63a314200b94b0c`), and the whole baseline from about 13.5 to 2.6 minutes, with all 511 tests in 67 files passing both times.

Upsides: each test still starts from an empty database; the reset needs no table list (a new table is covered automatically, and `test-database-safety.test.ts` still checks that every model is empty after a reset); nothing about test isolation, ordering or parallelism changed.

Downsides and limits:

- `DELETE` does not reset sequences (`RESTART IDENTITY`). Every id is a cuid string, so nothing depends on them; a future integer id would keep counting across tests.
- The reset plan is computed once per run. A test that adds a table or foreign key at run time would not be covered; none do.
- A future trigger that blocks `DELETE`, or an `UPDATE` trigger on a table in a key cycle, would make the reset fail loudly rather than silently: fix the plan or the trigger then.
- Fixture users share one stored hash, so a test comparing two fixture users' hashes would see them equal. None does; a test needing distinct hashes should hash its own.
- Large tables would make `DELETE` slower than `TRUNCATE`; test data stays tiny, so this does not arise.

Not done, and why: running test files in parallel (one database per worker) would cut the remaining 70 s further but needs per-worker Redis prefixes and fixes for shared module state, which is a bigger and riskier change; a fixture that signs browser tests in without the login form would speed up `pnpm test:e2e` but stop most browser tests exercising the real sign-in.

Do not run type generation/builds in an active production server container or integration resets in the development stack. Prefer the isolated baseline runner so generated Next/Prisma metadata remains inside its container. Record actual revision/counts/run IDs and cleanup rather than copying historical test totals. Run the runner safety suite with `pnpm test:e2e:guards`; unsafe database and occupied-port regressions require no real database or provider credentials.

Port 3100 conflicts are refused before creating an E2E run. Run IDs are `baseline-`, `browser-` or `staging-` followed by 24 hex characters, and operations rehearsals are `ops-` followed by 10 (see [[E2E and Staging Payments]]). Cleanup uses generated project IDs and ownership checks; repeat `pnpm test:e2e:cleanup -- <run-id>` to verify a completed run. Preserve interrupted payment recovery manifests and their required volumes until recovery succeeds. Never delete unrelated Docker resources or the entire `tmp` tree.

Thunderstrux has three Docker Compose contracts: the base production-like runtime, a development override, and a provider-neutral hosted contract.

Production-like local runtime:

```bash
docker compose up --build
```

or:

```bash
pnpm docker:prod
```

Use the `pnpm docker:prod` deployment helper when migrations are pending: plain base Compose startup does not run them. The development override below deploys migrations as part of startup. Back up non-disposable data first; never substitute a reset/seed for migration.

Development runtime with bind mounts, polling, and Turbopack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

or:

```bash
pnpm docker:dev
```

App:

```text
http://localhost:3080
```

PostgreSQL host port:

```text
localhost:5433 in dev override only
```

## Docker Configuration

Society images require the development object-store service and its persistent asset_data volume. Normal `pnpm docker:dev` starts it. For an existing stack, start it with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build object-store` before `pnpm docker:restart`; the recovery helper recreates only the app/dependency cache. Back up PostgreSQL before additive migration and retain object bytes alongside metadata. Never remove database, Redis or asset volumes to fix a stale app.

`docker-compose.yml` is production-like:

- app runs `pnpm start`
- app uses the built `.next-build` output from the Docker image
- app receives only app runtime environment variables
- app requires `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` at Compose interpolation time
- app receives optional `RATE_LIMIT_*` values
- app uses `restart: unless-stopped`
- app waits for the database healthcheck
- production migrations run once through the separate migration service owned by `pnpm ops:deploy`; ordinary app startup does not migrate
- database uses the named volume `postgres_data`
- database port is not exposed to the host
- Redis 7 is available as `redis` for rate limiting when `RATE_LIMIT_ENABLED=true`
- the base PostgreSQL and Redis images are digest pinned and updated only through reviewed Renovate PRs
- bounded `email-worker`, `notification-worker`, `stale-order-worker`, `compensation-worker`, `checkout-recovery-worker` and `monitor-worker` services are available through the `workers` profile (each run takes a lease and honours `pnpm ops:workers -- pause`; see [[Production Operations]], T42)

`docker-compose.dev.yml` only adds development-specific overrides:

```yaml
volumes:
  - .:/app
  - node_modules:/app/node_modules
command: pnpm dev
environment:
  NODE_ENV: development
  THUNDERSTRUX_RUNTIME_CONTAINER: "false"
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
ports:
  - "127.0.0.1:5433:5432"
```

Why:

- base Compose can validate the production runtime path without host source mounts
- dev override keeps source live-mounted into the container
- dev override explicitly clears the production runtime marker so build/runtime guard behavior is unambiguous
- `node_modules:/app/node_modules` avoids host/container dependency conflicts and uses the named Docker volume `thunderstrux_node_modules` instead of an anonymous hash volume
- DB host port exposure is available for dev tools only
- the development build uses `thunderstrux-app:dev`, so it cannot replace the production-like local tag

Validate the hosted contract with secret-safe fixture files:

```bash
pnpm docker:hosted:check -- --env-file <hosted-validation.env>
```

The hosted contract requires immutable `APP_IMAGE` (web) and `OPS_IMAGE` (migration and workers) references containing `@sha256:`. Migration and every worker must share the one ops image, and the app must not run it (T43a, [[Production Operations]]). It also requires external database and Redis endpoints, explicit resource inputs, and file-backed secret names. It deliberately defines no database or Redis service.

Database data lives in the named volume:

```yaml
postgres_data:/var/lib/postgresql/data
```

Container dependencies live in the named dev volume:

```yaml
node_modules:/app/node_modules
```

## Dev Server Configuration

Current `package.json` dev script, used by the dev override:

```json
"dev": "node scripts/assert-docker-runtime.mjs --block-next-dev && node scripts/clean-next-dev.mjs && next dev --turbopack --hostname 0.0.0.0"
```

Fallback dev script:

```json
"dev:webpack": "node scripts/assert-docker-runtime.mjs --block-next-dev && node scripts/clean-next-dev.mjs && next dev --webpack --hostname 0.0.0.0"
```

The dev override also sets:

```yaml
environment:
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
```

This is intentional.

Reason:

- Next 16 production builds use Turbopack.
- `scripts/assert-docker-runtime.mjs` warns by default, but blocks `pnpm dev` outside Docker when `DATABASE_URL` uses the Docker-only `db:5432` hostname.
- `scripts/clean-next-dev.mjs` clears `.next/dev` and `.next/types` before startup so stale dev route manifests and volatile generated type files do not survive container restarts.
- If volatile `.next` files are locked on Windows/Docker/OneDrive, `scripts/clean-next-dev.mjs` warns and continues startup instead of blocking the app container. It still never removes `.next-build`.
- Turbopack dev mode plus polling is the default route-stable configuration.
- `pnpm dev:webpack` is kept as a safe fallback when Turbopack hot reload or route manifest generation appears stuck.
- `pnpm dev:doctor` prints a read-only report for stale `.next/dev` metadata, missing dev manifests, volatile `.next` type includes, and localhost reachability.

## Build Output Separation

`next.config.ts` separates dev and production output:

```ts
distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next"
```

Why:

- `next dev` writes live route metadata under `.next/dev`.
- `pnpm build` writes production artifacts under `.next-build`.
- This prevents build verification from overwriting or confusing the running dev server's route manifest.

`.gitignore` must include both:

```gitignore
.next/
.next-build/
```

`.dockerignore` must also include `.next-build` so Docker build context does not include production build artifacts or generated Prisma client files.

## Tailwind Setup

Thunderstrux currently uses Tailwind CSS v4.

Files:

```text
tailwind.config.js
app/globals.css
```

Required CSS entrypoint:

```css
@config "../tailwind.config.js";
@import "tailwindcss";
```

Tailwind content paths:

```js
content: [
  "./app/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}"
]
```

Do not revert to the legacy `@tailwind base/components/utilities` entrypoint unless the project is intentionally downgraded to Tailwind v3.

## Common Commands

Start production-like Docker runtime:

```bash
pnpm docker:prod
```

Start Docker dev runtime:

```bash
pnpm docker:dev
```

Reset Docker volumes intentionally:

```bash
pnpm docker:reset
```

Follow app logs:

```bash
pnpm docker:logs
```

Run migrations:

```bash
docker compose exec app pnpm prisma:migrate
```

Deploy production migrations through the guarded one-shot operations workflow:

```bash
pnpm ops:deploy -- --project <project> --env-file <environment-file> --url <loopback-url> --release <git-sha>
```

Generate Prisma client:

```bash
docker compose exec app pnpm prisma:generate
```

Seed development data:

```bash
docker compose exec app pnpm seed
```

Build:

```bash
docker compose build app
```

Rebuild and recreate the app container:

```bash
pnpm docker:rebuild
```

Do not run `pnpm build` inside a live production-like `next start` container and continue using that same process as the running app. `next build` mutates `.next-build` while `next start` serves the previous build manifest, which can leave HTML and static asset serving out of sync. Runtime containers set `THUNDERSTRUX_RUNTIME_CONTAINER=true`, so `scripts/prepare-next-build.mjs` blocks this unsafe path before build metadata is changed.

If build was somehow run inside a running app container, recreate the app container afterwards:

```bash
docker compose up -d --force-recreate app
```

For production-path validation, use the isolated baseline or operations runner selected by risk; rebuilding a development stack is activation work, not a substitute for isolated test evidence.

Integration tests:

```bash
node scripts/run-e2e.mjs baseline
```

The isolated baseline builds its own app/runner and run-owned database. Inside the runner it runs, in order and stopping at the first failure: `pnpm test:e2e:guards` (every `tests/runner/*.test.mjs`, including the check that `config/schema-contract.json` names the newest migration folder), `pnpm typecheck`, `pnpm test` (integration) and `pnpm security:audit`. A migration added without updating the readiness contract fails the baseline. Do not use the development app/dependency volume for normal validation.

Current test database behavior:

- default database URL: `postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public`
- override with `INTEGRATION_DATABASE_URL` or `TEST_DATABASE_URL`
- refuses to run unless one simple database name ends in `_test`; the database must also be disposable and run-owned
- ignores accidental host `DATABASE_URL` leakage by setting `DATABASE_URL` from the resolved test URL for all child commands
- resets the test database through `pnpm prisma migrate reset --force --skip-seed`
- runs `pnpm prisma:generate` after reset so Prisma Client matches the current schema
- truncates app tables before each test
- runs Vitest sequentially with `--no-file-parallelism --maxWorkers=1 --maxConcurrency=1`

Operational healthcheck:

```bash
curl -fsS http://localhost:3080/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "thunderstrux"
}
```

Production health monitoring should alert on any non-200 response, timeout, or malformed response from `GET /api/health`.

Important:

- Run integration tests from the Docker dev stack because `docker-compose.dev.yml` bind-mounts the local `tests/` directory into the app container.
- Do not run integration tests against the normal `thunderstrux` development database.
- Vitest 4 does not support the literal Jest flag `--runInBand`; the current sequential flags are the equivalent.
- The integration suite blocks real network calls through the global test `fetch` stub and mocks Stripe at the SDK boundary where needed.

The build script runs:

```text
node scripts/prepare-next-build.mjs && pnpm prisma:generate && next build
```

This strips `.next/types/**/*.ts` / `.next/dev/types/**/*.ts` from `tsconfig.json`, regenerates Prisma Client from the current schema, then runs production type checking and build.

Recreate the development app from the current image, command, and environment configuration:

```bash
pnpm docker:restart
```

Show app logs:

```bash
docker compose logs -f app
```

Check dev environment health without changing files:

```bash
docker compose exec app pnpm dev:doctor
```

Host-facing package helpers:

```bash
pnpm docker:dev
pnpm docker:dev:clean
pnpm docker:prod
pnpm docker:reset
pnpm docker:logs
pnpm docker:up
pnpm docker:restart
pnpm docker:migrate
pnpm docker:seed
pnpm docker:db:sync
pnpm docker:build
pnpm docker:rebuild
```

`pnpm docker:up` is a detached dev-stack alias using `docker-compose.dev.yml`.

`pnpm docker:dev` is the normal fast foreground dev start.

`pnpm docker:dev:clean` is the explicit recovery path when the app container does not see current source, migrations, or generated state. It uses the dev Compose files with `--build --force-recreate` and does not wipe the Postgres volume.

`pnpm docker:build` runs `docker compose build app`. It does not execute `pnpm build` inside the running app container.

`pnpm docker:restart` and `pnpm docker:rebuild` rebuild the development image, remove only the Compose-labelled `node_modules` cache, and recreate the app. The fresh cache is populated from the rebuilt image; startup regenerates Prisma Client and applies migrations before Next listens. PostgreSQL and Redis volumes are preserved.

Apply the current schema and seed data after pulling schema changes:

```bash
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

## Normal Change Workflow

Follow [[Engineering Delivery Workflow]] for state inspection, branching, risk classification, validation, review, PR, and handover. Use the dev override for source-editing work.

1. Edit source files on the host.
2. Let Docker hot reload the app through `docker-compose.dev.yml`.
3. Refresh the browser for server-rendered pages.
4. Verify the rendered route actually reflects the source change.

## When To Recreate The Docker App

Recreate the app container when:

- Source code is correct but the browser still shows old UI.
- The dev server logs are not recompiling.
- A route appears stale after multiple refreshes.
- `.env` changed and the running app needs new runtime variables.

```bash
pnpm docker:restart
```

## When To Clear `.next`

Clear `.next` when:

- Recreating the app container does not fix stale output.
- Runtime HTML contains code that no longer exists in source.
- Old strings still appear inside `.next`.
- A valid App Router route exists in source but dev still returns 404.
- `.next/dev/server/app-paths-manifest.json` is missing a route that exists in source.

PowerShell:

```powershell
if (Test-Path -LiteralPath .next) { Remove-Item -LiteralPath .next -Recurse -Force }
pnpm docker:restart
```

Bash:

```bash
rm -rf .next
pnpm docker:restart
```

If production build artifacts may also be involved, clear both from inside Docker:

```bash
docker compose down
docker compose run --rm app sh -lc "rm -rf .next .next-build"
docker compose up --build --force-recreate -d
```

Prefer clearing volatile `.next/dev` and `.next/types` first through the normal dev startup path. `scripts/clean-next-dev.mjs` has a narrow path guard and only removes those volatile `.next` paths; it never removes `.next-build`.

If restart still does not pick up the change, then recreate containers:

```bash
docker compose down
docker compose up --build --force-recreate -d
```

## Generated Next Type Metadata

`next-env.d.ts` may switch between dev and build route type imports:

```ts
import "./.next/dev/types/routes.d.ts";
```

and:

```ts
import "./.next/types/routes.d.ts";
```

or, after a production build with the current `.next-build` dist directory:

```ts
import "./.next-build/types/routes.d.ts";
```

This depends on whether `next dev` or `next build` ran most recently. Treat it as generated framework metadata, not a product change.

With the current `.next-build` production dist directory, normal TypeScript validation should include the stable generated route types:

```json
".next-build/types/**/*.ts"
```

Do not keep `.next-build/dev/types/**/*.ts` unless that directory actually exists and is intentionally used by the current Next build output.

Do not include `.next/types/**/*.ts` or `.next/dev/types/**/*.ts` in normal TypeScript validation. Stale dev route types or `validator.ts` files can break `pnpm exec tsc --noEmit` with errors from ignored generated cache files. Current generated type includes should stay under `.next-build`.

`scripts/prepare-next-build.mjs` enforces this immediately before `pnpm build`, because Next dev may re-add `.next/types` entries while the dev server is running.

## Proxy Route Guard

Next 16 deprecates the `middleware.ts` file convention in favour of `proxy.ts`.

Thunderstrux uses:

```text
proxy.ts
```

It protects:

```text
/dashboard/:path*
/account/:path*
```

Expected behavior:

- Logged-out dashboard requests redirect to `/login`.
- The `callbackUrl` query preserves the requested dashboard path.
- Logged-in requests continue normally.
- `/events/[eventId]` is public (T15a); its checkout pages require a member sign-in.
- Member accounts requesting `/dashboard/events/[eventId]` redirect to `/`.
- Startup rejects missing or placeholder `AUTH_SECRET` values in development and production (production also needs 32 characters); only tests and builds fall back. `auth.ts` and `proxy.ts` resolve the secret through `lib/auth/secret.ts`. Generate a local value with `openssl rand -base64 32`.

## Docker Access From Codex

Docker Desktop may be healthy even if sandboxed commands report named-pipe or log-file access errors.

Symptoms:

```text
permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
unable to create a log file for docker-desktop.exe ... Access is denied
```

In this Codex environment, run Docker commands with escalated permissions when needed. Verified working checks:

```bash
docker desktop status
docker info
docker compose ps
docker compose build app
```

If the app is started outside Docker, `DATABASE_URL=db:5432` will not resolve. Use the Docker app container for normal development.

Host database connection string, available when using `docker-compose.dev.yml`:

```text
postgresql://thunderstrux:thunderstrux@localhost:5433/thunderstrux?schema=public
```

Container database connection string:

```text
postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
```

## When To Use `down -v`

Only do this when you intentionally want to wipe the local Postgres volume:

```bash
docker compose down -v
```

After `down -v`, restore:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build --force-recreate -d
docker compose exec app pnpm seed
```

## Environment Variables

Application `.env` values:

```text
DATABASE_URL=
AUTH_SECRET=
APP_PORT=3080
PORT=3000
AUTH_URL=http://localhost:3080
NEXTAUTH_URL=http://localhost:3080
NEXT_PUBLIC_APP_URL=http://localhost:3080
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
```

Required for app container startup:

```text
DATABASE_URL
AUTH_SECRET
AUTH_URL
NEXTAUTH_URL
NEXT_PUBLIC_APP_URL
```

If one is missing or empty, `docker compose up` fails before starting the app. Example diagnostic:

```text
DATABASE_URL is required
```

Optional Stripe values may be empty for non-payment local work:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET
```

Optional email delivery values may be empty for local work that does not need actual ticket emails:

```text
RESEND_API_KEY
EMAIL_FROM
```

When email values are missing, paid webhook fulfilment still succeeds and queues ticket delivery. Provider configuration errors are recorded only when the email outbox worker processes the queued job.

Email outbox worker values:

```text
EMAIL_OUTBOX_BATCH_SIZE=25
EMAIL_OUTBOX_MAX_ATTEMPTS=5
EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS=600
```

Process one bounded email outbox batch:

```text
pnpm email:outbox:process
```

The command emits structured JSON log lines, including `email_outbox.batch.processed` and `email_outbox.worker.completed`. Production should schedule it every 1 minute. If it is not scheduled, paid buyers may have issued ticket rows but no ticket delivery email.

The runtime entrypoint also accepts file-backed forms for sensitive values: append `_FILE` to `DATABASE_URL`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `RATE_LIMIT_REDIS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, or `RESEND_API_KEY`. The path must be absolute, readable, a regular non-empty file, and the direct variable must be absent.

Stale-order cleanup worker:

```text
pnpm stale-orders:process
pnpm stale-orders:process -- --dry-run
pnpm stale-orders:process -- --limit=100
```

The command emits structured JSON log lines, including `stale_orders.batch.processed` and `stale_orders.worker.completed`. Production should schedule it every 1 minute. Stale rows may temporarily remain until the worker runs; checkout-local cleanup remains authoritative before new reservations.

Compensation refund worker:

```text
pnpm compensation-refunds:process
pnpm compensation-refunds:process -- --limit=25
```

The worker processes a bounded, fenced batch and verifies Stripe identity and refund state before finalizing jobs. Production should schedule it every minute and subscribe the required refund webhooks before any real sale: new events default to `automatic_full` (2026-10-25), and the hosted refund webhooks are still gated by PAY-002 and [[E2E and Staging Payments]].

Checkout attempt recovery worker:

```text
pnpm checkout-attempts:process
pnpm checkout-attempts:process -- --limit=25
```

It replays uncertain checkout attempts with their stored Stripe request and idempotency key, then binds, fails or closes them ([[Payment Lifecycle]]). It needs `STRIPE_SECRET_KEY` only when an attempt is due. Production should schedule it every minute.

Staff security and trusted-origin values:

```text
MFA_ENFORCEMENT_MODE=off
MFA_ENCRYPTION_KEY=
LEGACY_ORGANISATION_ACCESS_MODE=allow
TRUSTED_APP_ORIGINS=
```

The dev app is loopback-only. Don't tunnel it to a public domain: `next dev` answers development endpoints to anyone who reaches it (SEC-014), and `next.config.ts` lists only `127.0.0.1` and `localhost` as dev origins. The public preview runs the production build under its own project (README, Public Preview; [[Production Operations]]). To reach one app at two addresses, keep the public one in `NEXT_PUBLIC_APP_URL`, `AUTH_URL` and `NEXTAUTH_URL` and list both in `TRUSTED_APP_ORIGINS`; sessions are per host.

**Stripe webhooks on the dev app.** Without a webhook endpoint, a dev payment completes only when the browser comes back to `/success`: the development-only fallback reads the Session from Stripe. Expiries, refunds and disputes never arrive, and unpaid orders stay pending until the stale-order worker runs, because the dev stack runs no workers.

To receive webhooks, add two test-mode endpoints in the Stripe Dashboard, each with API version `2026-09-30.endive` (see Stripe webhook endpoints and keys in [[Production Operations]]):
- **Platform payments:** `https://<public address>/api/payments/webhook`, with `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed` and `charge.dispute.created`/`updated`/`closed`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
- **Connected accounts:** `https://<public address>/api/stripe/connect/webhook`, with `account.updated` and `payout.paid`, `payout.failed`, `payout.canceled`, `payout.updated`. Its signing secret goes in `STRIPE_CONNECT_WEBHOOK_SECRET`.

Restart the app afterwards. Stripe can reach only the public address, which serves both addresses' orders because they share one database. Local development may use `off` and `allow`. Production must set an explicit MFA mode, a separately backed-up 32-byte base64 MFA key for enrollment/enforcement, exact trusted origins, and must move legacy access to `deny` after named-staff enrollment. Follow [[Production Readiness Verification 2026-09-22]] rather than changing these values ad hoc.

Rate-limit values:

```text
RATE_LIMIT_ENABLED=false
RATE_LIMIT_REDIS_URL=redis://redis:6379
RATE_LIMIT_KEY_PREFIX=thunderstrux
RATE_LIMIT_TRUSTED_PROXY_HEADER=x-forwarded-for
```

Enable `RATE_LIMIT_ENABLED=true` with the Compose Redis service when exercising signup, verification or MFA. Account-token endpoints deliberately return `503` if protection is disabled or unavailable. Configure the T02 notification encryption key and sender for signup/verification issuance, and run `notification-worker` to deliver queued messages. Isolated E2E uses its private Docker capture service. Production requires reliable Redis, notification scheduling and provider configuration.

Database `.env.db` values:

```text
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
```

Tracked examples:

```text
.env.example
.env.db.example
```

Browser-facing URLs should use `localhost`, even though the app binds to `0.0.0.0` inside Docker.

After editing `.env` or `.env.db`, recreate containers rather than only refreshing the browser:

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

For webhook-secret-only changes, recreating the app container is enough:

```bash
docker compose up -d --force-recreate app
```

Verify environment values are present without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```

To compare a Stripe CLI webhook secret without printing the full secret:

```bash
docker compose exec app node -e "const s=process.env.STRIPE_WEBHOOK_SECRET; console.log(s ? s.slice(0,12)+'... len='+s.length : 'missing')"
```

## Production Observability Runbook

Thunderstrux emits structured JSON logs to stdout/stderr. These logs are machine-parseable but remain console/log-derived only for MVP. There is no built-in metrics backend, alert transport, dashboard, or automatic paging.

Production deployment must provide:

- log aggregation for app stdout/stderr
- alert routing from selected `event`, `metricName`, and alert names
- liveness checks for `GET /api/health` and rollout/readiness checks for `GET /api/health/ready`
- scheduler entries for `pnpm email:outbox:process`, `pnpm stale-orders:process`, `pnpm compensation-refunds:process` and `pnpm checkout-attempts:process`

Alert immediately:

- any `paid_but_unfulfilled_compensation_required`
- any `email_outbox_retry_exhausted`
- any `stale_order_worker_failed`
- any `compensation_refund.worker.failed`
- any `checkout_attempt_recovery_failed` or `checkout_attempt_recovery_abandoned`
- app healthcheck non-200, timeout, or malformed response

Alert on threshold:

- `stripe_webhook_signature_failure` or `stripe_webhook_signature_failures_total` above the normal baseline in a 5-minute window
- spike in `checkout_session_creation_failure` or `checkout_session_create_failures_total`
- repeated `rate_limit.backend_unavailable`
- repeated `trusted_origin.rejected` above expected baseline

Future deployment automation should emit or route `db_migration_failed` on migration deploy failure. Until that is implemented, migration failures must be watched through deployment logs and exit codes.

Operational event names are documented in [[API Reference]].
