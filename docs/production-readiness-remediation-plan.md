# Thunderstrux Production Readiness Remediation Plan

This plan addresses the production-grade review findings across security, payments, data integrity, scalability, testing, DevEx, and operations. It is intentionally implementation-focused, but it is documentation only. No code, schema, config, tests, or dependencies are changed by this file.

## Goals

- Make Thunderstrux safe to operate with real users, real organisations, and real payments.
- Preserve the current strengths: webhook-driven fulfilment, server-side tenancy checks, Docker-first workflow, and integration-test coverage.
- Remove production blockers before adding major features.
- Keep the monolith for now; improve boundaries inside it before considering service splits.

## Non-Goals

- Do not split the app into microservices.
- Do not replace Stripe Checkout or Stripe-hosted Connect onboarding.
- Do not remove server-side ownership checks.
- Do not implement QR scanning, staff RBAC, or an email queue until the immediate production blockers are fixed.

## Priority Overview

| Priority | Theme | Status Target |
| --- | --- | --- |
| P0 | Abuse controls, CSRF/origin protection, public-read data mutation removal, payment compensation, webhook/email reliability | Required before production payments |
| P1 | Pagination, DB invariants, index hardening, API consistency, logging/metrics, stale cleanup redesign | Required before meaningful scale |
| P2 | Staff accounts, audit logs, MFA, dependency hygiene, E2E/staging tests, CI/CD and operational maturity | Required before broader rollout |
| P3 | Strategic architecture improvements and optional domain refactors | Do after product fit and operating patterns are clearer |

## P0 Remediation

### 1. Add Rate Limiting And Abuse Controls

Severity: Critical

Affected areas:

- `auth.ts`
- `app/api/auth/signup/route.ts`
- `app/api/payments/checkout/event/route.ts`
- `app/api/orders/[orderId]/resend/route.ts`
- `app/api/orgs/route.ts`
- `app/api/orgs/[orgSlug]/join/route.ts`
- `app/api/orgs/[orgSlug]/leave/route.ts`
- `app/api/tickets/[ticketId]/check-in/route.ts`
- `app/api/tickets/[ticketId]/check-out/route.ts`
- Stripe Connect mutation routes

Problem:

- Authentication and mutation routes have no visible throttling.
- Attackers can brute-force credentials, create accounts and organisations, spam join/leave actions, create excessive checkout sessions, and spam ticket email resends.

Solution:

- Introduce a central rate-limit helper for route handlers.
- Use different buckets by risk:
  - Signup: IP plus normalized email.
  - Login: IP plus normalized email.
  - Checkout creation: user id plus event id plus IP.
  - Email resend: organisation id plus order id plus user id.
  - Check-in/check-out: organisation id plus route action.
  - Organisation create/join/leave: user id plus IP.
- Store counters in a production-grade shared backend. Use Redis or a managed rate-limit service, not in-memory state.
- Return structured `429` errors with a safe message and optional retry-after metadata.
- Add audit logging for repeated throttling.

Implementation steps:

1. Add a `lib/security/rate-limit.ts` helper with typed limit policies.
2. Add route-level calls before expensive work such as bcrypt, Prisma transactions, Stripe calls, or email sends.
3. Add tests for allowed request, throttled request, and independent buckets.
4. Add production environment variables for the rate-limit backend.
5. Add operational metrics: rate-limit hit count by route and policy.

Validation:

- Brute-force login attempts are throttled.
- Signup spam from one IP is throttled.
- A single member cannot create unlimited Stripe Checkout Sessions.
- Manual email resend cannot be spammed.
- Normal user flows remain usable.

### 2. Add CSRF And Origin Protection For Cookie-Authenticated Mutations

Severity: High

Affected areas:

- All custom `POST`, `PATCH`, and `DELETE` API routes except Stripe webhooks.
- `lib/api/request.ts` or a new central request security helper.
- Client fetch helpers and forms.

Problem:

- Custom mutation endpoints rely on cookie-authenticated session state but do not visibly enforce CSRF tokens or origin validation.
- Browser `SameSite` cookie behavior helps but should not be the only protection for state-changing routes.

Solution:

- Add a central mutation request guard.
- Validate `Origin` and/or `Referer` against `NEXT_PUBLIC_APP_URL` / trusted app origins.
- Add a CSRF token for browser-originated mutations, or use a double-submit token pattern.
- Exempt webhook routes because Stripe signs them independently.

Implementation steps:

