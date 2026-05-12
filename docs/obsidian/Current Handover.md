# Current Handover

Read this first, then [[Thunderstrux Codebase Map]].

Latest dated handover: [[Handover 2026-05-12 Trusted Origin and Rate Limiting]].

## Current State

Thunderstrux is a Docker-based Next.js 16 App Router SaaS for student societies.

Core model:

- `Organisation` is the tenant boundary.
- Organisation dashboard access is based on `Organisation.accountUserId`.
- `Event.organisationId` is the canonical ownership source for event-owned resources.
- Public event reads are read-only and never create demo data.
- Stripe Checkout fulfilment remains webhook-driven.
- Email delivery is non-blocking and must not roll back payment fulfilment, reservations, inventory decrement, or ticket issuance.

Implemented product areas:

- Auth.js credentials auth with `member` and `organisation` account roles.
- Member profile onboarding, organisation search/join/leave, public organisation pages, public event browsing, checkout, and `/tickets`.
- Organisation dashboard, event management, event analytics, order review, manual refund flagging, ticket email resend, Stripe Connect settings, and ticket check-in/check-out.
- Legacy `/dashboard/[orgSlug]/*` routes remain compatibility redirects.
- Stripe Checkout uses 30-minute ticket reservations.
- Stripe Connect Express onboarding has explicit local lifecycle states.
- Public event demo data comes from `prisma/seed.mjs`, not runtime reads.

Security hardening now in place:

- Central trusted-origin guard for custom cookie-authenticated mutation routes.
- Central Redis-backed fixed-window rate limiting for credentials login, signup, checkout creation, ticket email resend, organisation create/join/leave, ticket check-in/check-out, and Stripe Connect browser mutations.
- Stripe webhook routes are exempt from trusted-origin and rate-limit guards; they remain governed by Stripe signature verification over raw request bodies.

For MVP, organisation committee members may share one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

## Latest Migrations

Implemented migrations:

- `20260428000000_account_role_groundwork`
- `20260429000000_ticket_reservations`
- `20260429010000_order_expired_status`
- `20260503020000_manual_order_refund_flag`
- `20260503030000_ticket_check_in_state`
- `20260503040000_ticket_email_delivery_tracking`
- `20260503050000_ticket_event_cursor_index`

No schema migration was added for the trusted-origin or rate-limiting slices.

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

Docker services:

- `app`: Next.js runtime.
- `db`: PostgreSQL 16.
- `redis`: Redis 7, used when `RATE_LIMIT_ENABLED=true`.

Docker modes:

- `docker-compose.yml`: production-like runtime, built image, `pnpm start`, migration deploy entrypoint, no database host port.
- `docker-compose.dev.yml`: development override, bind-mounted source, `pnpm dev`, polling, database host port `5433`.

Important env values:

```text
DATABASE_URL=
AUTH_SECRET=
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
TRUSTED_APP_ORIGINS=
RATE_LIMIT_ENABLED=false
RATE_LIMIT_REDIS_URL=redis://redis:6379
RATE_LIMIT_FAIL_OPEN=false
RATE_LIMIT_KEY_PREFIX=thunderstrux
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
```

`RATE_LIMIT_ENABLED=false` preserves local/dev behaviour. Production should set `RATE_LIMIT_ENABLED=true` and provide a reachable Redis URL.

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

## Latest Verification

Most recent validation after P0.3 rate limiting:

- `pnpm exec tsc --noEmit` passed.
- `git diff --check` passed with CRLF warnings only.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration` passed: 12 files, 73 tests.
- `docker compose exec app pnpm test:smoke` passed: 22 smoke checks.

## Integration Test State

Current integration suites:

- `tests/integration/auth-access.test.ts`
- `tests/integration/checkout-reservations.test.ts`
- `tests/integration/event-lifecycle.test.ts`
- `tests/integration/member-features.test.ts`
- `tests/integration/orders-api.test.ts`
- `tests/integration/organisation-tenancy.test.ts`
- `tests/integration/pending-cleanup.test.ts`
- `tests/integration/public-safe-pages.test.ts`
- `tests/integration/rate-limit.test.ts`
- `tests/integration/ticket-check-in.test.ts`
- `tests/integration/trusted-origin-guard.test.ts`
- `tests/integration/webhook-reconciliation.test.ts`

Important rules:

- Integration tests must run against a database whose name contains `_test`.
- The default isolated database is `thunderstrux_test`.
- Tests are sequential.
- The setup blocks real network calls and mocks Stripe where practical.
- Rate-limit tests use the central test backend exposed by `lib/security/rate-limit.ts`; do not point them at a real Redis instance unless deliberately testing infrastructure.

## Current Next Work

Recommended next implementation branch:

- Pick the next item from `production-readiness-remediation-plan.md`, keeping each remediation slice narrow and separately reviewed.

Other pending branches:

- Add pagination hardening tests: same-`createdAt` cursor collision, malformed `limit`, malformed `direction`, and optional empty stale-cursor `pageInfo` cleanup.
- Review stale pending cleanup consistency. Cleanup still scopes through denormalized `Order.organisationId`; keep this separate because it touches order lifecycle and reservation expiry.
- API error standardisation and small UI state consistency improvements.
- Future staff/RBAC, audit logs, QR scanning, and asynchronous email outbox.

Do not implement QR scanning, RBAC/staff invites, microservices, or broad architecture rewrites unless explicitly requested.

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs, route params, or headers as authority.
- Keep `Organisation` as the tenant/payment/event/order owner.
- Member `OrganisationMember` rows must not grant organisation management access.
- Organisation accounts must not create checkout sessions.
- Member accounts must not access organiser analytics.
- Payment fulfilment must remain webhook-driven.
- Do not mark orders paid from frontend success pages.
- The `/success` fallback must remain non-production only and must call the same checkout reconciliation helper as the webhook.
- Ticket reservations are temporary soft holds; paid tickets are issued only by Stripe Checkout webhook reconciliation.
- Ticket delivery email must only run after paid webhook fulfilment and ticket issuance.
- Ticket delivery email failure must update `Order.ticketEmailLastError` and must not roll back core payment/order/ticket state.
- Duplicate webhook delivery must not send automatic ticket email again after `Order.ticketEmailSentAt` is set.
- Manual ticket email resend must be organisation-scoped and paid-order only.
- Ticket check-in and check-out may only mutate `Ticket.checkedInAt`.
- Public event reads must not create organisations, events, ticket types, users, orders, reservations, tickets, or demo data.
- Stale cleanup may expire pending orders and active reservations, but must not fulfil orders, decrement inventory, or alter paid/failed orders.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
