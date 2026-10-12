---
status: living
last-reviewed: 2026-10-12
owner: engineering
related: ["[[Thunderstrux Codebase Map]]", "[[Frontend and Backend Flow]]"]
sources: [package.json, prisma/schema.prisma, docker-compose.yml]
---

# Architecture Overview

## Stack

- Next.js 16.3.8 App Router
- React 19
- TypeScript
- Prisma ORM 6.19.3
- PostgreSQL 16
- Auth.js / NextAuth 5.0.0-beta.32 credentials provider
- Stripe Checkout
- Stripe Connect Express
- Zod validation
- Tailwind CSS v4
- Docker Compose
- Node 22.23.3 and pnpm 10.34.6
- Sharp 0.35.5 for safe static WebP processing; AWS S3 SDK 3.1149.0 for bounded object storage. Local development uses patched SeaweedFS 4.48; hosted storage is separately configured.

Security updates, scoped Prisma override, removal conditions, and verification: [[Dependency Automation]].

## Runtime Shape

```text
Browser
  -> Next.js App Router pages and layouts
  -> Client components submit forms and call route handlers
  -> Route handlers validate input and enforce auth/tenancy
  -> Mutation guards enforce trusted origins and selected abuse limits
  -> Application services execute domain use cases
  -> Services use Prisma and external providers
  -> Stripe webhooks reconcile reservations, payments, tickets, and account readiness
```

## Application Service Boundary

Security-sensitive routes are transport adapters. They retain request parsing, trusted-origin checks, authentication, permission and tenant checks, rate limiting, and HTTP error mapping. Domain decisions, persistence, transactions, recovery, and provider composition live in application services:

- `lib/payments/checkout-creation.ts`: checkout validation, reservation/order creation, Stripe session creation, and failure recovery.
- `lib/payments/checkout-reconciliation.ts`: completed and expired Checkout reconciliation.
- `lib/payments/order-lifecycle.ts`: locked append-only business transition journal.
- `lib/payments/order-lifecycle-history.ts`: tenant-scoped operator timeline and cursor parsing.
- `lib/events/event-lifecycle.ts`: organisation-scoped event reads, create/edit, ticket-type changes, publish/unpublish, and deletion.
- `lib/orders/grouped-orders.ts` and `lib/orders/order-detail.ts`: organisation-scoped order reads, refund marking, and paid-order email resend.
- `lib/tickets/check-in.ts`: ticket attendance reads and mutations.
- `lib/stripe/connect.ts`: Connect lifecycle operations and Stripe/provider composition.
- `lib/auth/account-*`, `lib/auth/context.ts` and `lib/staff`: account lifecycle/version fencing, login-bound personal/staff selection, private invitations and atomic owner handover.
- `lib/assets`: sanitisation, quota reservation, verified S3 bytes, reference-gated reads and recoverable deletion/maintenance.
- `lib/organisations`: bootstrap eligibility, versioned profiles, whitelisted public reads, bounded discovery, caller-only join transactions and the dashboard overview reads.
- `lib/orders/member-tickets.ts`: the caller's own paid orders and issued tickets for `/tickets`.
- `lib/format.ts`: the single money and date formatter; dates take the society's IANA zone and default to `Australia/Brisbane`.

Server pages and route adapters do not import Prisma. Pages call the same read services as the API routes, never their own HTTP endpoints, and `tests/integration/domain-service-boundaries.test.ts` fails if any file under `app/` reaches the database directly. Routes map failures through `mapRouteError` (`lib/api/errors.ts`) with shared guard rules in `lib/api/route-rules.ts`; event, order, ticket, Connect and payment routes keep their established catch blocks (API-001).

Application services accept already-authorized tenant identifiers. Routes must perform live server-side permission checks before calling them. The services still scope every persistence operation by the authoritative organisation or event owner; they do not trust client claims.

Docker runtime:

