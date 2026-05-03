# Current Handover

Read this first, then [[Thunderstrux Codebase Map]].

## Current State

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies with:

- Auth.js credentials auth.
- Two account roles: `member` and `organisation`.
- Member profile onboarding, organisation search/join/leave, public organisation details, public event browsing, ticket checkout, and `/tickets`.
- Organisation accounts that own exactly one organisation through `Organisation.accountUserId`.
- Organisation dashboard at `/dashboard`.
- Organisation management routes at `/dashboard/events`, `/dashboard/orders`, and `/dashboard/settings`.
- Organisation event analytics at `/dashboard/events/[eventId]`.
- Organisation accounts redirect from public event pages to organiser event analytics.
- Legacy `/dashboard/[orgSlug]/*` routes kept as redirects.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Stripe Checkout with 30-minute ticket reservations and webhook-only fulfilment.
- Non-production `/success?session_id=...` fallback exists only to reconcile paid sessions when local webhook forwarding is absent.
- Stripe Connect Express onboarding with explicit lifecycle states.

For MVP, organisation committee members may share the one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

## Latest Migrations

Implemented migrations:

- `20260428000000_account_role_groundwork`: role-based member/organisation account model.
- `20260429000000_ticket_reservations`: checkout ticket reservations.
- `20260429010000_order_expired_status`: adds the `expired` order status.

Recent feature areas:

- Role-based auth and slugless dashboard routes.
- Member profile onboarding, organisation search/join, and `/tickets`.
- Organisation dashboard, events, orders, settings, and Stripe Connect.
- Organisation-safe event viewing and analytics.
- Event-scoped organiser orders.
- Ticket reservation model and reservation-aware checkout/webhook reconciliation.
- App-level stale pending order cleanup across order, ticket, checkout, public event, dashboard, and analytics reads.
- Pending orders are internal system state and hidden from normal member/organiser UX.
- Stripe webhooks verify signatures from raw request bodies and ignore signed non-checkout events with `200`.
- Lightweight smoke tests in `scripts/smoke-test.mjs`.
- Functional/integration tests with Vitest, isolated `thunderstrux_test` database reset, mocked auth, and mocked Stripe/network boundaries.

## Current Routes

Public:

- `/`
- `/events/[eventId]`
- `/organisations/[orgSlug]`
- `/login`
- `/signup`
- `/success`
- `/cancel`

Member:

- `/dashboard`
- `/dashboard/organisations`
- `/tickets`

Organisation:

- `/dashboard`
- `/dashboard/create`
- `/dashboard/events`
- `/dashboard/events/[eventId]`
- `/dashboard/events/new`
- `/dashboard/events/[eventId]/edit`
- `/dashboard/orders`
- `/dashboard/settings`

Legacy compatibility:

- `/dashboard/[orgSlug]`
- `/dashboard/[orgSlug]/events`
- `/dashboard/[orgSlug]/events/new`
- `/dashboard/[orgSlug]/events/[eventId]/edit`
- `/dashboard/[orgSlug]/orders`
- `/dashboard/[orgSlug]/settings`

The legacy routes redirect for the owning organisation account and return not found when ownership does not match.

## Seeded Logins

All seeded accounts use:

```text
password123
```

Organisation accounts:

- `engineering.org@example.com`
- `arts.org@example.com`
- `robotics.org@example.com`
- `payments.lab@example.com`
- `empty.org@example.com`

Member/test accounts:

- `user1@example.com`
- `user2@example.com`
- `admin@example.com`
- `event.manager@example.com`
- `finance@example.com`
- `content@example.com`
- `member@example.com`
- `empty@example.com`
- `outsider@example.com`

Best smoke-test accounts:

- `engineering.org@example.com`: organisation dashboard with events/orders.
- `payments.lab@example.com`: Stripe `PLATFORM_NOT_READY` settings state.
- `user2@example.com`: member account with seeded ticket/order history.
- `outsider@example.com`: member account with no joined organisations.

## Runtime And Database

Use Docker for normal development. The app container resolves Postgres at `db:5432`; running Next directly on the Windows host with the Docker `.env` will not resolve `db`.

Docker modes:

- `docker-compose.yml`: production-like runtime, built image, `pnpm start`, migration deploy entrypoint, no database host port.
- `docker-compose.dev.yml`: development override, bind-mounted source, `pnpm dev`, polling, database host port `5433`.

Environment files:

- `.env`: app runtime values such as `DATABASE_URL`, Auth.js URLs/secrets, and Stripe keys.
- `.env.db`: Postgres container values only.
- `.env.example` and `.env.db.example` are the tracked templates.
- base Compose fails fast if required app env values are missing or empty.
- dev Compose explicitly sets `THUNDERSTRUX_RUNTIME_CONTAINER=false`.

Database:

```text
PostgreSQL 16
Database: thunderstrux
User: thunderstrux
Password: thunderstrux
Container host: db
Host machine: localhost
Host port: 5433 in dev override only
Container port: 5432
Docker volume: thunderstrux_postgres_data
Container path: /var/lib/postgresql/data
```

Useful commands:

```bash
pnpm docker:dev
docker compose exec app pnpm dev:doctor
docker compose exec app pnpm dev:webpack
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm prisma:migrate:deploy
docker compose exec app pnpm seed
pnpm docker:logs
docker compose exec app pnpm test:smoke
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration
docker compose build app
pnpm docker:rebuild
```

