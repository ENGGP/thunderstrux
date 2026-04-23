# Thunderstrux Codebase Map

Thunderstrux is a Docker-based Next.js App Router SaaS foundation for student societies.

## Start Here

- [[Architecture Overview]]
- [[Development Workflow]]
- [[Troubleshooting]]
- [[Database and Multi Tenancy]]
- [[Seeding and Data]]
- [[UI Architecture Rules]]
- [[Event Lifecycle]]
- [[Stripe Payments and Connect]]
- [[Authentication and Dashboard Access]]
- [[API Reference]]

## Implemented Product Scope

Currently implemented:

- Email/password signup and login with Auth.js credentials.
- Multi-tenant organisations.
- Organisation membership roles.
- Dashboard organisation selection at `/dashboard`.
- Organisation dashboard routes under `/dashboard/[orgSlug]`.
- Organisation event management.
- Draft and published event lifecycle.
- Public event discovery at `/`.
- Public event detail pages at `/events/[eventId]`.
- Stripe Checkout ticket purchase flow.
- Stripe Connect Express onboarding/status for organisations.
- Webhook-driven order reconciliation, ticket issuance, and inventory reduction.
- Idempotent development seed data.

Not implemented:

- Email verification.
- Password reset.
- Invites or join requests.
- File uploads.
- AI agent APIs.
- Refund management UI.
- Ticket QR codes or attendee check-in.

## Key Directories

```text
app/
  layout.tsx                         Root layout, auth session provider, navbar
  page.tsx                           Public homepage: Discover Events
  (public)/events/[eventId]/         Public event detail route
  (dashboard)/dashboard/             Dashboard route group
  api/                               Backend route handlers

components/
  auth/                              Login and signup forms
  events/                            Event list, event form, public checkout UI
  layout/                            Navbar, session provider, DashboardShell
  orgs/                              Organisation creation form
  settings/                          Stripe Connect settings UI
  ui/                                Small reusable UI primitives

lib/
  auth/                              Session and organisation access helpers
  api/                               Request parsing and API error helpers
  client/                            Frontend fetch/date/role helpers
  db/                                Prisma client and scoping helpers
  events/                            Shared public event loaders
  permissions/                       Role permission helpers
  stripe/                            Stripe SDK, Connect, fee helpers
  validators/                        Zod schemas

prisma/
  schema.prisma                      Database schema
  seed.mjs                           Idempotent local development seed
  migrations/                        Applied schema migrations

docs/obsidian/
  *.md                               Internal project documentation

tailwind.config.js                   Tailwind CSS v4 content configuration
```

## High-Value Rules

- Dashboard navigation for `/dashboard/[orgSlug]` belongs in `components/layout/dashboard-shell.tsx`.
- Page files render page-specific content only.
- Private APIs must derive access from the authenticated session and database membership rows.
- Frontend-provided organisation IDs are inputs, not authority.
- Public APIs expose only published, public-safe event data.
- Payment fulfilment happens only from Stripe webhooks.
- Development data can be restored with `docker compose exec app pnpm seed`.
- Tailwind v4 must be loaded through `@import "tailwindcss"` in `app/globals.css`.
