---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Thunderstrux Codebase Map]]", "[[Frontend and Backend Flow]]", "[[Route Security Inventory]]", "[[Database and Multi Tenancy]]", "[[Production Operations]]"]
sources: [package.json, docker/Dockerfile, docker/entrypoint.sh, docker-compose.yml, docker-compose.dev.yml, docker-compose.schedules.yml, next.config.ts, proxy.ts, auth.ts, config/schema-contract.json]
---

# Architecture Overview

**Owns:** the stack, the runtime shape, the service boundary, the product account model, and the **Invariants** table (what must always hold, where it is enforced, which test guards it).
**Read when:** starting work on Thunderstrux, deciding where new code belongs, or checking that a change keeps a system-wide rule.
**Not here:** directory-by-directory layout ([[Thunderstrux Codebase Map]]); the page map ([[Frontend and Backend Flow]]); per-route guards ([[Route Security Inventory]]); schema and tenant boundary ([[Database and Multi Tenancy]]); deploy, workers and alerts ([[Production Operations]]); env vars ([[Environment Variables]]).

## Code

| Concern | Where |
| --- | --- |
| Dependencies and pinned versions | `package.json` (exact pins; Node in `engines`, pnpm in `packageManager`), `pnpm-lock.yaml` |
| Images | `docker/Dockerfile` targets `web` (`node server.js`), `ops` (migrations, workers), `development` |
| Container entrypoint | `docker/entrypoint.sh` |
| Compose stacks | `docker-compose.yml` (production-like base), `docker-compose.dev.yml` (dev overlay), `docker-compose.schedules.yml`, `docker-compose.hosted.yml`, `docker-compose.operations.yml` |
| Next config, security headers, redirects | `next.config.ts` |
| Auth.js | `auth.ts`, `lib/auth/credentials.ts`, `lib/auth/secret.ts` |
| Edge redirect for `/dashboard` and `/account` | `proxy.ts` |
| Schema contract | `config/schema-contract.json` (`requiredMigration`), read by `lib/ops/readiness.ts` |

## Stack

Next.js App Router with React and TypeScript; Prisma on PostgreSQL 16; Auth.js (NextAuth) credentials provider with bcryptjs hashes; Stripe Checkout and Stripe Connect Express; zod validation; Tailwind CSS v4 (`app/globals.css` with `@config "../tailwind.config.js"`, built by `@tailwindcss/postcss`); Redis 7 for central rate limits; S3-compatible object storage (SeaweedFS locally) through the AWS S3 SDK, with sharp for image sanitising; Vitest for integration tests and Playwright with axe for browser tests; Docker Compose for every environment. Versions live in `package.json` and the Dockerfiles; dependency policy is in [[Dependency Automation]].

## Runtime shape