1. Create `lib/security/request-guard.ts`.
2. Define protected methods: `POST`, `PATCH`, `DELETE`.
3. Define trusted origins from environment.
4. Add `requireTrustedMutationRequest(request)` to protected route handlers.
5. Update client fetch helpers to include CSRF token headers where needed.
6. Add tests for missing origin, wrong origin, valid origin, missing token, valid token, and webhook exemption.

Validation:

- Cross-site form or fetch attempts fail.
- First-party UI mutations still work.
- Stripe checkout and Connect webhooks still verify through Stripe signatures.

### 3. Remove Runtime Demo Data Creation From Public Reads

Severity: High

Affected areas:

- `lib/events/public-events.ts`
- `app/api/public/events/route.ts`
- `prisma/seed.mjs`
- local development docs

Problem:

- `getPublishedEvents()` calls demo event creation logic.
- Public `GET /api/public/events` can write organisations, events, and ticket types.
- Production read traffic must not mutate application data.

Solution:

- Move demo event creation fully into seed/dev tooling.
- Keep public event reads read-only.
- Add an explicit local-only command or seed option if demo event creation is still useful.

Implementation steps:

1. Remove runtime calls to `ensurePublishedDemoEvents()` from public loaders.
2. Move demo event creation into `prisma/seed.mjs`.
3. Add a test that `GET /api/public/events` does not create rows when the database is empty.
4. Update docs to state that public pages can be empty until seed data or real events exist.

Validation:

- Public event list returns zero events on an empty database.
- No write queries occur during public event list reads.
- Seed still creates demo users, organisations, events, ticket types, orders, and tickets.

### 4. Add Payment Compensation For Paid-But-Unfulfilled Orders

Severity: High

Affected areas:

- `lib/payments/checkout-reconciliation.ts`
- `app/api/payments/webhook/route.ts`
- Stripe refund integration
- organiser order detail UI
- operations alerting

Problem:

- If Stripe collects payment but local reconciliation fails due inventory or metadata mismatch, the order can become `failed` without tickets and without automated refund/alert handling.
- This creates customer harm, support burden, and financial/legal risk.

Solution:

- Distinguish ordinary checkout expiry from paid-but-unfulfilled failure.
- Add a compensation workflow for paid sessions that cannot be fulfilled.
- The first version can create an urgent operational alert and mark the order as requiring manual refund.
- A later version should automatically create a Stripe refund when safe.

Implementation steps:

1. Add an order state or field for `requiresRefundReview` / `fulfilmentFailureReason`.
2. When reconciliation receives a paid session but cannot issue tickets, persist a compensation-required state.
3. Emit a high-severity alert with order id, Stripe session id, event id, and reason.
4. Add organiser/admin visibility for compensation-required orders.
5. Implement Stripe refund creation for safe cases after confirming business rules.
6. Add idempotency so repeated webhooks do not create duplicate refunds.

Validation:

- Paid session with insufficient inventory creates no tickets but enters compensation-required state.
- Duplicate webhook delivery does not duplicate compensation actions.
- Operators can find and resolve affected orders.

### 5. Move Ticket Email Delivery To An Outbox

Severity: High

Affected areas:

- `lib/email/ticket-delivery.ts`
- `lib/payments/checkout-fulfilment-orchestrator.ts`
- `lib/payments/checkout-reconciliation.ts`
- `app/api/orders/[orderId]/resend/route.ts`
- Prisma schema
- background worker or scheduled job

Problem:

- Automatic email delivery runs after checkout reconciliation and performs live provider I/O.
- Slow or failing email provider calls can delay webhook responses.
- There is no retry queue or durable delivery state beyond fields on `Order`.

Solution:

- Add an `EmailOutbox` table.
- Webhook reconciliation should enqueue a durable email job after fulfilment.
- A worker processes the outbox with retries, backoff, and provider error capture.
- Manual resend should enqueue a manual email job rather than sending inline.

Implementation steps:

1. Add an outbox model with order id, mode, status, attempts, nextAttemptAt, lastError, createdAt, sentAt.
2. In the fulfilment orchestrator, enqueue the automatic delivery job once per paid order.
3. Add a worker command or scheduled route to process pending jobs.
4. Add retry limits and backoff.
5. Keep `Order.ticketEmailSentAt`, `ticketEmailLastError`, and `ticketEmailResentAt` as denormalized status fields if the UI needs them.
6. Add tests for enqueue, worker success, worker failure, retry, duplicate automatic webhook, and manual resend.

Validation:

- Webhook fulfilment stays fast even when Resend is down.
- Email failures do not roll back tickets or payments.
- Duplicate webhooks do not enqueue duplicate automatic email jobs.
- Manual resend is rate-limited and auditable.