Latest verification:

- `docker compose build app` passed with the multi-stage Dockerfile.
- `docker compose up -d` starts the production-like container and runs `pnpm prisma:migrate:deploy` before `pnpm start`.
- `docker compose exec app pnpm prisma:migrate` applied through `20260429010000_order_expired_status`.
- `docker compose exec app pnpm test:smoke` passed.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration` passed with 9 files and 27 tests.
- Previous build verification passed before the runtime-build guard was added. Current safe build validation is `docker compose build app`.
- Required-env startup validation passed: `docker compose --env-file <temp> up app` failed before app startup when `DATABASE_URL` was omitted, output contained `DATABASE_URL is required`, and the temporary env file was deleted.
- Latest smoke/build verification covers organiser public-event redirect, member organiser-event redirect, organiser analytics rendering, event-scoped orders, member organisation leave, public organisation details, organisation checkout denial, stale pending order expiry, cleanup idempotency, paid/failed cleanup safety, and expired reservation availability behavior.
- A Stripe webhook 400 investigation found a mismatched `STRIPE_WEBHOOK_SECRET` between the app container and active Stripe CLI listener. Recreate the app container after changing `.env`; `docker compose restart app` is not enough.
- A CSS outage investigation found that running `pnpm build` inside a live production-like `next start` container can desynchronise `.next-build` static assets from the running server manifest. Recreate the app container after any in-container production build validation.
- Runtime app containers set `THUNDERSTRUX_RUNTIME_CONTAINER=true`; `scripts/prepare-next-build.mjs` now blocks `pnpm build` in that context. Use `pnpm docker:build` or `pnpm docker:rebuild`.
- `proxy.ts` now rejects missing or placeholder production `AUTH_SECRET` values instead of silently using `dev-secret`.
- `scripts/doctor-dev.mjs` now recommends `pnpm docker:build`, not the unsafe in-container build command.

## Next Route Stability

Keep these route stability fixes:

- `scripts/clean-next-dev.mjs`
- `scripts/prepare-next-build.mjs`
- `next.config.ts` uses `.next-build` for production and `.next` for dev.
- `.next-build/` ignored in `.gitignore` and `.dockerignore`.
- `app/(dashboard)/dashboard/events/layout.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`

`tsconfig.json` should include generated production build types under `.next-build`, not stale `.next/dev` route types. Stale `.next/dev/types/routes.d.ts` can break production image builds. Use `docker compose build app` for safe build validation.

`pnpm build` runs `scripts/prepare-next-build.mjs` and `pnpm prisma:generate` before `next build`, so build verification strips stale `.next` dev type includes and regenerates Prisma Client from the current schema.

`pnpm dev` blocks accidental host `next dev` when the project `.env` points at `db:5432`. The underlying guard script only warns by default, so it does not block Docker startup or build scripts.

`scripts/clean-next-dev.mjs` warns and continues if Windows/Docker file locking prevents deleting `.next/dev`; it still never removes `.next-build`.

Use `pnpm dev:webpack` inside Docker if Turbopack hot reload or route manifest generation becomes unstable.

Use `pnpm dev:doctor` for a read-only check of stale `.next/dev` metadata, missing dev manifests, stale `tsconfig` includes, and localhost reachability.

Current generated include entries:

```json
".next-build/types/**/*.ts",
".next-build/dev/types/**/*.ts"
```

## Integration Test State

Current integration test runner:

```text
scripts/run-integration-tests.mjs
```

Current suites:

```text
tests/integration/auth-access.test.ts
tests/integration/organisation-tenancy.test.ts
tests/integration/event-lifecycle.test.ts
tests/integration/checkout-reservations.test.ts
tests/integration/webhook-reconciliation.test.ts
tests/integration/pending-cleanup.test.ts
tests/integration/member-features.test.ts
tests/integration/orders-api.test.ts
tests/integration/public-safe-pages.test.ts
```

Important rules:

- Integration tests must run against a database whose name ends with `_test`.
- The default isolated database is `thunderstrux_test`.
- The runner drops and recreates the test database, deploys migrations, then starts Vitest.
- Tests are sequential; Vitest uses `--no-file-parallelism --maxWorkers=1 --maxConcurrency=1`.
- `tests/helpers/db-reset.ts` truncates application tables before each test.
- The test setup mocks `@/auth`, blocks real `fetch` network calls, and uses Stripe SDK mocks where practical.
- Webhook reconciliation tests call the shared reconciliation helper with mocked Checkout Sessions instead of relying on live Stripe CLI delivery.
- Current future improvement: add stricter test hardening for `console.error`, unhandled rejections, invariant helpers, and lightweight Prisma query-count checks.

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs.
- Keep `Organisation` as the tenant/payment/event/order owner.
- Member `OrganisationMember` rows must not grant organisation management access.
- Organisation accounts must be redirected away from buyer checkout surfaces and cannot create checkout sessions.
- Member accounts must not access organiser analytics.
- Payment fulfilment must remain webhook-driven.
- The `/success` fallback must remain non-production only and must call the same checkout reconciliation helper as the webhook.
- Ticket reservations are temporary soft holds; production paid tickets are issued only by Stripe Checkout webhook reconciliation.
- Stale cleanup may expire pending orders and active reservations, but must not fulfil orders, decrement inventory, or alter paid/failed orders.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