| Piece | What runs | Notes |
| --- | --- | --- |
| `app` | `web` image, `node server.js` (standalone output, built to `.next-build`) | Healthcheck `GET /api/health/ready`. Never migrates |
| `migration` | `ops` image, `prisma migrate deploy` | One-shot job before an app rollout |
| Workers | `ops` image, `scripts/process-*.mjs` under the `workers` profile; `docker-compose.schedules.yml` loops each through `scripts/every-minute.mjs` | Email outbox, notifications (also token cleanup), stale orders, compensation refunds, checkout recovery, operations monitor. All run through `runWorker` (`lib/ops/worker.ts`). Schedules and alerts: [[Production Operations#Workers and schedules]] |
| `db` | PostgreSQL 16 | |
| `redis` | Redis 7 | Rate limits when `RATE_LIMIT_ENABLED=true` |
| Object store | SeaweedFS (`docker/Dockerfile.assets`) locally; hosted storage separately | PostgreSQL holds asset metadata; a restore needs both ([[Society Profiles and Assets]]) |

- `docker/entrypoint.sh` loads `*_FILE` secrets into their variables (refusing both forms at once), then `exec`s the container command. It never migrates.
- `docker compose up` on the base file starts the production-like stack. The dev stack is `-f docker-compose.yml -f docker-compose.dev.yml` (`pnpm docker:dev`): source mounts, polling, host database port, and `pnpm prisma:migrate:deploy` before `pnpm dev`. See [[Development Workflow]].
- Request path: browser, then `proxy.ts` (only `/dashboard` and `/account`), then server pages that call services directly, or route handlers for every client mutation; services use Prisma and providers; Stripe webhooks drive payment state.

## Service boundary

- **Routes are transport and security.** A route handler parses and bounds the request (`lib/api/request.ts`), checks trusted origin and CSRF, authentication, live permission, tenant and rate limit, calls one service, and maps errors with `mapRouteError` (`lib/api/errors.ts`) plus shared rules (`lib/api/route-rules.ts` and each family's `http.ts`). Guard order: [[Route Security Inventory#Guard order]].
- **Services own the domain:** decisions, persistence, transactions, recovery and provider calls live in `lib/*` (one line each in [[Thunderstrux Codebase Map]]). Services accept an already-authorised organisation id and still scope every query by it or by the event's owner; they never trust a client claim.
- **Pages call the same services as the routes,** never their own `/api` endpoints, and nothing under `app/` imports Prisma.
- **Workers** import only database-level code (no HTTP auth or CSRF config), e.g. `lib/auth/account-lock.ts`, `lib/staff/invite-authority.ts`, `lib/commerce/binding.ts`.
- **Commerce families** (`lib/commerce/families.ts`): memberships and merchandise plug into one commerce checkout, webhook reconciliation and stale expiry. An unregistered family's checkout answers 404 and its paid webhook goes to compensation review.

## Product account model

- `User.accountRole` is `member` (a person) or `organisation` (the legacy society login). Live verified identity is required for joins and purchases.
- Management authority is an active `OrganisationStaff` row with its live role; any account can be staff. `OrganisationMember` (a free join) never grants management.
- `Organisation.accountUserId` is a legacy fallback, honoured only while `LEGACY_ORGANISATION_ACCESS_MODE` allows it; production runs `deny` after migration.
- Members start every login in personal context; the switcher selects a society through a signed, login-bound preference that carries no authority. Details: [[Authentication and Dashboard Access]].

## Request protection

- Cookie-authenticated mutations pass `enforceTrustedMutationRequest` (`lib/security/request-guard.ts`): first-party Origin or Referer and a session-bound CSRF token. Guest mutations use `verifyGuestCsrf`. Stripe webhooks verify their signed raw body instead.
- Rate limits: `enforceRateLimit` (`lib/security/rate-limit.ts`), Redis-backed, bucket keys hashed; security-sensitive policies fail closed, door and purchase paths fail open with a warning. Policies and numbers: [[Route Security Inventory#Rate limits]].
- `next.config.ts` sets the Content-Security-Policy, `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, HSTS in production, and `private, no-store` on every `/api` answer except `/api/public/*` and health.
- Logs are one JSON object a line with redaction (`lib/ops/logger.ts`); alerts and metrics: [[Production Operations#Logs, metrics and alerts]].

## Multi-tenancy

`Organisation` is the tenant: it owns events, orders, tickets, reservations, commerce orders and the Stripe account. For event-owned rows the owner is `Event.organisationId`; the denormalised `organisationId` on orders and tickets is stored but never authority. A foreign resource answers exactly like a missing one (404). Boundary, indexes and integrity audit: [[Database and Multi Tenancy#Tenant boundary]].

## Invariants

| Invariant | Enforced in | Guarded by |
| --- | --- | --- |
| The tenant of an event-owned order, ticket or reservation is `Event.organisationId`; client ids, headers, membership rows and denormalised columns are never authority | `lib/orders/order-detail.ts` and `lib/orders/grouped-orders.ts` (`event: { organisationId }`), `lib/tickets/check-in.ts`, `lib/events/event-lifecycle.ts` | `tests/integration/orders-api.test.ts` ("uses event ownership when order organisation is inconsistent"), `tests/integration/ticket-check-in.test.ts` |
| Staff authority is read live from the staff row on every page, route, service and worker check; a revoked or legacy-only owner holds nothing in `deny` mode | `lib/staff/live-authority.ts` (`liveStaffRole`, `roleHasPermission`, `legacyOrganisationAccessMode`), used by `lib/auth/access.ts` | `tests/integration/live-staff-authority.test.ts` |
| Every API route that changes data checks the trusted origin (or guest CSRF) | `lib/security/request-guard.ts`: `enforceTrustedMutationRequest`; `lib/guest/guest-csrf.ts`: `verifyGuestCsrf` | `tests/integration/route-contract.test.ts` (named exceptions: Auth.js, the two Stripe webhooks, the read-only merchandise quote) |
| Every route maps failures through one mapper and logs only an error's class | `lib/api/errors.ts`: `mapRouteError` | `tests/integration/route-contract.test.ts` (exceptions: Auth.js, health, readiness, CSRF, webhooks) |
| Nothing under `app/` touches Prisma; pages and routes call services | `lib/*` services | `tests/integration/domain-service-boundaries.test.ts` |
| Payment fulfilment is webhook-driven and idempotent; a browser success page never marks an order paid | `lib/payments/checkout-reconciliation.ts`, `lib/payments/checkout-fulfilment-orchestrator.ts`, `lib/commerce/reconciliation.ts`; `/success` only reads (its fallback runs outside production only) | `tests/integration/webhook-reconciliation.test.ts`, `tests/integration/payment-lifecycle.test.ts` ("concurrent paid replays fulfil and journal exactly once"), `tests/integration/ticket-purchases.test.ts` (success page shows confirming until the webhook lands) |
| Purchase transactions run at READ COMMITTED after taking row locks, so queued buyers aren't refused (DEF-032) | `lib/tickets/reservations.ts`: `lockedPurchaseTransactionOptions`, `runReservationTransaction`; locks in `lib/events/inventory.ts` | `tests/integration/inventory-locks.test.ts` (30 buyers for 20 free and 20 paid tickets) |
| A ticket hold outlives its Stripe page by `lateWebhookGraceMs` (5 min) after `expires_at` (DEF-033) | `lib/tickets/reservations.ts`, set in `lib/payments/checkout-creation.ts` | `tests/integration/checkout-reservations.test.ts`, `tests/integration/pending-checkout.test.ts` |
| At most one payout per society per UTC day; the idempotency key is the account and day (DEF-034) | `lib/payouts/payouts.ts`: `processPayoutBatch` | `tests/integration/society-payouts.test.ts` |
| Integration tests touch only a database whose name ends in `_test` | `scripts/integration-test-guards.mjs`, applied by `scripts/run-integration-tests.mjs` and `tests/helpers/db-reset.ts` | `tests/runner/integration-guards.test.mjs` |
| The public origin is read at run time, so one image serves any domain | `lib/app-url.ts`: `appUrl` (computed key, never inlined by `next build`) | `tests/runner/runtime-origin.test.mjs` |
| The schema contract names the newest checked-in migration; readiness fails until it is applied | `config/schema-contract.json`, `lib/ops/readiness.ts` | `tests/runner/schema-contract.test.mjs` |

## Traps

- Don't add a migration without updating `config/schema-contract.json`; the runner test fails and readiness would pass on an old schema.
- Don't read `process.env.NEXT_PUBLIC_APP_URL` directly; `next build` would bake the build's domain into the image. Use `appUrl()`.
- Don't add `pnpm start` or a migration to the web container; the base compose runs `node server.js` and migrations are the separate one-shot job.
- A new mutating route without `enforceTrustedMutationRequest` or `mapRouteError` fails the route contract test; add an exception there only with a reason.

## Related

[[Thunderstrux Codebase Map]] · [[Frontend and Backend Flow]] · [[Route Security Inventory]] · [[Database and Multi Tenancy]] · [[Authentication and Dashboard Access]] · [[Payment Lifecycle]] · [[Stripe Payments and Connect]] · [[Production Operations]] · [[Development Workflow]]