## P1 Remediation

### 6. Paginate All Large Reads

Severity: Medium/High

Affected areas:

- `lib/orders/grouped-orders.ts`
- `app/api/orders/route.ts`
- `/dashboard/orders`
- `app/tickets/page.tsx`
- public events API and homepage

Problem:

- Orders, member ticket wallet, and public events can grow without bounds.
- `findMany` without pagination will become slow and memory-heavy.

Solution:

- Add cursor pagination to all user-facing list reads.
- Use stable ordering by `createdAt` plus `id`.
- Keep page sizes bounded.

Implementation steps:

1. Add shared cursor helpers for `(createdAt, id)` pagination.
2. Add `limit`, `cursor`, and `direction` support to orders API.
3. Add pagination to `/tickets`.
4. Add pagination to public events discovery.
5. Add composite indexes matching query order.
6. Update UI controls for next/previous navigation.

Validation:

- Large order datasets return bounded pages.
- Same-timestamp rows paginate correctly.
- Malformed cursor/limit params return structured errors.

### 7. Return Reservation-Aware Ticket Availability Publicly

Severity: Medium

Affected areas:

- `app/api/public/events/[eventId]/route.ts`
- `lib/tickets/reservations.ts`
- `components/events/public-ticket-purchase.tsx`

Problem:

- Public event details expose raw `TicketType.quantity`, while checkout availability subtracts active reservations.
- Users can see misleading remaining counts.

Solution:

- Return `availableQuantity = ticketType.quantity - activeReservedQuantity`.
- Keep raw remaining inventory private to organiser views.

Implementation steps:

1. After stale cleanup, aggregate active reservations for the event ticket types.
2. Map public ticket types to include reservation-aware availability.
3. Update client UI to use availability for max quantity and remaining text.
4. Add integration tests for active reservation reducing public availability.

Validation:

- Active reservation reduces public availability.
- Expired reservation does not reduce availability.
- Checkout server remains authoritative.

### 8. Add Database-Level Integrity Constraints

Severity: Medium/High

Affected areas:

- `prisma/schema.prisma`
- migrations
- checkout and event validators

Problem:

- Critical invariants exist only in application validation.
- Direct DB changes, bugs, or future routes can create invalid data.

Solution:

- Add database check constraints through migrations where Prisma schema support is insufficient.

Recommended constraints:

- Ticket type quantity >= 0.
- Ticket type price >= 0.
- Order quantity > 0.
- Order unitPrice >= 0.
- Order totalAmount >= 0.
- Reservation quantity > 0.
- Event endTime > startTime.
- Paid order has paidAt.
- Failed order has failedAt or a defined failure policy.
- Expired order should not have paidAt.

Implementation steps:

1. Audit current data for violations.
2. Add migration with constraints.
3. Update seed and tests if constraints expose invalid fixtures.
4. Add integration tests for rejected invalid writes where practical.

Validation:

- Migration applies cleanly to seeded and test databases.
- Invalid direct writes fail at DB level.

### 9. Harden Denormalized Organisation Ownership

Severity: Medium/High

Affected areas:

- `lib/orders/stale-orders.ts`
- order queries
- ticket queries
- checkout reconciliation
- Prisma schema and migrations

Problem:

- `Order.organisationId` and `Ticket.organisationId` are denormalized.
- Access checks mostly use event ownership, but cleanup still scopes through `Order.organisationId`.

Solution:

- Either remove denormalized organisation fields long term or enforce consistency strongly.
- Short term, update lifecycle queries to scope through event ownership where security or correctness matters.

Implementation steps:

1. Update stale cleanup to support event-based organisation scoping.
2. Add consistency checks in tests for cleanup paths.
3. Add a repair script or migration to correct inconsistent denormalized rows.
4. Add DB-level trigger or scheduled integrity check if fields remain.

Validation:

- Inconsistent `Order.organisationId` rows are still cleaned when their event belongs to the target organisation.
- No access decision trusts denormalized organisation fields alone.

### 10. Add Composite Indexes For Real Query Shapes

Severity: Medium

Affected areas:

- `prisma/schema.prisma`
- migrations
- orders, cleanup, public discovery, member ticket wallet

Problem:

- Current indexes are mostly single-column.
- Production query patterns filter by organisation/event/status/user/date and order by createdAt.

Recommended indexes:

- `Order(eventId, status, createdAt, id)`
- `Order(userId, status, createdAt, id)`
- `Order(status, createdAt)` for cleanup if global cleanup remains.
- `Event(status, startTime, id)` for public discovery.
- `TicketReservation(status, expiresAt)` for cleanup.
- Keep `Ticket(eventId, createdAt, id)` for ticket pagination.