- base `docker-compose.yml` runs the production-like image with `pnpm start`; `ops:deploy` runs the separate one-shot migration service before starting a candidate
- `docker/entrypoint.sh` only drops into the configured container command and does not own migrations
- `docker-compose.dev.yml` adds source bind mounts, polling, the host database port, and runs `pnpm prisma:migrate:deploy` before `pnpm dev`
- Redis 7 is available for central rate limiting when `RATE_LIMIT_ENABLED=true`
- Development object-store persists sanitised bytes in asset_data. PostgreSQL stores metadata/references; restore needs both. Hosted asset secrets use docker-compose.assets.hosted.yml. [[Society Profiles and Assets]] owns this boundary.

## Product Account Model

`User.accountRole` is exactly one of:

- `member`
- `organisation`

Member accounts represent people. Live verified identity is required for joins and purchases. Active named staff can manage permitted organisations regardless of accountRole; ordinary member joins never grant that authority.

Organisation management normally resolves an active `OrganisationStaff` record and its live role and permissions. Named staff accounts, invitations, revocation, TOTP MFA, recovery codes, and actor-attributed audit records are implemented.

`Organisation.accountUserId` remains an explicitly configured legacy migration fallback. Production activation requires staff enrollment, enforced MFA, and `LEGACY_ORGANISATION_ACCESS_MODE=deny` after migration.

## App Router Structure

Route groups are filesystem-only. `(dashboard)` and `(public)` do not appear in URLs.

```text
app/
  layout.tsx
  page.tsx
  login/page.tsx
  signup/page.tsx
  success/page.tsx
  cancel/page.tsx
  (public)/
    organisations/page.tsx           Anonymous society directory
    organisations/[orgSlug]/page.tsx Public profile and personalized join control
    events/[eventId]/page.tsx
  (dashboard)/
    dashboard/
      page.tsx                         Role-aware member/org dashboard
      create/page.tsx                  Organisation-account onboarding
      organisations/page.tsx           Member organisation search/join
      events/layout.tsx                Explicit route boundary
      events/page.tsx                  Organisation event list
      events/[eventId]/page.tsx        Organisation event analytics
      events/new/page.tsx              Organisation event creation
      events/[eventId]/edit/page.tsx   Organisation event editing
      orders/page.tsx                  Organisation order review
      settings/page.tsx                Organisation settings/Stripe Connect
      settings/profile/page.tsx        Resumable public profile setup
      settings/staff/page.tsx          Private invitations and owner handover
      notifications/page.tsx           Scoped failed-business-job recovery
      [orgSlug]/                       Legacy compatibility redirects
  api/
```

## Layout Responsibilities

`app/layout.tsx`

- Loads the auth session on the server.
- Wraps the tree in `AuthSessionProvider`.
- Renders the fixed global `Navbar`.
- Offsets page content with `pt-16` so content does not sit under the fixed header.

`app/(dashboard)/dashboard/page.tsx`

- Resolves the signed personal/staff context against live identity, authority and MFA.
- Member accounts start personal, including named staff; the context selector explicitly chooses an authorised society.
- Resolves the current staff organisation, with the configured legacy-owner fallback during migration, and renders its management dashboard.
- Redirects organisation accounts without an organisation to `/dashboard/create`.

`components/layout/dashboard-shell.tsx`

- Renders the fixed left sidebar below the global header for organisation dashboards.
- Renders the organisation heading row.
- Owns shared organisation dashboard nav.
- Uses slugless `/dashboard/*` paths for current organisation management routes.

`app/(dashboard)/dashboard/[orgSlug]/layout.tsx`

- Compatibility layout only.
- Keeps old nested slug routes available as redirect targets.
- Does not own the dashboard shell.

## Page Responsibilities

`/dashboard`

- Personal member mode shows profile completion, joined organisations, public events and ticket/search links. Selected staff mode shows only permitted management content; revocation never falls back to another tenant.
- Authorised organisation context shows upcoming events and role-filtered recent orders/monthly revenue. Finance queries are omitted when orders:read is absent.

`/dashboard/events`

- Requires events:read. Editable roles use EventsList; finance receives a bounded read-only event list, and check-in staff receive published-only attendance links. The generic management event API still requires events:manage.

`/dashboard/events/[eventId]`

- Renders organisation-only event details and analytics.
- Shows event metadata, sold/remaining counts and ticket-type analytics; finance-capable callers additionally receive revenue.
- Uses the management-page helper to verify live analytics:read authority and conceal foreign events; orders:read separately controls financial fields/queries. The proxy does not deny all member-role users.

