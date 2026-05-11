# Current Handover

Read this first, then [[Thunderstrux Codebase Map]].

Latest dated handover: [[Handover 2026-05-03 Ticket Operations and Email Delivery]].

## Current State

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies with:

- Auth.js credentials auth.
- Two account roles: `member` and `organisation`.
- Member profile onboarding, organisation search/join/leave, public organisation details, public event browsing, ticket checkout, and `/tickets`.
- Organisation accounts that own exactly one organisation through `Organisation.accountUserId`.
- Organisation dashboard at `/dashboard`.
- Organisation management routes at `/dashboard/events`, `/dashboard/orders`, and `/dashboard/settings`.
- Organisation event analytics at `/dashboard/events/[eventId]`.
- Organisation order detail and safe order actions.
- Organisation ticket visibility and manual check-in for event attendees.
- Organisation accounts redirect from public event pages to organiser event analytics.
- Legacy `/dashboard/[orgSlug]/*` routes kept as redirects.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Stripe Checkout with 30-minute ticket reservations and webhook-only fulfilment.
- Ticket delivery email after successful webhook fulfilment, with manual resend.
- Non-production `/success?session_id=...` fallback exists only to reconcile paid sessions when local webhook forwarding is absent.
- Stripe Connect Express onboarding with explicit lifecycle states.

For MVP, organisation committee members may share the one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

## Latest Migrations

Implemented migrations:

- `20260428000000_account_role_groundwork`: role-based member/organisation account model.
- `20260429000000_ticket_reservations`: checkout ticket reservations.
- `20260429010000_order_expired_status`: adds the `expired` order status.
- `20260503020000_manual_order_refund_flag`: adds local-only manual refund tracking on orders.
- `20260503030000_ticket_check_in_state`: adds ticket check-in timestamp state.
- `20260503040000_ticket_email_delivery_tracking`: adds ticket delivery email tracking on orders.

Recent feature areas:

- Role-based auth and slugless dashboard routes.
- Member profile onboarding, organisation search/join, and `/tickets`.
- Organisation dashboard, events, orders, settings, and Stripe Connect.
- Organisation-safe event viewing and analytics.
- Event-scoped organiser orders.
- Organiser order detail at `/dashboard/orders/[orderId]`.
- Organiser manual refund flag, Stripe session copy/view support, and paid-order ticket email resend.
- Event ticket list at `/dashboard/events/[eventId]/tickets`.
- Ticket check-in/check-out state through `Ticket.checkedInAt`, with invalid transition prevention.
- Automatic paid-order ticket email delivery after webhook fulfilment and ticket issuance.
- Ticket reservation model and reservation-aware checkout/webhook reconciliation.
- App-level stale pending order cleanup across order, ticket, checkout, public event, dashboard, and analytics reads.
- Pending orders are internal system state and hidden from normal member/organiser UX.
- Stripe webhooks verify signatures from raw request bodies and ignore signed non-checkout events with `200`.
- Lightweight smoke tests in `scripts/smoke-test.mjs`.
- Functional/integration tests with Vitest, isolated `thunderstrux_test` database reset, mocked auth, and mocked Stripe/network boundaries.
- TypeScript validation ignores volatile `.next` dev-generated route types and relies on `.next-build/types` for stable generated route typing.

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
- `/dashboard/events/[eventId]/tickets`
- `/dashboard/events/new`
- `/dashboard/events/[eventId]/edit`
- `/dashboard/orders`
- `/dashboard/orders/[orderId]`
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