Implementation steps:

1. Run `EXPLAIN ANALYZE` on the expected high-volume queries.
2. Add only indexes that match actual filters and ordering.
3. Verify write overhead remains acceptable.

Validation:

- Order dashboard query plan uses indexes.
- Public events query uses indexes.
- Cleanup query avoids full table scans.

### 11. Standardize API Errors And Tenant Resource Disclosure

Severity: Medium

Affected areas:

- `lib/api/errors.ts`
- all route handlers
- client error handling

Problem:

- Error status and body shapes are mostly structured but not consistently applied.
- Some tenant-owned resources can reveal existence through differing status messages.

Solution:

- Add a route error mapper.
- Define resource disclosure rules:
  - Unauthenticated: 401.
  - Authenticated but not allowed for broad capability: 403.
  - Tenant-owned object not owned or missing: 404 with same safe message.
  - Invalid input shape: 400.
  - Conflict state: 409.

Implementation steps:

1. Create typed domain errors.
2. Centralize error-to-response mapping.
3. Replace per-route repetitive catch blocks.
4. Add tests for cross-tenant object lookup behaviour.

Validation:

- Cross-tenant event/order/ticket ids do not reveal object existence.
- Client still receives useful validation errors.

### 12. Move Request-Time Stale Cleanup To A Worker

Severity: Medium

Affected areas:

- `lib/orders/stale-orders.ts`
- public event detail
- dashboard pages
- order and ticket reads
- worker/scheduler

Problem:

- Many normal reads trigger cleanup writes.
- This amplifies writes and makes read latency unpredictable.

Solution:

- Add a scheduled cleanup worker.
- Keep only narrow pre-checkout cleanup for ticket-type availability.

Implementation steps:

1. Add a cleanup command that expires old reservations and pending orders in batches.
2. Add a scheduler through deployment platform, cron, or worker process.
3. Remove broad cleanup from read paths once worker is reliable.
4. Keep checkout-specific cleanup inside checkout transaction.

Validation:

- Expired reservations settle without user traffic.
- Public reads do not write except where explicitly required.
- Cleanup is idempotent and batch-limited.

### 13. Add Structured Logging, Metrics, And Alerts

Severity: Medium/High

Affected areas:

- payment routes
- checkout reconciliation
- Stripe Connect
- email delivery
- auth and rate limiting
- Docker/deployment

Problem:

- Current logging uses `console.*` with inconsistent payloads and no redaction policy.
- There are no metrics or alerts for payment failures, webhook failures, or email failures.

Solution:

- Add structured logger with redaction.
- Add metrics counters and timers.
- Add alerts for critical failure modes.

Required alerts:

- Stripe webhook signature failures above threshold.
- Paid-but-unfulfilled order.
- Email outbox retry exhaustion.
- Checkout session creation failure spike.
- DB migration failure.
- App healthcheck failure.

Validation:

- Test or staging environment emits structured logs.
- Alert routes are exercised with synthetic failures.

## P2 Remediation

### 14. Replace Shared Organisation Login With Staff Accounts

Severity: High for production

Affected areas:

- auth model
- `OrganisationMember`
- access helpers
- dashboard UI
- invitation flow
- audit logs

Problem:

- Shared organisation credentials prevent individual accountability, offboarding, MFA, and least privilege.

Solution:

- Introduce named staff membership separate from ordinary member joins.
- Add invite flow and role-based permissions.
- Add MFA for organiser staff.
- Add audit logs for sensitive actions.

Implementation steps:

1. Split member join state from staff access state.
2. Add `OrganisationStaff` or repurpose `OrganisationMember` only after a careful migration.
3. Add invitation tokens with expiry.
4. Add roles: owner, admin, event manager, finance manager, check-in staff.
5. Record audit entries for event changes, publish/unpublish, checkout settings, refunds, check-ins, and email resends.
6. Add UI for staff management.

Validation:

- Ordinary joined members cannot access management.
- Staff can be invited, removed, and role-limited.
- Audit logs show actor identity.

### 15. Pin Dependency Ranges And Add Dependency Automation

Severity: Low/Medium

Affected areas:

- `package.json`
- `pnpm-lock.yaml`
- CI

Problem:

- Critical packages use `latest`.
- Lockfile limits current drift but future installs/upgrades are less controlled.

Solution:

- Pin explicit version ranges.
- Add Renovate or Dependabot with grouped updates and CI checks.
- Add security audit checks.

Validation:

- Fresh install is deterministic.
- Dependency update PRs run tests and build validation.

### 16. Add E2E And Staging Payment Tests

Severity: Medium

Affected areas:

- test suite
- CI/staging
- Stripe test mode

Problem:

- Integration tests mock Stripe and network calls.
- Raw webhook signature transport and real browser flows are under-tested.

Solution:

- Add Playwright E2E for signup/login/dashboard/public events.
- Add staging Stripe test-mode flow with real Checkout Session creation and webhook forwarding or registered test endpoint.

Validation:

- Real signed webhook reaches route and reconciles an app-created order.
- Login/signup/dashboard routes work in browser.
- Public purchase path reaches Stripe Checkout in test mode.

### 17. Add CI/CD, Healthchecks, Backup, And Rollback Strategy

Severity: High for production operations

Affected areas:

- Docker config
- deployment platform
- CI
- database operations

Problem:

- No visible CI/CD pipeline, app healthcheck, backup/restore process, or migration rollback process.
- Migrations run automatically in container entrypoint, which can be risky with multiple replicas.

Solution:

- Add CI stages: install, typecheck, unit/integration tests, build, Docker build.
- Add app health endpoint and container healthcheck.
- Run migrations as a single deployment job before app rollout.
- Document backup/restore and rollback.
- Run the app container as non-root.

Validation:

- Failed migration blocks deployment before app rollout.
- Healthcheck detects broken runtime.
- Restore procedure is tested on a disposable database.

## P3 Remediation

### 18. Extract Domain Use-Case Services

Severity: Medium

Affected areas:

- checkout route
- event route
- orders route
- Stripe Connect routes

Problem:

- Route handlers combine transport, auth, validation, domain logic, persistence, external I/O, and recovery.

Solution:

- Keep the monolith, but introduce application services:
  - checkout creation service
  - checkout reconciliation service
  - event lifecycle service
  - order operations service
  - ticket attendance service
  - Stripe Connect service

Validation:

- Route handlers become thin adapters.
- Existing integration tests remain behaviourally unchanged.

### 19. Build A Formal Payment Lifecycle Model

Severity: Medium/Long-term

Affected areas:

- orders
- reservations
- tickets
- refunds
- email outbox

Problem:

- Payment, fulfilment, reservation, email, and refund states are spread across several fields.

Solution:

- Define explicit lifecycle transitions and events.
- Add state transition helpers.
- Consider a payment event log if operational needs grow.

Validation:

- Invalid transitions are impossible or rejected.
- Operators can reconstruct what happened to an order.

## Issue Coverage Matrix

| Review Issue | Remediation Item |
| --- | --- |
| No rate limiting | 1 |
| No CSRF/origin validation | 2 |
| Public GET creates demo data | 3 |
| Paid-but-unfulfilled payment risk | 4 |
| Email side effects in webhook/request flow | 5 |
| Unpaginated orders/tickets/events | 6 |
| Stale public availability | 7 |
| App-only DB invariants | 8 |
| Denormalized organisation ownership drift | 9 |
| Missing composite indexes | 10 |
| Inconsistent API errors and tenant disclosure | 11 |
| Request-time stale cleanup writes | 12 |
| Ad hoc logging and no alerts | 13 |
| Shared organisation login | 14 |
| `latest` dependency ranges | 15 |
| Missing E2E and real webhook tests | 16 |
| No CI/CD, healthcheck, backups, rollback | 17 |
| Route handlers doing too much | 18 |
| Informal payment lifecycle | 19 |

## Recommended Execution Order

1. Implement P0 security and payment reliability work: items 1 through 5.
2. Add P1 data and scalability hardening: items 6 through 13.
3. Add P2 production operations and staff-account maturity: items 14 through 17.
4. Add P3 architecture refinements only after the system is safer and operationally observable.

## Acceptance Criteria For Production Payments

Thunderstrux should not process unrestricted real payments until all of the following are true:

- Login, signup, checkout, email resend, and sensitive mutations are rate-limited.
- Custom cookie-authenticated mutations enforce CSRF/origin protection.
- Public read routes are read-only.
- Paid-but-unfulfilled sessions trigger refund review or automatic refund compensation.
- Ticket email delivery is outbox-backed and retryable.
- Orders and ticket wallet pages are paginated.
- Database constraints protect core financial and inventory invariants.
- Production has structured logs, metrics, healthchecks, alerts, backups, and tested restore.
- Stripe webhook signature verification is tested against a real signed payload in staging.
- Organisation operations are attributable to named users or the deployment is explicitly limited to a controlled MVP pilot.
