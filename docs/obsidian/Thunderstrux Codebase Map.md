# Thunderstrux Codebase Map

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies. The current product scope is:

- Email/password authentication with Auth.js credentials.
- Multi-tenant organisations with membership roles.
- Dashboard organisation selection at `/dashboard`.
- Organisation dashboard routes under `/dashboard/[orgSlug]`.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Public event discovery and public event detail pages.
- Stripe Checkout ticket purchase flow for published events.
- Stripe Connect Express onboarding and readiness checks.
- Webhook-driven order reconciliation, ticket issuance, and inventory reduction.
- Idempotent development seed data.

Not implemented:

- Email verification.
- Password reset.
- Invites or join requests.
- Refund management UI.
- QR codes or check-in.
- File uploads.

## Start Here

Read these in order:

1. [[2026-04-24]]
2. [[Architecture Overview]]
3. [[Development Workflow]]
4. [[Troubleshooting]]
5. [[Database and Multi Tenancy]]
6. [[Frontend and Backend Flow]]
7. [[Stripe Payments and Connect]]
8. [[Seeding and Data]]
9. [[UI Architecture Rules]]

## Key Directories

```text
app/
  layout.tsx                         Root layout, session provider, global navbar
  page.tsx                           Public homepage: Discover Events
  (public)/events/[eventId]/         Public event detail route
  (dashboard)/dashboard/             Dashboard route group
  api/                               Route handlers

components/
  auth/                              Login and signup forms
  events/                            Event list, event form, public checkout UI
  layout/                            Navbar, session provider, DashboardShell
  orgs/                              Organisation creation form
  settings/                          Stripe Connect settings UI
  ui/                                Small reusable primitives

lib/
  auth/                              Auth/session and organisation access helpers
  api/                               API error helpers
  client/                            Frontend fetch and helper utilities
  db/                                Prisma client and organisation scoping helpers
  events/                            Public event loading and demo event fallback
  permissions/                       Role permission helpers
  stripe/                            Stripe SDK, Connect, and fee helpers
  validators/                        Zod schemas

prisma/
  schema.prisma                      Database schema
  seed.mjs                           Idempotent local development seed
  migrations/                        Applied schema migrations

docs/obsidian/
  *.md                               Internal project documentation
```

## High-Value Rules

- Navigation for organisation dashboards belongs in `components/layout/dashboard-shell.tsx`.
- Page files should render route-specific content only.
- Private APIs must derive access from the authenticated session and database membership rows.
- Do not trust frontend `organisationId` or `x-org-id` as authority. They are inputs, not trust boundaries.
- Payment fulfilment happens only from Stripe webhooks.
- Tailwind uses the v4 CSS entrypoint in `app/globals.css`.
- Docker development uses Webpack plus polling because Turbopack was unreliable in this setup.

## Current UI State

- Global header is fixed at the top via `components/layout/navbar.tsx`.
- Dashboard shell uses a fixed left sidebar below the global header and a content header that shows the organisation name.
- `/dashboard/[orgSlug]` now shows the organisation name, not the slug.
- Sidebar contains only `Dashboard`, `Events`, and `Settings`.
- Primary dashboard buttons use `bg-neutral-900 text-white hover:bg-neutral-700`.

## Current Known Quirks

- `DashboardShell` hardcodes the active nav item state, so `Dashboard` is always styled as active even when the user is on `Events` or `Settings`.
- `/dashboard/[orgSlug]/events/new` still renders a page heading `Create Event` above the form title `New event`. This is a UI inconsistency, not a backend issue.
- `app/page.tsx` uses `export const dynamic = "force-dynamic"` to avoid stale homepage output during development.
