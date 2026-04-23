# Thunderstrux Codebase Map

This folder is an Obsidian-friendly set of notes for the Thunderstrux codebase.

## Start Here

- [[Architecture Overview]]
- [[Frontend and Backend Flow]]
- [[API Reference]]
- [[Database and Multi Tenancy]]
- [[Stripe Payments and Connect]]
- [[Event Lifecycle]]
- [[Authentication and Dashboard Access]]
- [[Development Workflow]]
- [[Troubleshooting]]

## Project Summary

Thunderstrux is a Docker-based Next.js SaaS foundation for student societies.

The current product supports:

- Multi-tenant organisations
- Email/password authentication for dashboard access
- Dashboard pages for organisation event management
- Public event discovery
- Public event detail pages
- Stripe Checkout ticket purchase flow
- Stripe Connect onboarding for organisations
- Explicit draft/published event lifecycle controls
- Webhook-driven payment fulfilment
- Ticket issuance and inventory reduction

The system is intentionally incremental. Email verification, password reset, file storage, AI agents, and advanced Stripe Connect payout logic are not implemented yet.

## Key Directories

```text
app/
  page.tsx                         Public homepage: Discover Events
  (public)/events/[eventId]/       Public event detail page
  (dashboard)/dashboard/           Dashboard org selection and onboarding
  (dashboard)/dashboard/create/    Create organisation page
  (dashboard)/dashboard/[orgSlug]/ Dashboard pages
  api/                             Backend route handlers

components/
  events/                          Event list, create form, public ticket purchase
  layout/                          Global navbar, session provider, dashboard shell
  orgs/                            Organisation create form
  settings/                        Stripe Connect settings UI
  ui/                              Small reusable UI primitives

lib/
  auth/                            Session and organisation access helpers
  api/                             Error/request helpers
  client/                          Frontend fetch/date/role helpers
  db/                              Prisma client and org scoping helpers
  permissions/                     Role permission helpers
  stripe/                          Stripe SDK, Connect, fee helpers
  validators/                      Zod schemas and validation helpers

prisma/
  schema.prisma                    Database schema
  migrations/                      Applied schema migrations
```

## Important Rule Of Thumb

Organisation-scoped private/dashboard APIs require tenant scoping. Public discovery APIs only return published, public-safe data.

Checkout no longer trusts the frontend for `organisationId`. It resolves the event and organisation server-side from `eventId`.

Dashboard event lists expect `GET /api/events` to include `ticketTypes`. The frontend is also defensive and treats missing `ticketTypes` as an empty array.

Dashboard access is session-backed. Organisation dashboard APIs use `OrganisationMember` roles from the authenticated user, not frontend `x-org-id` or `x-user-role` headers.

The dashboard root `/dashboard` is the organisation selection and onboarding entry point. Users with no memberships see a create-organisation call to action, and `/dashboard/create` creates an organisation plus an `org_owner` membership for the signed-in user.

Event status is not edited through the general event form. Dashboard publish/unpublish actions call `PATCH /api/events/[eventId]/publish`, which validates ticket readiness before publishing and blocks unpublishing once orders exist.