`/dashboard/events/new`

- Renders the event creation form for an authorised management user.

`/dashboard/events/[eventId]/edit`

- Renders the event edit form after verifying live authority for the event's canonical organisation.

`/dashboard/orders`

- Renders organisation-scoped order and payment review.
- Supports event-scoped filtering through `eventId`.

`/dashboard/settings`

- Renders Stripe Connect settings UI.
- The UI is state-driven from the backend Connect lifecycle: `NOT_CONNECTED`, `PLATFORM_NOT_READY`, `CONNECTED_INCOMPLETE`, `RESTRICTED`, `READY`, and `ERROR`.

`/dashboard/organisations`

- Member-only personal joined list and paged search/join/leave page, also available to named member staff without changing context. Server refresh updates both joined cards and badges.

`/organisations` is anonymous bounded discovery by literal name/slug, with public-safe cards and stable name/ID cursors. `/dashboard/settings/profile` requires live settings permission/MFA and saves explicit editable public fields with optimistic conflicts; profile completion is separate from Stripe readiness.

`/organisations/[orgSlug]`

- Public-safe organisation details page.
- Shows name, description, public contact/policies/timezone, ready logo/cover and at most 50 upcoming published events. Incomplete profiles remain visible.
- Does not expose members, Stripe fields, or management actions.
- Dynamic join controls use only the caller's affiliation: anonymous sign-in callback, verification prompt, explicit verified Join or Joined. Free affiliation grants neither staff authority nor paid benefits.

`/dashboard/[orgSlug]/*`

- Legacy compatibility routes.
- Redirect to the matching slugless organisation dashboard route when the caller has live authority for the slug.
- Return not found when ownership does not match.

## Authentication Model

- Auth uses the Credentials provider in `auth.ts`.
- Passwords are stored hashed with bcrypt.
- JWT login establishes userId, authVersion and a random MFA login ID. Session/route checks compare the version to a live active identity; refresh never upgrades a revoked session.
- Session callback exposes live identity, accountRole, authVersion and the login-bound MFA ID. See [[Authentication and Dashboard Access]] for verified identity, recovery, email changes and permanent closure.
- Custom sign-in page is `/login`.
- `lib/auth/secret.ts` resolves `AUTH_SECRET` once for both `auth.ts` and `proxy.ts`.

## Request Protection Model

Custom cookie-authenticated mutation routes use two central protections:

- `lib/security/request-guard.ts` validates first-party Origin/Referer and session-bound CSRF for authenticated mutations. Exact anonymous signup/verification/recovery exceptions use origin, token authority and fail-closed limits.
- `lib/security/rate-limit.ts` applies Redis-backed fixed-window rate limits to high-abuse routes.

The rate limiter hashes bucket parts before constructing Redis keys. It does not store raw emails, user IDs, order IDs, tokens, cookies, passwords, Redis URLs, or unhashed bucket keys.

Failure policy:

- Login, signup, verification, recovery, account-security mutations, staff MFA, organisation creation, profile writes and asset upload/delete fail closed when required rate limiting is unavailable.
- Checkout creation, ticket email resend, organisation join/leave, ticket check-in/check-out, and Stripe Connect browser mutations fail open with a structured warning when rate limiting is unavailable.

Stripe webhook routes are deliberately excluded from both protections because they verify Stripe signatures against the raw request body.

## Operational Logging

Thunderstrux has a small structured operations foundation in `lib/ops/logger.ts`, `lib/ops/metrics.ts`, and `lib/ops/alerts.ts`.

