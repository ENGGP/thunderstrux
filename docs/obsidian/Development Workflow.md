---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Engineering Delivery Workflow]]", "[[Environment Variables]]", "[[Troubleshooting]]", "[[Seeding and Data]]", "[[Production Operations]]", "[[E2E and Staging Payments]]"]
sources: [package.json, docker-compose.yml, docker-compose.dev.yml, docker/Dockerfile, next.config.ts, tsconfig.json, scripts/recreate-dev-app.mjs, scripts/prepare-next-build.mjs, scripts/run-integration-tests.mjs, scripts/run-e2e.mjs]
---

# Development Workflow

**Owns:** local development: the Docker dev stack, startup, recreate and clean rules, generated Next files, Tailwind, running tests locally, and every `package.json` script.
**Read when:** setting up or recovering the local stack, choosing a command, or running tests on your machine.
**Not here:** branching, risk classes and what validation a change needs ([[Engineering Delivery Workflow]]); every env var ([[Environment Variables]]); symptoms and fixes ([[Troubleshooting]]); demo data ([[Seeding and Data]]); hosted deploys, workers in production, logs and alerts ([[Production Operations]]); the E2E and staging runners in depth ([[E2E and Staging Payments]]); dependency policy ([[Dependency Automation]]).

## Code

| Concern | Where |
| --- | --- |
| Production-like runtime, workers, Postgres, Redis | `docker-compose.yml` |
| Dev override (source mount, dev image, object store) | `docker-compose.dev.yml` |
| Image stages `deps`, `builder`, `development`, `ops`, `web` | `docker/Dockerfile` |
| Local S3-compatible image store | `docker/Dockerfile.assets` (service `object-store`) |
| `_FILE` secret loading in release images | `docker/entrypoint.sh` |
| Dev start guards | `scripts/assert-docker-runtime.mjs`, `scripts/clean-next-dev.mjs` |
| Read-only dev report | `scripts/doctor-dev.mjs` (checks in `scripts/dev-doctor-guards.mjs`) |
| Recreate the dev app | `scripts/recreate-dev-app.mjs` |
| Build pre-step | `scripts/prepare-next-build.mjs` |
| Integration runner and its URL guard | `scripts/run-integration-tests.mjs`, `scripts/integration-test-guards.mjs` |
| Isolated baseline, browser and staging runner | `scripts/run-e2e.mjs`, `scripts/e2e-guards.mjs`, `docker-compose.e2e.yml` |
| Docs checker | `scripts/check-docs.mjs` |
| Dev/build output split, dev origins, security headers | `next.config.ts` |

## Prerequisites

- Docker Desktop with Compose. Development runs in containers; the host needs no `node_modules`.
- Node and pnpm on the host only for host-side helpers (`pnpm docker:*`, `pnpm docs:check`, `node scripts/run-e2e.mjs`). The pnpm version is pinned in `docker/Dockerfile`.
- `.env` copied from `.env.example` and `.env.db` from `.env.db.example`. Set a real `AUTH_SECRET` (`openssl rand -base64 32`) and a `NOTIFICATION_ENCRYPTION_KEY` (32 bytes, base64), or readiness answers 503. Values: [[Environment Variables]].

## Compose files

| File | Role |
| --- | --- |
| `docker-compose.yml` | Base. Project name `thunderstrux`. `app` (web image, `node server.js`), `migration` (ops image, `prisma migrate deploy`, no profile), six workers under profile `workers`, `db` (Postgres, volume `postgres_data`), `redis` (volume `redis_data`). |
| `docker-compose.dev.yml` | Dev override on top of the base. |
| `docker-compose.e2e.yml` | Isolated baseline, browser and staging runs (`scripts/run-e2e.mjs`). Test service `tests`. |
| `docker-compose.operations.yml` | Disposable operations rehearsal (`pnpm ops:test`, `--rehearsal`). |
| `docker-compose.hardened.yml` | Resource and security limits used by `pnpm ops:deploy`. |
| `docker-compose.hosted.yml`, `docker-compose.assets.hosted.yml`, `docker-compose.schedules.yml` | Hosted contract, hosted image storage, every-minute worker loops. |
| `deploy/droplet/docker-compose.droplet.yml` | Pilot host overlay (Caddy, backups). |

Hosted, hardened, schedules and Droplet files: [[Production Operations]].

## Dev stack

