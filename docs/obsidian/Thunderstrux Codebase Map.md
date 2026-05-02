# Thunderstrux Codebase Map

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies. The current product scope is:

- Email/password authentication with Auth.js credentials.
- Two account roles: `member` and `organisation`.
- Member profile onboarding, organisation search/join/leave, public organisation details, public event browsing, ticket purchase, and `/tickets`.
- Organisation accounts manage exactly one organisation directly at `/dashboard`.
- Organisation management routes under `/dashboard/events`, `/dashboard/orders`, and `/dashboard/settings`.
- Legacy `/dashboard/[orgSlug]/*` routes retained as compatibility redirects.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Public event discovery and public event detail pages.
- Stripe Checkout ticket purchase flow for published events.
- Stripe Connect Express lifecycle with state-based onboarding UX.
- Webhook-driven order reconciliation, ticket issuance, and inventory reduction.
- Idempotent development seed data.

Not implemented:

- Email verification.
- Password reset.
- Staff invites or multi-user organisation staff access.
- Refund management UI.
- QR codes or check-in.
- File uploads.

For MVP, organisation committee members may share one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

## Start Here

Read these in order:

1. [[Current Handover]]
2. [[Architecture Overview]]
3. [[Development Workflow]]
4. [[Troubleshooting]]
5. [[Database and Multi Tenancy]]
6. [[Frontend and Backend Flow]]
7. [[Stripe Payments and Connect]]
8. [[Seeding and Data]]
9. [[UI Architecture Rules]]

Dated handover files are historical records:

- [[Handover 2026-04-24]]
- [[Handover 2026-04-27]]

## Key Directories

```text
app/
  layout.tsx                         Root layout, session provider, global navbar
  page.tsx                           Public homepage: Discover Events
  (public)/events/[eventId]/         Public event detail route
  (public)/organisations/[orgSlug]/  Public-safe organisation details route
  (dashboard)/dashboard/             Role-aware dashboard route group
    page.tsx                         Member dashboard or organisation dashboard
    create/page.tsx                  Organisation onboarding
    organisations/page.tsx           Member organisation search/join
    events/                          Slugless organisation event management
    orders/page.tsx                  Slugless organisation order review
    settings/page.tsx                Slugless organisation settings
    [orgSlug]/                       Legacy redirects
  api/                               Route handlers

components/
  auth/                              Login and signup forms
  events/                            Event list, event form, public checkout UI
  layout/                            Navbar, session provider, DashboardShell
  members/                           Member profile and organisation search UI
  orgs/                              Organisation creation form
  settings/                          Stripe Connect settings UI
  ui/                                Small reusable primitives

lib/
  auth/                              Auth/session and account/organisation access helpers
  api/                               API error helpers
  client/                            Frontend fetch and helper utilities
  db/                                Prisma client and organisation scoping helpers
  events/                            Public event loading and demo event fallback
  orders/                            Grouped orders and stale pending order cleanup
  payments/                          Shared Checkout reconciliation helper
  permissions/                       Legacy role permission helpers
  stripe/                            Stripe SDK, Connect, and fee helpers
  validators/                        Zod schemas

prisma/
  schema.prisma                      Database schema
  seed.mjs                           Idempotent local development seed
  migrations/                        Applied schema migrations

tests/
  helpers/                           Integration test auth, DB, HTTP, Stripe, and data helpers
  integration/                       Functional/API integration test suites
  setup/                             Vitest integration setup and runtime guards

docs/obsidian/
  *.md                               Internal project documentation
```

## High-Value Rules

- `Organisation` remains the tenant/payment/event/order boundary.
- Organisation dashboard access comes from `User.accountRole = organisation` plus `Organisation.accountUserId`.
- Member join relationships use `OrganisationMember`.
- `OrganisationMember` is not MVP staff access.
- Navigation for organisation dashboards belongs in `components/layout/dashboard-shell.tsx`.
- Private APIs must derive access from the authenticated session and server-side database ownership checks.
- Do not trust frontend `organisationId` or `x-org-id` as authority. They are inputs, not trust boundaries.
- Production payment fulfilment happens only from Stripe webhooks.
- Non-production `/success?session_id=...` can call the shared reconciliation helper when local webhook forwarding is missing.
- Tailwind uses the v4 CSS entrypoint in `app/globals.css`.
- Base Docker Compose is production-like; Docker development uses `docker-compose.dev.yml` with Turbopack plus polling.
- Runtime migrations run through `pnpm prisma:migrate:deploy` in `docker/entrypoint.sh`.
- Integration tests run through Vitest against the disposable `thunderstrux_test` database, never the normal development database.
- Integration tests must stay sequential because they reset shared database state.
- `pnpm dev` clears `.next/dev` before startup via `scripts/clean-next-dev.mjs`.
- Production builds write to `.next-build`; dev writes to `.next`.
- Recreate the app container after running `pnpm build` inside a live production-like `next start` container, because `.next-build` can change while the server still holds the old build manifest.
- Keep explicit events route boundaries for both current and legacy event routes:
  - `app/(dashboard)/dashboard/events/layout.tsx`
  - `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`
- Stripe Connect readiness is represented by lifecycle states, not by the word "connected" alone.
- Current Stripe Connect states are `NOT_CONNECTED`, `PLATFORM_NOT_READY`, `CONNECTED_INCOMPLETE`, `RESTRICTED`, `READY`, and `ERROR`.

## Current UI State

- Global header is fixed at the top via `components/layout/navbar.tsx`.
- Organisation dashboard shell uses a fixed left sidebar below the global header and a content header that shows the organisation name.
- Organisation dashboard primary route is `/dashboard`.
- Sidebar contains `Dashboard`, `Events`, `Orders`, and `Settings`.
- Member dashboard does not use the organisation management sidebar.
- Primary dashboard buttons use `bg-neutral-900 text-white hover:bg-neutral-700`.
- Stripe settings renders a state-based Connect panel with connect, platform settings, retry, continue onboarding, fix account, open dashboard, refresh status, and local disconnect controls.

## Current Known Quirks

- `DashboardShell` hardcodes the active nav item state, so `Dashboard` is always styled as active even when the user is on `Events` or `Settings`.
- `/dashboard/events/new` still renders a page heading `Create Event` above the form title `New event`.
- `app/page.tsx` uses `export const dynamic = "force-dynamic"` to avoid stale homepage output during development.
- Stripe account disconnect is local-only. It clears Thunderstrux organisation Stripe fields but does not delete the account in Stripe. Reconnecting the same old account requires manually restoring the old `acct_...` id in the DB.
- Event edit routes rely on explicit pass-through `events/layout.tsx` files because Next dev route registration was unreliable for nested event routes without them in the local Docker/Windows/OneDrive setup.
- Edit mode allows ticket type quantity `0`; create mode does not. This supports sold-out inventory while still preventing zero-inventory new events.
- Ticket types with orders or issued tickets can have name, price, and quantity edited for future purchases, but cannot be removed.
- Running integration tests requires the dev Compose override so the `tests/` directory is bind-mounted into the app container.