- `.env`: app runtime values such as `DATABASE_URL`, Auth.js URLs/secrets, Stripe keys, and optional email delivery keys.
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
pnpm docker:dev:clean
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
- `docker compose exec app pnpm prisma:migrate` applied through `20260503040000_ticket_email_delivery_tracking`.
- `pnpm exec tsc --noEmit` passed after removing volatile `.next` generated type includes from normal TypeScript validation.
- `docker compose exec app pnpm test:smoke` passed.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration` passed with 10 files and 51 tests.
- Previous build verification passed before the runtime-build guard was added. Current safe build validation is `docker compose build app`.
- Required-env startup validation passed: `docker compose --env-file <temp> up app` failed before app startup when `DATABASE_URL` was omitted, output contained `DATABASE_URL is required`, and the temporary env file was deleted.
- Latest smoke/build verification covers organiser public-event redirect, member organiser-event redirect, organiser analytics rendering, event-scoped orders, member organisation leave, public organisation details, organisation checkout denial, stale pending order expiry, cleanup idempotency, paid/failed cleanup safety, and expired reservation availability behavior.
- A Stripe webhook 400 investigation found a mismatched `STRIPE_WEBHOOK_SECRET` between the app container and active Stripe CLI listener. Recreate the app container after changing `.env`; `docker compose restart app` is not enough.
- A CSS outage investigation found that running `pnpm build` inside a live production-like `next start` container can desynchronise `.next-build` static assets from the running server manifest. Recreate the app container after any in-container production build validation.
- Runtime app containers set `THUNDERSTRUX_RUNTIME_CONTAINER=true`; `scripts/prepare-next-build.mjs` now blocks `pnpm build` in that context. Use `pnpm docker:build` or `pnpm docker:rebuild`.
- `proxy.ts` now rejects missing or placeholder production `AUTH_SECRET` values instead of silently using `dev-secret`.
- `scripts/doctor-dev.mjs` reports volatile `.next` type includes and recommends relying on `.next-build` route types.

## Next Route Stability

Keep these route stability fixes:

- `scripts/clean-next-dev.mjs`
- `scripts/prepare-next-build.mjs`
- `next.config.ts` uses `.next-build` for production and `.next` for dev.
- `.next-build/` ignored in `.gitignore` and `.dockerignore`.
- `app/(dashboard)/dashboard/events/layout.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`

`tsconfig.json` should include generated production build types under `.next-build`, not stale `.next` or `.next/dev` route types. Stale `.next/dev/types/validator.ts` and route type files can break `pnpm exec tsc --noEmit` even when application code is valid. Use `docker compose build app` for safe build validation.

`pnpm build` runs `scripts/prepare-next-build.mjs` and `pnpm prisma:generate` before `next build`, so build verification strips stale `.next` dev type includes and regenerates Prisma Client from the current schema.

`pnpm dev` blocks accidental host `next dev` when the project `.env` points at `db:5432`. The underlying guard script only warns by default, so it does not block Docker startup or build scripts.

`scripts/clean-next-dev.mjs` clears volatile `.next/dev` and `.next/types` before dev startup. It warns and continues if Windows/Docker/OneDrive file locking prevents deletion; it still never removes `.next-build`.

Use `pnpm dev:webpack` inside Docker if Turbopack hot reload or route manifest generation becomes unstable.

Use `pnpm dev:doctor` for a read-only check of stale `.next/dev` metadata, missing dev manifests, volatile `.next` type includes in `tsconfig`, and localhost reachability.

Current generated include entries:

```json
".next-build/types/**/*.ts"
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
tests/integration/ticket-check-in.test.ts
```

Important rules:

- Integration tests must run against a database whose name contains `_test`.
- The default isolated database is `thunderstrux_test`.
- The runner sets `DATABASE_URL` from the resolved test URL so host `DATABASE_URL` values do not leak into child commands.
- The runner resets the test database with `pnpm prisma migrate reset --force --skip-seed`.
- The runner runs `pnpm prisma:generate` after reset so Prisma Client matches the current schema.
- The runner then starts Vitest.
- Tests are sequential; Vitest uses `--no-file-parallelism --maxWorkers=1 --maxConcurrency=1`.
- `tests/helpers/db-reset.ts` truncates application tables before each test.
- The test setup mocks `@/auth`, blocks real `fetch` network calls, and uses Stripe SDK mocks where practical.
- Webhook reconciliation tests call the shared reconciliation helper with mocked Checkout Sessions instead of relying on live Stripe CLI delivery.
- Current future improvement: add stricter test hardening for `console.error`, unhandled rejections, invariant helpers, and lightweight Prisma query-count checks.

## Current Next Work

Recommended next implementation branch:

- Order ownership consistency: order access should be authorised through `Order.event.organisationId` as the source of truth, matching the ticket ownership model. `Order.organisationId` should remain stored for relations/reporting, but event ownership should be used for organiser order list/detail/action access checks.

Other pending branches:

- Ticket list pagination for `/dashboard/events/[eventId]/tickets` and `GET /api/events/[eventId]/tickets`.
- API error standardisation and small UI state consistency improvements.
- Move demo event auto-creation out of public read paths before production hardening.
- Future staff/RBAC, audit logs, QR scanning, and asynchronous email outbox.

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs.
- Keep `Organisation` as the tenant/payment/event/order owner.
- Member `OrganisationMember` rows must not grant organisation management access.
- Organisation accounts must be redirected away from buyer checkout surfaces and cannot create checkout sessions.
- Member accounts must not access organiser analytics.
- Payment fulfilment must remain webhook-driven.
- The `/success` fallback must remain non-production only and must call the same checkout reconciliation helper as the webhook.
- Ticket reservations are temporary soft holds; production paid tickets are issued only by Stripe Checkout webhook reconciliation.
- Ticket delivery email must only run after paid webhook fulfilment and ticket issuance.
- Ticket delivery email failure must update `Order.ticketEmailLastError` and must not roll back order payment, ticket issuance, reservation confirmation, or inventory decrement.
- Duplicate webhook delivery must not send automatic ticket email again after `Order.ticketEmailSentAt` is set.
- Manual ticket email resend must be organisation-scoped and paid-order only.
- Ticket check-in and check-out may only mutate `Ticket.checkedInAt`; they must not alter orders, Stripe state, ticket ownership, ticket type snapshots, or payment state.
- Stale cleanup may expire pending orders and active reservations, but must not fulfil orders, decrement inventory, or alter paid/failed orders.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