Start it with `pnpm docker:dev` (foreground, `--build`) or `pnpm docker:up` (detached, no build). Both use `-f docker-compose.yml -f docker-compose.dev.yml`. Plain `docker compose up` uses the base file only and starts the production web image instead.

| Service | In the dev stack |
| --- | --- |
| `app` | Image `${DEV_APP_IMAGE:-thunderstrux-app:dev}`, Dockerfile target `development` (dependencies only; source is the bind mount `.:/app`). `node_modules` is the named volume `node_modules` (`thunderstrux_node_modules`). Command `sh -c "pnpm prisma:generate && pnpm prisma:migrate:deploy && pnpm dev"`. `NODE_ENV=development`, `THUNDERSTRUX_RUNTIME_CONTAINER=false`, `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING` on. Image storage points at `object-store`. |
| `db` | Postgres, also published on `127.0.0.1:5433`. |
| `redis` | Not published. Used only when `RATE_LIMIT_ENABLED=true`. |
| `object-store` | Local S3-compatible store (`docker/Dockerfile.assets`), bucket `thunderstrux-assets`, volume `asset_data`. Not published. |
| `migration` | Not started: `docker-compose.dev.yml` puts it in profile `tools`, because the app command migrates itself. `pnpm ops:*` runs it by name. |
| workers | Not started. The dev stack runs no workers; run one batch by hand (Commands). |

**Ports and origin.** The app is published on `127.0.0.1:${APP_PORT:-3000}` to container port `${PORT:-3000}`; `.env.example` sets `APP_PORT=3080`. Cookie-authenticated writes accept only `NEXT_PUBLIC_APP_URL` and `TRUSTED_APP_ORIGINS` (`lib/security/request-guard.ts`). The maintained local `.env` sets every app URL to `http://127.0.0.1:3080`, so that is the dev origin: a write sent from `http://localhost:3080` is refused 403 "Untrusted request origin" (`trusted_origin.rejected`), and sessions are per host. `.env.example` still says `localhost:3080`; use whichever host your `.env` names.

**Database URLs.** In containers: `postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public`. From the host (dev stack only): the same on `localhost:5433`.

**Loopback only.** Don't tunnel the dev app to a public domain: `next dev` answers its development endpoints to anyone who reaches it (SEC-014), and `next.config.ts` `allowedDevOrigins` lists only `127.0.0.1` and `localhost`. The public preview runs the production build ([[Production Operations]]).

**Env in dev.** Compose passes the variables listed in `docker-compose.yml`; `next dev` also reads the bind-mounted `.env` for any variable Compose left unset (so `PLATFORM_SUPPORT_EMAIL` reaches the dev app but not the base web image). Release images contain no `.env` (`.dockerignore`). The `development` target has no entrypoint, so `_FILE` secrets work only in release images.

## Startup

