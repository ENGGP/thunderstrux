---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Architecture Overview]]", "[[Frontend and Backend Flow]]", "[[Documentation Index]]"]
sources: [app, components, lib, prisma, scripts, tests, docker, deploy, config, .github, .design-sync, package.json]
---

# Thunderstrux Codebase Map

**Owns:** where code lives: every top-level directory and root file that matters, and one line for every entry directly under `lib/` and `components/` with its key files.
**Read when:** looking for where something is implemented, or deciding where new code goes.
**Not here:** how the pieces fit and the invariants ([[Architecture Overview]]); which page is which ([[Frontend and Backend Flow]]); scripts and commands in use ([[Development Workflow]], [[Production Operations]]).

Thunderstrux is a Docker-first Next.js App Router app for student societies: events and tickets, memberships, merchandise, Stripe Connect payouts, staff and audit. Start with [[Documentation Index]] and [[Project Handover]].

## Top level

| Path | What lives there |
| --- | --- |
| `app/` | App Router pages, layouts and `app/api/**/route.ts` handlers. Route groups `(public)` and `(dashboard)` don't appear in URLs. `app/layout.tsx` (session provider, header, fonts, skip link), `app/globals.css` (tokens), `app/error.tsx`, `app/not-found.tsx`. Page map: [[Frontend and Backend Flow]]; routes: [[API Reference]] |
| `components/` | React components by feature; primitives in `components/ui/` |
| `lib/` | Application services and shared helpers (below). Nothing in `app/` imports Prisma; it calls these |
| `prisma/` | `prisma/schema.prisma`, `prisma/migrations/` (additive, applied by the one-shot migration job), `prisma/seed.mjs` (idempotent dev seed). See [[Database and Multi Tenancy]], [[Seeding and Data]] |
| `scripts/` | Node entry points: workers (`scripts/process-email-outbox.mjs`, `scripts/process-stale-orders.mjs` and the other `process-*` files, each a `.mjs` launcher for a `.ts` body), test runners (`scripts/run-e2e.mjs`, `scripts/run-integration-tests.mjs`, `scripts/run-operations-tests.mjs`) and their guards, operations (`scripts/operations.mjs`, `scripts/droplet.mjs`, `scripts/release-pair.mjs`, `scripts/every-minute.mjs`), maintenance (`scripts/audit-db-integrity.mjs`, `scripts/repair-organisation-drift.mjs`, `scripts/maintain-assets.mjs`), dev helpers (`scripts/clean-next-dev.mjs`, `scripts/doctor-dev.mjs`), and `scripts/check-docs.mjs` |
| `tests/integration/` | Vitest suites against a disposable `_test` database, run sequentially |
| `tests/e2e/` | Playwright specs and `tests/e2e/fixtures.ts`; run by `scripts/run-e2e.mjs` |
| `tests/runner/` | `node:test` checks of scripts, compose and config (guards, schema contract, runtime origin, docs checker) |
| `tests/setup/` | `tests/setup/integration.setup.ts`: Vitest setup that pins test env and resets the database |
| `tests/helpers/` | Integration helpers: auth, `db-reset.ts` (refuses non-`_test` URLs), HTTP, Stripe mocks, MFA, guest, staff invites, test data, `render.ts` (`renderPage`) |
| `docker/` | `docker/Dockerfile` (targets `web`, `ops`, `development`), `docker/Dockerfile.assets` (SeaweedFS), `docker/Dockerfile.e2e`, `docker/entrypoint.sh` (loads `*_FILE` secrets, then `exec`) |
| `deploy/` | `deploy/droplet/`: Caddyfile, cloud-init, droplet compose and config example for the hosted Droplet ([[Production Operations]]) |
| `config/` | `config/schema-contract.json`: the newest migration readiness requires |
| `.github/` | `.github/workflows/` (dependency validation, browser E2E, operations, release images, security audit) and the PR template |
| `.design-sync/` | Design-sync config, previews and notes for `components/ui/` ([[UI Architecture Rules#Design sync]]) |
| `docs/` | PRD, readiness and delivery plans, design and database specs; `docs/obsidian/` is the living vault, `docs/obsidian/History/` dated notes |
| `proxy.ts` | Next proxy: redirects anonymous `/dashboard` and `/account` requests to `/login` |
| `auth.ts` | Auth.js configuration: credentials provider, JWT `authVersion`, live session callback |
| `next.config.ts` | Standalone output to `.next-build` in production, security headers, `/api` cache policy, `/organisations` redirects |
| `docker-compose.yml` | Production-like base: `app`, `migration`, `workers`-profile jobs, `db`, `redis` |
| `docker-compose.dev.yml` | Dev overlay: source mounts, polling, migrations then `pnpm dev`, object store |
| `docker-compose.schedules.yml`, `docker-compose.hosted.yml`, `docker-compose.hardened.yml`, `docker-compose.assets.hosted.yml`, `docker-compose.operations.yml`, `docker-compose.e2e.yml` | Schedules, hosted secrets, hardening, hosted asset storage, operations rehearsals, browser campaign stack |
| `package.json` | Scripts and exact dependency pins (Node and pnpm versions too) |
| `.env.example`, `.env.hosted.example`, `.env.db.example` | Env templates ([[Environment Variables]]) |
| `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.js`, `postcss.config.mjs`, `renovate.json`, `next-auth.d.ts` | Tool configuration and Auth.js type augmentation |

## lib

| Entry | What | Key files |
| --- | --- | --- |
| `lib/analytics` | Society metrics and ranges in the society zone | `metrics.ts` (`ticketMetrics`, `eventTicketTypeMetrics`, `societySales`, `analyticsAccess`), `range.ts` |
| `lib/api` | Route plumbing: error envelope and mapper, bounded body reads, shared guard rules | `errors.ts` (`mapRouteError`), `request.ts`, `route-rules.ts` |
| `lib/app-url.ts` | Public origin read at run time (`appUrl`) | |
| `lib/assets` | Image upload, sanitising, S3 storage, references, maintenance | `service.ts`, `image.ts`, `storage.ts`, `references.ts`, `maintenance.ts` |
| `lib/audit` | Society History from `AuditLog` rows | `history.ts` (`readHistory`, `historyCategories`) |
| `lib/auth` | Sessions, guards, account lifecycle, context selection | `access.ts`, `page-access.ts`, `live-session.ts`, `context.ts`, `account-lifecycle.ts`, `account-closure.ts`, `account-settings.ts`, `email-change.ts`, `credentials.ts`, `secret.ts` |
| `lib/client` | Browser fetch helpers | `api.ts` (`fetchJson`, `fetchWithCsrf`), `checkout.ts` (`waitForAttempt`), `orgs.ts`, `sign-out.ts` |
| `lib/commerce` | Membership and merchandise orders, checkout, webhooks, family registry | `orders.ts`, `checkout.ts`, `families.ts`, `reconciliation.ts`, `binding.ts`, `payment-recovery.ts`, `http.ts` |
| `lib/date-input.ts` | Parsing and formatting for the house date picker | |
| `lib/db` | Prisma client and organisation scope helpers | `index.ts` (`prisma`), `organisation-scope.ts`, `organisation-drift.ts` |
| `lib/email` | Ticket email, notification outbox, templates, encryption | `ticket-delivery.ts`, `ticket-email-outbox.ts`, `notification-outbox.ts`, `templates.ts`, `notification-crypto.ts` |
| `lib/events` | Event lifecycle, inventory locks, readiness, public reads, calendar | `event-lifecycle.ts`, `inventory.ts`, `event-readiness.ts`, `public-events.ts`, `explore-filters.ts`, `calendar.ts`, `event-changes.ts`, `http.ts` |
| `lib/format.ts` | Money, dates in a zone (default `Australia/Brisbane`), order references | |
| `lib/guest` | Verified guest sessions, guest CSRF, claim into an account | `guest-access.ts`, `guest-csrf.ts`, `guest-claim.ts` |
| `lib/memberships` | Plans, offers, grants, roster, revocation, reminders | `plans.ts`, `offers.ts`, `grants.ts`, `roster.ts`, `revocation.ts`, `reminders.ts`, `http.ts` |
| `lib/merchandise` | Catalogue, shop, basket, sale family, pickups, after-sale | `catalogue.ts`, `shop.ts`, `basket.ts`, `sale.ts`, `pickups.ts`, `after-sale.ts`, `http.ts` |
| `lib/ops` | Logging, metrics, alerts, readiness, worker contract, monitor, integrity audit | `logger.ts`, `alerts.ts`, `metrics.ts`, `worker.ts` (`runWorker`), `monitor.ts`, `readiness.ts`, `integrity-audit.ts` |
| `lib/orders` | Staff order reads and actions, member ticket orders, stale order expiry | `grouped-orders.ts`, `order-detail.ts`, `member-tickets.ts`, `stale-orders.ts`, `buyer-identity.ts` |
| `lib/organisations` | Bootstrap, profiles, public reads, discovery, joins, overview | `profile.ts`, `public-organisations.ts`, `discovery.ts`, `join.ts`, `overview.ts`, `bootstrap.ts`, `authority.ts`, `http.ts` |
| `lib/pagination` | Opaque timestamp cursors and page options | `cursor.ts` |
| `lib/payments` | Ticket checkout, attempts and recovery, reconciliation, lifecycle journal, refunds, disputes, compensation, free orders | `checkout-creation.ts`, `checkout-attempts.ts`, `checkout-reconciliation.ts`, `checkout-fulfilment-orchestrator.ts`, `order-lifecycle.ts`, `order-refunds.ts`, `purchase-disputes.ts`, `compensation-refunds.ts`, `dispute-reversals.ts`, `free-ticket-issuance.ts` |
| `lib/payouts` | Manual payouts after events and the money held back | `payouts.ts` (`processPayoutBatch`), `release.ts` |
| `lib/permissions` | Roles and the permission matrix | `index.ts` |
| `lib/purchases` | Buyer purchase reads, projection to buyer-facing status, pending-checkout actions | `ticket-purchases.ts`, `projection.ts`, `pending-checkout.ts`, `pending-checkout-http.ts` |
| `lib/security` | Origin and CSRF guard, rate limits, staff MFA, safe return paths, token cleanup | `request-guard.ts`, `csrf.ts`, `rate-limit.ts`, `staff-mfa.ts`, `safe-return-path.ts`, `token-cleanup.ts` |
| `lib/staff` | Live staff authority, staff management, invitations, owner handover | `live-authority.ts`, `management.ts`, `invites.ts`, `invite-http.ts`, `handover.ts` |
| `lib/stripe` | Stripe client, Connect lifecycle, fees, API version | `index.ts` (`getStripe`), `connect.ts`, `fees.ts` (`calculatePlatformFee`), `version.ts`, `http.ts` |
| `lib/tickets` | Reservations and purchase transaction options, check-in | `reservations.ts`, `check-in.ts`, `http.ts` |
| `lib/transaction-conflict.ts` | Recognises retryable PostgreSQL conflicts (`isTransactionConflict`) | |
| `lib/validators` | zod request schemas | `events.ts`, `payments.ts`, `auth.ts`, `orgs.ts`, `staff.ts`, `stripe-connect.ts`, `price.ts`, `slug.ts` |
| `lib/zoned-time.ts` | Wall-clock times in a society zone (`zonedCandidates`, `zoneCity`) | |

## components

| Entry | What | Key files |
| --- | --- | --- |
| `components/account` | Account settings forms | `member-profile-form.tsx`, `change-password-form.tsx`, `change-email-form.tsx`, `notification-preferences-form.tsx`, `close-account-form.tsx` |
| `components/analytics` | Charts | `bar-chart.tsx` |
| `components/auth` | Sign-in, signup, verification, recovery, email change, staff invite and MFA forms | `credentials-login-form.tsx`, `signup-form.tsx`, `staff-mfa-form.tsx`, `account-link-token.ts` |
| `components/calendar` | Society calendar grids and date helpers | `calendar-views.tsx`, `layout.ts` |
| `components/commerce` | Shared commerce notices | `stripe-review-notice.tsx` |
| `components/events` | Event builder, workspace header and actions, public event view and buy box, cards | `create-event-form.tsx`, `event-tabs.tsx`, `event-actions.tsx`, `public-event-view.tsx`, `public-ticket-purchase.tsx`, `event-card.tsx`, `date-rail.tsx`, `readiness-checklist.tsx`, `members-only-gate.tsx`, `explore-filter-fields.tsx` |
| `components/guest` | Guest email, access and claim | `guest-email-form.tsx`, `guest-access-form.tsx`, `guest-claim.tsx` |
| `components/layout` | Header, footer, shells, page header, switcher, verify banner | `navbar.tsx`, `site-footer.tsx`, `dashboard-shell.tsx`, `personal-shell.tsx`, `auth-shell.tsx`, `checkout-shell.tsx`, `page-header.tsx`, `context-selector.tsx`, `verify-email-banner.tsx`, `auth-session-provider.tsx` |
| `components/memberships` | Plan form, checklist and actions; member actions; checkout action | `plan-form.tsx`, `plan-actions.tsx`, `plan-checklist.tsx`, `membership-actions.tsx`, `membership-checkout-action.tsx` |
| `components/merchandise` | Shop, basket, checkout, product form and actions, pickup and order actions | `shop.tsx`, `checkout.tsx`, `product-form.tsx`, `product-actions.tsx`, `pickup-action.tsx`, `order-actions.tsx` |
| `components/orders` | Staff order detail actions | `order-detail-actions.tsx`, `order-review-actions.tsx` |
| `components/organisations` | Society cards, header, join controls, search, joined list, creation | `society-header.tsx`, `society-join-card.tsx`, `society-join.tsx`, `society-card.tsx`, `organisation-search.tsx`, `member-organisations-list.tsx`, `create-organisation-form.tsx` |
| `components/public` | Policy page layout for Fees, Help, Privacy | `policy-page.tsx` |
| `components/purchases` | Ticket checkout action, money summary, payment poller, unpaid-order actions and notices | `checkout-action.tsx`, `money-summary.tsx`, `payment-status-poller.tsx`, `unpaid-order-actions.tsx`, `unpaid-order-notice.tsx`, `ticket-order-notice.tsx` |
| `components/settings` | Society profile, staff, handover, Stripe Connect, payouts, failed emails | `society-profile.tsx`, `staff-management.tsx`, `staff-handover.tsx`, `stripe-connect-settings.tsx`, `payouts-card.tsx`, `failed-notifications.tsx` |
| `components/tickets` | Check-in console and the buyer's ticket face | `check-in-console.tsx`, `ticket-face.tsx` |
| `components/ui` | Shared primitives ([[UI Architecture Rules#Primitives]]) | `button.tsx`, `input.tsx`, `date-field.tsx`, `notice.tsx`, `status-badge.tsx`, `link-tabs.tsx`, `responsive-table.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`, `filter-bar.tsx`, `audit-timeline.tsx`, `skeleton.tsx`, `card.tsx`, `icon.tsx` |

## Traps

- `app/(dashboard)/dashboard/events/layout.tsx` and `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx` are pass-through layouts kept on purpose as explicit route boundaries; don't delete them as dead code ([[Troubleshooting]]).
- Worker entry points import only database-level modules (no HTTP auth or CSRF config); keep new worker code out of `lib/*/http.ts` and route helpers.
- Feature components import `next/*` and server `lib/*`; only `components/ui/` stays self-contained enough for design sync.
- Production builds write `.next-build`, dev writes `.next`; never point one at the other.

## Related

[[Architecture Overview]] · [[Frontend and Backend Flow]] · [[UI Architecture Rules]] · [[Development Workflow]] · [[Production Operations]] · [[Database and Multi Tenancy]]