- Logs are emitted as one JSON object per console line with `level`, `event`, `timestamp`, `service`, and `environment`.
- Redaction is applied by default to sensitive keys such as cookies, authorization headers, tokens, passwords, secrets, raw bodies, payloads, and email HTML.
- Operational alerts use stable event names such as `paid_but_unfulfilled_compensation_required`, `email_outbox_retry_exhausted`, `checkout_session_creation_failure`, `stripe_webhook_signature_failure`, `stale_order_worker_failed`, `db_migration_failed`, and `app_healthcheck_failed`.
- P1.13 MVP structured logging is implemented for the health endpoint, alerts, payment/webhook/checkout paths, email outbox, stale cleanup, rate limiting, and trusted-origin guard.
- Alert records use the alert name as the structured `event` value, so operators should query alert names directly.
- `db_migration_failed` and `app_healthcheck_failed` are reserved operational alert names. They are not emitted by app runtime code yet; deployment and monitoring must own migration failure and healthcheck non-200 alerting.
- Console JSON is the MVP transport. Production must route these logs into an aggregation and alerting system before relying on them operationally.

## Multi-Tenancy Model

- `Organisation` remains the tenant, event owner, order owner, ticket owner, and Stripe Connect owner.
- Organisation dashboard access is resolved from active `OrganisationStaff` authority and live permissions. The legacy `Organisation.accountUserId` path is available only under the configured migration mode.
- Member join relationships use `OrganisationMember`.
- `OrganisationMember` is not staff access for the MVP, although legacy compatibility rows may still exist.
- `Organisation.slug` remains a stable identifier for compatibility, public display, and lookup APIs.
- The frontend may send `organisationId`, but backend permission checks must still verify the authenticated account and organisation ownership.

## Ticket Reservation Model

Checkout uses soft holds to prevent overselling:

- `TicketType.quantity` remains remaining inventory.
- `TicketReservation` holds a requested quantity for 30 minutes.
- Checkout availability is `TicketType.quantity - activeReservedQuantity`.
- Stripe Checkout `expires_at` is aligned with the reservation expiry.
- Webhooks confirm, release, or expire reservations while preserving `Order` history.
- A bounded one-shot stale-order worker expires pending orders whose reservations are expired or past `expiresAt`, plus legacy reservationless pending orders older than 30 minutes. Normal read paths do not run this cleanup.
- `pending` is kept internally for checkout reconciliation but hidden from normal member and organiser UX.

## Organiser Analytics Model

Organiser event analytics are derived from existing event, ticket type, and paid order data.

- `TicketType.quantity` is displayed as remaining inventory.
- Sold count is summed from paid `Order.quantity`.
- Revenue is summed from paid `Order.totalAmount`.
- Revenue-over-time is grouped by UTC day for charting.
- The analytics page does not show total capacity because original capacity is not stored.
- Each order maps to one ticket type through `Order.ticketTypeId`, so ticket-type revenue is grouped by `ticketTypeId`.

## Styling Pipeline

Tailwind is configured with:

```text
tailwind.config.js
app/globals.css
```

Current Tailwind v4 entrypoint:

```css
@config "../tailwind.config.js";
@import "tailwindcss";
```

Content paths:

```js
content: [
  "./app/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}"
]
```

## Stripe Connect Boundary

Stripe Connect integration is split deliberately:

- `lib/stripe/index.ts` owns Stripe SDK initialisation and webhook secret access.
- `lib/stripe/connect.ts` owns high-level onboarding, continuation, status refresh, Express account creation, platform-readiness detection, lifecycle mapping, and local disconnect.
- API routes own authentication, role checks, validation, and structured JSON responses.
- `components/settings/stripe-connect-settings.tsx` owns the user guidance and action buttons.

The platform owns the UX. Stripe owns compliance and sensitive onboarding data collection.

`PLATFORM_NOT_READY` means the Stripe platform account behind `STRIPE_SECRET_KEY` cannot yet create Express accounts. It is shown before a connected account exists and links the operator to:

```text
https://dashboard.stripe.com/settings/connect/platform-profile
```

## Checkout Reconciliation Boundary

Checkout fulfilment is shared through:

```text
lib/payments/checkout-reconciliation.ts
```

Checkout creation and pre-redirect recovery are owned separately by `lib/payments/checkout-creation.ts`. The route keeps origin, schema, member-authentication, and rate-limit checks before invoking that service.

Production fulfilment remains webhook-driven through `POST /api/payments/webhook`. The `/success` page has a non-production-only fallback that retrieves the Checkout Session by `session_id` and calls the same reconciliation helper when local webhook forwarding is missing.