`pnpm dev` (the dev command's last step) runs:

1. `scripts/assert-docker-runtime.mjs --block-next-dev`: if `DATABASE_URL` (or `.env`) uses `@db:5432/` and the process is not in Docker (no `/.dockerenv`), it exits 1. `THUNDERSTRUX_ALLOW_HOST_DEV=1` overrides it for one-off host debugging with a `localhost` URL. Without `--block-next-dev` it only warns.
2. `scripts/clean-next-dev.mjs`: deletes `.next/dev` and `.next/types` so stale route manifests and generated types never survive a restart. It refuses any other path and never touches `.next-build`. On `EPERM`, `EBUSY` or `EACCES` (Windows/OneDrive locks) it warns and lets startup continue.
3. `next dev --turbopack --hostname 0.0.0.0`. `pnpm dev:webpack` is the same with webpack, a fallback when Turbopack hot reload or route manifests misbehave.

Polling is on because bind-mount file events don't cross into the container on Windows. Polling can still miss newly added files; restart the app then.

## Build output and generated types

- `next.config.ts`: `distDir` is `.next` in dev and `.next-build` when `NODE_ENV=production`, so a build never clobbers the running dev server's manifests. Production builds use `output: "standalone"`; the `web` image copies `.next-build/standalone` and `.next-build/static` and runs `node server.js` with no pnpm.
- `pnpm build` = `scripts/prepare-next-build.mjs`, `pnpm prisma:generate`, `next build`. The pre-step:
  - throws when `NODE_ENV=production` and `THUNDERSTRUX_RUNTIME_CONTAINER=true` (a runtime container must be rebuilt, not built in);
  - **rewrites the tracked `tsconfig.json`**: removes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` from `include` and adds `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next-build/types/**/*.ts`. It leaves `.next-build/dev/types/**/*.ts`.
- `next dev` and `next typegen` (first half of `pnpm typecheck`) add the `.next` includes back, so the committed `tsconfig.json` currently carries all of `.next-build/types`, `.next/types`, `.next/dev/types` and `.next-build/dev/types`, and a host-side build shows a `tsconfig.json` diff. Don't commit that churn with unrelated work. `pnpm dev:doctor` reports the volatile includes as present.
- `next-env.d.ts` is gitignored and rewritten by whichever of dev or build ran last.

## Proxy guard

`proxy.ts` matches `/dashboard/:path*` and `/account/:path*` only. With no live session identity it redirects to `/login?callbackUrl=<path and query>`. Everything else (including the public `/events/[eventId]`) relies on page and route guards; members get a concealed 404 on management pages (`lib/auth/page-access.ts`). The session secret comes from `lib/auth/secret.ts`. Details: [[Authentication and Dashboard Access]].

## Tailwind

- Tailwind v4 through PostCSS (`postcss.config.mjs`: `@tailwindcss/postcss`, `autoprefixer`).
- Entry `app/globals.css` starts with `@config "../tailwind.config.js";` then `@import "tailwindcss";`. Don't go back to v3 `@tailwind` directives.
- `tailwind.config.js` content globs cover `app/` and `components/`. Semantic tokens (`--ts-*`, `bg-paper`, `text-ink`) live in `app/globals.css` ([[UI Architecture Rules]]).
- The global `a` rule only removes the underline; a colour there would beat `text-*` utilities on links.

## Recreate and clean

| Situation | Do |
| --- | --- |
| Source correct but the page is stale, no recompiles, or a new file isn't picked up | Hard refresh, then `pnpm docker:restart`. |
| `.env` changed | `pnpm docker:restart` (recreating the container reloads env; a plain restart does not). |
| Dependencies changed, or `@redis/client` / Prisma client missing | `pnpm docker:rebuild` (same script). |
| Container started from the base file, or doesn't see current source | `pnpm docker:dev:clean` (dev files, `--build --force-recreate`; keeps volumes). |
| Still stale after a restart, or a route in source returns 404 | Delete `.next` (PowerShell `Remove-Item -LiteralPath .next -Recurse -Force`, Bash `rm -rf .next`), then `pnpm docker:restart`. |

`scripts/recreate-dev-app.mjs` (`pnpm docker:restart` / `pnpm docker:rebuild`): builds the dev `app` image, removes the app container and every other service mounting the same volume (the dev `stale-order-worker`, or Docker refuses the removal; DEF-063), deletes the `node_modules` volume only after checking its Compose labels (project and volume name), runs `up -d app` (which also starts `db` and `redis`, not `object-store`), waits up to 60 s for `@redis/client` and `@prisma/client` to import, then starts those services again. Startup regenerates Prisma Client and deploys migrations. Postgres, Redis and asset volumes are kept.

**`down -v` destroys data.** `pnpm docker:reset` (`docker compose down -v`, base file only) deletes `postgres_data` and `redis_data`. Running `down -v` by hand with both dev files also deletes `node_modules` and `asset_data`; image bytes can't be rebuilt from a seed. Never use it to fix a stale app. Recovery: [[Seeding and Data]].

## Tests locally

- **Evidence of record:** `node scripts/run-e2e.mjs baseline`. It builds its own app, database, Redis, object store and mail capture under a run-owned project (`baseline-<24 hex>`), then in the `tests` container runs `pnpm test:e2e:guards && pnpm typecheck && pnpm test && pnpm security:audit`, stopping at the first failure. A migration added without updating `config/schema-contract.json` fails the guards. It never touches dev data or the dev dependency volume.
- **Browser and staging:** `pnpm test:e2e` and `pnpm test:payments:staging`. Port 3100 must be free. Clean up with `pnpm test:e2e:cleanup -- <run-id>`. Run IDs, manifests and recovery: [[E2E and Staging Payments]].
- **Operations rehearsal:** `pnpm ops:test` (`ops-` run IDs; [[Production Operations]]).
- **Focused integration run in the dev app container:** needs only `DATABASE_URL` on a `_test` database and `NODE_ENV=test`; `tests/setup/integration.setup.ts` pins every other switch (DEF-042). Migrate the test database first:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -e DATABASE_URL="postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public" -e NODE_ENV=test app sh -c "pnpm prisma migrate reset --force --skip-seed && pnpm vitest run tests/integration/ticket-check-in.test.ts"
```

  The dev database `thunderstrux` is never a test target. `pnpm test:integration` in the dev container runs the whole suite, but `tests/integration/redis-runtime.test.ts` fails there without a run-owned `INTEGRATION_REDIS_URL`; never point it at dev Redis.
- **`scripts/run-integration-tests.mjs`** (`pnpm test:integration`): URL from `INTEGRATION_DATABASE_URL`, then `TEST_DATABASE_URL`, then `postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public`. `scripts/integration-test-guards.mjs` refuses anything but a PostgreSQL URL with one database name matching `[a-z0-9_-]+_test` before any reset, and never echoes the URL. Children get `DATABASE_URL` (the resolved URL), `NODE_ENV=test` and `THUNDERSTRUX_INTEGRATION_TEST=1` (read by nothing). Steps: `prisma migrate reset --force --skip-seed`, `prisma:generate`, then `vitest run tests/integration --no-file-parallelism --maxWorkers=1 --maxConcurrency=1`. `tests/helpers/db-reset.ts` re-checks `DATABASE_URL` with the same guard. A `_test` name is necessary, not proof a database is disposable: use run-owned databases only.
- **Integration setup** (`tests/setup/integration.setup.ts`): Prisma Client copies `.env` into unset variables, so before each test it stubs Stripe, email, notification and MFA keys with placeholders, sets `MFA_ENFORCEMENT_MODE=off` and `LEGACY_ORGANISATION_ACCESS_MODE=deny`, unsets rate limiting, trusted origins, Auth.js URLs, the alert webhook and worker/outbox tuning, and replaces `fetch` with a stub that throws. Tests change a switch with `vi.stubEnv`. Fixtures: `tests/helpers/mfa.ts` (staff MFA enrolment), `tests/helpers/guest.ts` (guest checkout session).
- **Runner guards:** `pnpm test:e2e:guards` runs `tests/runner/*.test.mjs` with no database or provider credentials.

### Integration test speed

Each test starts from an empty `_test` database (`tests/helpers/db-reset.ts`). Two modes:

| Mode | Reset | Fixture password hash |
| --- | --- | --- |
| Default (on) | One `TRUNCATE ... RESTART IDENTITY CASCADE` of a hand-kept table list | `password123` hashed per user (`tests/helpers/test-data.ts`) |
| Fast (`THUNDERSTRUX_FAST_TEST_RESET=1`; nothing sets it) | Children-first `DELETE`, ordered once per run from the database's foreign keys, so no `ON DELETE` action or update-guarding trigger fires; the organisation logo/cover ↔ asset cycle is broken by nulling those columns; a cycle with nothing nullable falls back to `TRUNCATE` | One shared bcrypt hash per run |

- The default's table list is maintained by hand: a new model must be added, or `tests/integration/test-database-safety.test.ts` fails. The fast path reads tables from the database.
- Fast-path limits: no sequence reset (ids are cuids); the plan is computed once per run; a trigger that blocks `DELETE` makes the reset fail loudly; fixture users share one hash.
- To use it in the baseline, add `THUNDERSTRUX_FAST_TEST_RESET: "1"` to the `tests` service environment in `docker-compose.e2e.yml`; for a focused run, pass it with `-e`.

## Stripe on the dev app

- The dev stack runs `stale-order-worker` every minute (`docker-compose.dev.yml`, dev image, live source). Its reconciliation sweep (PAY-024) confirms a test payment within about two minutes even with no webhook, for tickets, memberships and merchandise alike, and expires unpaid checkouts after asking Stripe. The other workers don't run in dev.
- For webhooks (instant confirmation, refunds, disputes, Connect updates), start the opt-in listener: `docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile stripe up -d stripe-listener`. Copy the `whsec_` it logs (`docker compose -f docker-compose.yml -f docker-compose.dev.yml logs stripe-listener`) into both `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` in `.env`, then `pnpm docker:restart`. Test-mode Dashboard endpoints work too. Endpoints, event lists and API version: [[Stripe Payments and Connect]].
- Live keys are refused outside `NODE_ENV=production` (`lib/stripe/index.ts`).

## Commands

Run app-side commands in the dev container: `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm <script>`.

| Script | Runs | Use |
| --- | --- | --- |
| `pnpm dev` | `scripts/assert-docker-runtime.mjs --block-next-dev`, `scripts/clean-next-dev.mjs`, `next dev --turbopack` | Dev container command. Not on the host. |
| `pnpm dev:webpack` | Same guards, `next dev --webpack` | Fallback dev server. |
| `pnpm dev:doctor` | `scripts/doctor-dev.mjs` | Read-only report, in the container: `.next` caches, `proxy.ts`, tsconfig includes, port 3000, whether startup migrates, `prisma migrate status`, MFA key and rate limiting. |
| `pnpm build` | `scripts/prepare-next-build.mjs`, `prisma:generate`, `next build` | Production build; rewrites `tsconfig.json`. Refused in a runtime container. |
| `pnpm start` | `next start --hostname 0.0.0.0` | Not used by any image (the web image runs `node server.js`). |
| `pnpm typecheck` | `next typegen && tsc --noEmit` | Type check. |
| `pnpm docs:check` | `scripts/check-docs.mjs` | Docs links, note size, frontmatter sources, coverage. Host or container. |
| `pnpm test` | `pnpm test:integration` | Integration suite. |
| `pnpm test:integration` | `scripts/run-integration-tests.mjs` | Inside the baseline runner, or a container with a `_test` database. |
| `pnpm test:e2e` | `scripts/run-e2e.mjs` (mode `test`, run ID `browser-…`) | Isolated browser campaign. |
| `pnpm test:e2e:cleanup` | `scripts/run-e2e.mjs cleanup <run-id>` | Remove a finished or interrupted run's resources. |
| `pnpm test:payments:staging` | `scripts/run-e2e.mjs staging` | Stripe test-mode staging run, interactive terminal. |
| `pnpm test:e2e:guards` | `node --test tests/runner/*.test.mjs` | Runner and readiness-contract guards. |
| `pnpm security:audit` | `pnpm audit --audit-level high` | Dependency audit (includes dev dependencies; must exit 0). |
| `pnpm notifications:process` | `scripts/process-notifications.mjs` | One bounded batch of account/guest notifications. |
| `pnpm email:outbox:process` | `scripts/process-email-outbox.mjs` | One batch of ticket emails. |
| `pnpm stale-orders:process` | `scripts/process-stale-orders.mjs` (`--dry-run`, `--limit=`) | Expire stale unpaid orders. |
| `pnpm compensation-refunds:process` | `scripts/process-compensation-refunds.mjs` (`--limit=`) | Compensation refunds. |
| `pnpm checkout-attempts:process` | `scripts/process-checkout-attempts.mjs` (`--limit=`) | Recover uncertain checkout attempts. |
| `pnpm db:integrity:audit` | `scripts/audit-db-integrity.mjs` | Read-only integrity audit ([[Database and Multi Tenancy]]). |
| `pnpm db:organisation-drift:repair` | `scripts/repair-organisation-drift.mjs` | Dry run; `--apply` only after a verified backup. |
| `pnpm assets:maintain` | `scripts/maintain-assets.mjs` (`--apply`, `--objects`, `--integrity`, `--cursor`) | Asset cleanup, dry run by default ([[Society Profiles and Assets]]). |
| `pnpm ops:deploy` | `scripts/operations.mjs deploy` | Single-host deploy; needs `--project`, `--env-file`, `--url` ([[Production Operations]]). |
| `pnpm ops:backup` | `scripts/operations.mjs backup` | Needs `--project`, `--env-file`. |
| `pnpm ops:restore` | `scripts/operations.mjs restore` | Needs `--project`, `--env-file`, `--archive`, `--target-database`. |
| `pnpm ops:smoke` | `scripts/operations.mjs smoke --url <loopback>` | GETs `/api/health`, `/api/health/ready` and `/`; fails on any status outside 200–399. |
| `pnpm ops:workers` | `scripts/workers.mjs` | `status`, `pause <job\|all> --reason=…`, `resume <job\|all>`. |
| `pnpm ops:droplet` | `scripts/droplet.mjs` | `deploy`, `rollback`, `status` on the pilot host. |
| `pnpm ops:droplet:rehearse` | `scripts/rehearse-droplet.mjs` | Local rehearsal of the Droplet deploy. |
| `pnpm ops:test` | `tests/runner/operations.test.mjs`, then `scripts/run-operations-tests.mjs` | Disposable operations rehearsal. |
| `pnpm seed` | `prisma db seed` (`node prisma/seed.mjs`) | Demo data ([[Seeding and Data]]). |
| `pnpm prisma:seed` | `node prisma/seed.mjs` | Same seed without the Prisma wrapper. |
| `pnpm seed:demo` | `node prisma/demo-data.mjs` | Rich demo societies on top of the seed; dev database only ([[Seeding and Data#Rich demo data]]). |
| `pnpm prisma:migrate` | `prisma migrate dev` | Create a migration from schema changes. Interactive; may offer to reset the database on drift. Dev only. |
| `pnpm prisma:migrate:deploy` | `prisma migrate deploy` | Apply pending migrations (dev startup does this). |
| `pnpm prisma:generate` | `prisma generate` | Regenerate Prisma Client. |
| `pnpm docker:dev` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` | Normal start, foreground. |
| `pnpm docker:up` | Same files, `up -d` | Detached start, no build. |
| `pnpm docker:dev:clean` | Same files, `up --build --force-recreate` | Recreate every dev container; keeps volumes. |
| `pnpm docker:restart` | `scripts/recreate-dev-app.mjs` | Rebuild and recreate the dev app with a fresh dependency volume. |
| `pnpm docker:rebuild` | `scripts/recreate-dev-app.mjs` | Same as `docker:restart`. |
| `pnpm docker:build` | `docker compose build app` | Builds the base (web) image only. |
| `pnpm docker:logs` | `docker compose logs -f app` | Follow app logs. |
| `pnpm docker:migrate` | `docker compose exec app pnpm prisma:migrate` | `prisma migrate dev` in the running app. |
| `pnpm docker:seed` | `docker compose exec app pnpm seed` | Seed in the running app. |
| `pnpm docker:db:sync` | `docker:migrate`, `prisma:generate`, `seed` in the running app | After pulling schema changes on a dev database. |
| `pnpm docker:reset` | `docker compose down -v` | **Destructive:** deletes the database and Redis volumes. |
| `pnpm docker:hosted:check` | `scripts/check-hosted-compose.mjs --env-file <file>` | Validate the hosted Compose contract. |

Other helpers: `scripts/release-pair.mjs`, `scripts/rehearse-assets.mjs`, `scripts/rehearse-upgrade.mjs`, `scripts/every-minute.mjs`, `scripts/mail-capture.mjs`, `scripts/seed-notification-e2e.mjs`, `scripts/seed-operations-verification.mjs`, `scripts/staging-driver.mjs`, `scripts/staging-payments.mjs`, `scripts/verify-restored-database.mjs`, `scripts/fence-restored-identity.sql`, `scripts/operations-guards.mjs`, `scripts/container-config.mjs`, `scripts/e2e-ci-summary.mjs`, `scripts/process-operations-monitor.mjs`: see [[Production Operations]] and [[E2E and Staging Payments]].

## Traps

- `docker compose up -d --force-recreate app` without the dev files swaps the dev app for the production web container (no source mount, `.next-build`, `NODE_ENV=production`). Always pass `-f docker-compose.yml -f docker-compose.dev.yml`, or use the `pnpm docker:*` helpers.
- `docker compose exec app …` without the dev files still reaches the running dev app (same project), but `run`, `up` and `build` do not.
- Signup, verification and reset tokens, account security changes, guest email links, image uploads, staff invites and handover answer 503 while `RATE_LIMIT_ENABLED` is not `true` (callers pass `required: true` to `enforceRateLimit` in `lib/security/rate-limit.ts`). Staff MFA enrolment and enforcement also need it (`lib/security/staff-mfa.ts`). Turn it on with the Compose Redis to test them.
- Signup and verification also need `NOTIFICATION_ENCRYPTION_KEY` and a run of `pnpm notifications:process` to deliver anything.
- Don't run `pnpm build` in a runtime container; rebuild the image.
- A lockfile-only update does not refresh the dev `node_modules` volume: run `pnpm docker:rebuild`.

## Failure and recovery

Symptoms and fixes: [[Troubleshooting]]. Lost demo data: [[Seeding and Data]].

## Related

[[Engineering Delivery Workflow]] · [[Environment Variables]] · [[Troubleshooting]] · [[Seeding and Data]] · [[Production Operations]] · [[E2E and Staging Payments]] · [[Dependency Automation]]
