# Current Handover

P3.19 update (2026-09-21): [PR #13](https://github.com/ENGGP/thunderstrux/pull/13) merged the formal payment lifecycle and operator history to `main` (`b835d18`). Its five latest-head CI checks passed. Local acceptance included 213 integration tests, typecheck, production build, three consecutive 15-test browser/webhook runs, 13 runner-safety tests, operations rehearsal, a zero-finding high-severity audit, and real Stripe test-mode success/decline/cancellation/forced-expiry evidence. See [[Handover 2026-09-21 P3.19 Delivery]] for defects, fixes, evidence, and rollout limits; [[Payment Lifecycle]] for behavior. Drain old email workers before deploying the new claim-token implementation.

Read this first, then [[Handover 2026-09-21 P3.19 Delivery]], [[Engineering Delivery Workflow]], and [[Thunderstrux Codebase Map]]. Later sections below include historical snapshots; prefer the dated handover and linked topic notes for the current state.

Latest dated handover: [[Handover 2026-09-21 P3.19 Delivery]].

Dependency security update (2026-09-18): D1-D5 fixes merged through PR #3; the post-remediation GitHub audit passed and GitHub reports zero open dependency alerts. Renovate is authorized; [Dependency Dashboard #6](https://github.com/ENGGP/thunderstrux/issues/6) and controlled PR #7 prove npm/GitHub Actions discovery, Docker exclusions and required-check validation. PR #7's three application checks passed; it remains open for manual review while the configured three-day stability check is pending. Validation passed: 190/190 tests, typecheck, production build and isolated production HTTP checks. PR #4 added generated Next type handling. See [[Handover 2026-09-18 Dependency Security Remediation]] for versions and the scoped Prisma config override, and [[Dependency Automation]] for current evidence. Overall P2.15 remains open only for security-PR evidence after a real eligible advisory and maintainer notification receipt after the next genuine Security Audit failure. Docker image automation is deferred.

## Current State

P3.18 update (2026-09-20): checkout creation/recovery, expired checkout reconciliation, event lifecycle, order resend, ticket attendance, and Stripe Connect orchestration now live behind application services. Affected routes retain their original origin/auth/permission/tenant/rate-limit order and HTTP contracts, and direct Prisma access is prohibited by a boundary regression test. Final local qualification passed 205 integration tests, typecheck, production build, a zero-finding high-severity audit, 14 isolated browser/webhook E2E tests, and the complete operations rehearsal. Validation also found and fixed Windows CRLF checkout of `docker/entrypoint.sh`; `.gitattributes` now enforces LF for shell scripts. This is an architecture-only extraction; the formal payment lifecycle model remains P3.19.

P2.17 update (2026-09-20): repository-side operations merged through PR #11. The isolated rehearsal passed non-root startup, explicit migrations, database/Redis readiness outages, checksum-verified backup and restore, corrupt-archive quarantine, compatibility-gated rollback, and migration-failure blocking. Current regression passed 195 integration tests, typecheck, production image build, and audit. See [[Production Operations]]. External hosting, alert delivery, worker schedules, and encrypted off-machine backups remain activation work.

P2.16 update (2026-09-19): implementation and acceptance merged through PR #10. Final P2.16 regression passed 194 integration tests, typecheck, production build and audit; 8 runner safety tests and three consecutive local/CI E2E runs passed. Real Stripe success, decline, manually attested cancellation and forced-expiry reconciliation were verified. `e2e-tests` is required alongside the existing three checks. Test containers/volumes and generated credentials were cleaned up. See [[E2E and Staging Payments]] for run references, precise evidence and recovery instructions.

Thunderstrux is a Docker-based Next.js 16 App Router SaaS for student societies.

Core model:

- `Organisation` is the tenant boundary.
- Organisation management uses active `OrganisationStaff` authority with the explicit legacy-owner fallback. `OrganisationMember` is join state only.
- `Event.organisationId` is the canonical ownership source for event-owned resources.
- Public event reads are read-only and never create demo data.
- Public event discovery, organiser orders, and member tickets are cursor-paginated for MVP-scale reads.
- Public event detail returns reservation-aware ticket `availableQuantity` while preserving raw `quantity`.
- Order, reservation, and ticket lifecycle reads/writes that need organisation scoping must use `Event.organisationId` as canonical ownership, not denormalized `Order.organisationId`, `Ticket.organisationId`, or `TicketReservation.organisationId` alone.
- Stripe Checkout fulfilment remains webhook-driven.
- Paid-but-unfulfilled Checkout sessions enter a durable compensation-review state instead of ordinary silent failure.
- Ticket delivery email is outbox-backed and non-blocking; provider failures must not roll back payment fulfilment, reservations, inventory decrement, or ticket issuance.
- Operational logs use structured JSON for P1.13-covered paths. Metrics are console/log-derived only for MVP and require production log aggregation for alerting.
- Security-sensitive route handlers are transport adapters; domain persistence, transactions, recovery, and external provider composition are delegated to application services.

Implemented product areas:

- Auth.js credentials auth with `member` and `organisation` account roles.
- Member profile onboarding, organisation search/join/leave, public organisation pages, public event browsing, checkout, and `/tickets`.
- Organisation dashboard, event management, event analytics, order review, manual refund flagging, ticket email resend, Stripe Connect settings, and ticket check-in/check-out.
- Legacy `/dashboard/[orgSlug]/*` routes remain compatibility redirects.
- Stripe Checkout uses 30-minute ticket reservations.
- Stripe Connect Express onboarding has explicit local lifecycle states.
- Public event demo data comes from `prisma/seed.mjs`, not runtime reads.
- Public event detail subtracts only active unexpired reservations from displayed availability. Checkout remains the authoritative availability gate.
- Paid Stripe sessions that cannot issue tickets are stored as failed orders with `requiresCompensationReview=true`.
- First-time paid-but-unfulfilled compensation transitions emit a redacted `paid_but_unfulfilled_compensation_required` operational alert after the reconciliation transaction commits.
- Successful fulfilment transactionally creates durable automatic `EmailOutbox` ticket-delivery jobs; worker processing is separate from webhook reconciliation.
- `GET /api/health` returns a minimal public-safe health payload for external health checks.

Security hardening now in place:

- Central trusted-origin guard for custom cookie-authenticated mutation routes.
- Central Redis-backed fixed-window rate limiting for credentials login, signup, checkout creation, ticket email resend, organisation create/join/leave, ticket check-in/check-out, and Stripe Connect browser mutations.
- Rate-limit tests cover side-effect prevention for organisation create, join/leave, ticket check-in/check-out, checkout/resend, and Stripe Connect mutation paths.
- Stripe webhook routes are exempt from trusted-origin and rate-limit guards; they remain governed by Stripe signature verification over raw request bodies.
- Payment webhooks, checkout session creation, email outbox processing, stale cleanup, rate limiting, and trusted-origin guard now emit stable structured operational events.

Named organisation staff, invites, audit logs, and per-user permissions are implemented. Legacy organisation accounts remain supported; MFA remains future work. `OrganisationMember` join rows never grant management access.

## Latest Migrations

Implemented migrations:

- `20260428000000_account_role_groundwork`
- `20260429000000_ticket_reservations`
- `20260429010000_order_expired_status`
- `20260503020000_manual_order_refund_flag`
- `20260503030000_ticket_check_in_state`
- `20260503040000_ticket_email_delivery_tracking`
- `20260503050000_ticket_event_cursor_index`
- `20260512060000_order_compensation_review`
- `20260513010000_ticket_email_outbox`
- `20260513020000_composite_query_indexes`

No schema migration was added for the trusted-origin, rate-limiting, P1.6 pagination, or P1.7 reservation-aware public availability slices. The compensation-review slice added order review metadata. The email-outbox slice added durable ticket email jobs with a raw partial unique index for automatic jobs. The P1.10 composite-index slice added mapped btree indexes for public discovery, member ticket wallet, event/order reads, stale order cleanup, and stale reservation cleanup.

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
docker compose exec app pnpm email:outbox:process
docker compose exec app pnpm stale-orders:process
docker compose exec app pnpm stale-orders:process -- --dry-run
```

## Latest Verification

Most recent validation after P1.13 structured logging/metrics/alerts MVP slices:

- `pnpm exec tsc --noEmit` passed.
- `git diff --check` passed with CRLF warnings only.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration` passed: 18 files, 166 tests.
- `docker compose exec app pnpm test:smoke` passed: 22 smoke checks.

Recent P1 validation notes:

- P1.10 dev DB row-count evidence before choosing ordinary migration: `Order=25`, `Event=13`, `TicketReservation=15`.
- P1.10 plain `EXPLAIN` evidence confirmed the new indexes are usable for public event discovery, member ticket wallet, event paid-order aggregation, stale order cleanup, and stale reservation cleanup.
- P1.6 pagination is complete for MVP across organiser orders, member tickets, and public discovery.
- P1.7 public event detail availability is reservation-aware and strictly read-only.
- P1.9 checkout reconciliation now validates Stripe organisation metadata against `Event.organisationId`, preserves stale denormalized `Order.organisationId` for drift tolerance, and uses event ownership for organisation-scoped stale cleanup.
- P1.13 adds structured JSON logs, redaction, the health endpoint, stable operational events, console/log-derived metrics, and alert event names. It does not add a metrics backend, dashboard, external alert vendor, or automatic paging.

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
- `tests/integration/email-outbox.test.ts`
- `tests/integration/ops-logging.test.ts`

Important rules:

- Integration tests must run against a database whose name contains `_test`.
- The default isolated database is `thunderstrux_test`.
- Tests are sequential.
- The setup blocks real network calls and mocks Stripe where practical.
- Rate-limit tests use the central test backend exposed by `lib/security/rate-limit.ts`; do not point them at a real Redis instance unless deliberately testing infrastructure.

## Current Next Work

Recommended next work after this documentation PR merges:

- P2.17 repository-side operations are merged and locally rehearsed. See [[Production Operations]]. The next production step is selecting a host and activating off-machine backups, external health/alert routing, and one-minute worker schedules.
- Produce the dedicated CSRF design for P0 Slice B before implementing any token-based CSRF changes.
- Keep each remediation slice narrow and separately reviewed.

Other pending branches:

- See [[Non-Blocking Issue Register]] for current non-blocking codebase risks and follow-up candidates.
- P1.10 added the planned composite indexes, but existing single-column `Order(eventId)` and `Order(userId)` indexes intentionally remain. Review real production index usage before removing any redundant indexes.
- Production must schedule `pnpm email:outbox:process` every 1 minute or paid buyers may not receive ticket delivery email.
- Production must schedule `pnpm stale-orders:process` every 1 minute or stale pending orders/reservations may remain until the next manual run. Use `pnpm stale-orders:process -- --dry-run` for non-mutating inspection.
- Structured alert events including `paid_but_unfulfilled_compensation_required`, `payment_reconciliation_ambiguous_order`, `email_outbox_retry_exhausted`, `stale_order_worker_failed`, `stripe_webhook_signature_failure`, and `checkout_session_creation_failure` still require external production routing.
- Public availability can still become stale between page load and checkout; checkout remains authoritative.
- Optional P1.7 UI test hardening: assert input `max` and disabled button attributes directly.
- Add drift-audit or repair tooling for denormalized `Order.organisationId`, `Ticket.organisationId`, and `TicketReservation.organisationId`; P1.9 hardens runtime trust but does not rewrite historical rows.
- API error standardisation and small UI state consistency improvements.
- Future MFA, QR scanning, real metrics backend, external alerting transport, email outbox monitoring, and explicit failed-job requeue tooling.

Do not undertake new QR scanning, auth-model rewrites, microservices, or broad architecture rewrites unless explicitly requested.

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs, route params, or headers as authority.
- Keep `Organisation` as the tenant/payment/event/order owner.
- Member `OrganisationMember` rows must not grant organisation management access.
- Organisation accounts must not create checkout sessions.
- A normal member account without active organisation staff authority must not access organiser analytics; a member account may also be authorised staff.
- Payment fulfilment must remain webhook-driven.
- Do not mark orders paid from frontend success pages.
- The `/success` fallback must remain non-production only and must call the same checkout reconciliation helper as the webhook.
- Ticket reservations are temporary soft holds; paid tickets are issued only by Stripe Checkout webhook reconciliation.
- Paid Stripe sessions that cannot locally issue tickets must become compensation-required failed orders, with no tickets and no ticket email.
- Compensation diagnostics are write-once; successful natural retry may clear `requiresCompensationReview` but should preserve fulfilment diagnostics.
- Automatic ticket delivery email must be enqueued in the same transaction as paid webhook fulfilment and ticket issuance.
- Ticket delivery enqueue/worker failure must update `Order.ticketEmailLastError` where possible and must not roll back core payment/order/ticket state.
- Duplicate webhook delivery must not enqueue duplicate automatic ticket email jobs.
- Manual ticket email resend must be organisation-scoped, paid-order only, and queue a manual outbox job.
- Ticket check-in and check-out may only mutate `Ticket.checkedInAt`.
- Public event reads must not create organisations, events, ticket types, users, orders, reservations, tickets, or demo data.
- Public event detail availability may read active unexpired reservations, but must not mutate reservations or cleanup stale rows.
- Stale cleanup may expire pending orders and active reservations, but must not fulfil orders, decrement inventory, or alter paid/failed orders.
- Request-time reads must not reintroduce broad stale cleanup writes. Checkout-local cleanup remains the authority before reservation creation.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
