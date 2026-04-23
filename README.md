# Thunderstrux

Thunderstrux is a Next.js App Router SaaS foundation for student societies. It supports organisation-scoped dashboards, event management, ticket types, public event discovery, credentials-based authentication, and Stripe-based checkout/connect flows.

## Stack

- Next.js 16 App Router
- React 19
- Auth.js / NextAuth Credentials provider
- Prisma
- PostgreSQL
- Tailwind CSS
- Docker Compose

## Local Development

### Prerequisites

- Docker Desktop
- Node.js and `pnpm` if you want to run commands outside Docker

### Environment

Local development expects a `.env` file. Current important values:

```env
DATABASE_URL=postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
AUTH_SECRET=your-secret
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

Use `http://localhost:3000` for browser-facing URLs. Do not use `0.0.0.0` for auth callbacks.

### Run with Docker

```bash
docker compose up --build
```

App:

- `http://localhost:3000`

Database:

- `localhost:5432`

### Useful Commands

Run Prisma migrations in the app container:

```bash
docker compose run --rm app pnpm exec prisma migrate deploy
```

Seed demo data:

```bash
docker compose run --rm app pnpm prisma:seed
```

Typecheck:

```bash
docker compose run --rm app corepack pnpm exec tsc --noEmit
```

## Authentication

Auth uses the Credentials provider.

- Login page: `/login`
- Signup page: `/signup`
- Protected dashboard routes redirect unauthenticated users to `/login`

Session data includes `session.user.id`, which is used for organisation access and checkout ownership.

## Seeded / Test Accounts

Common local accounts:

- `user1@example.com` / `password123`
- `user2@example.com` / `password123`
- `empty@example.com` / `password123`

Additional one-off e2e test users may exist in the local database if validation scripts were run.

## Main Routes

Public:

- `/` - homepage, published events only
- `/events/[eventId]` - public event page

Auth:

- `/login`
- `/signup`

Dashboard:

- `/dashboard` - organisation selection / onboarding
- `/dashboard/create` - create organisation
- `/dashboard/[orgSlug]` - organisation dashboard
- `/dashboard/[orgSlug]/events` - event list
- `/dashboard/[orgSlug]/events/new` - create event
- `/dashboard/[orgSlug]/events/[eventId]/edit` - edit event
- `/dashboard/[orgSlug]/settings` - organisation settings / Stripe Connect

## Main API Routes

- `GET /api/orgs` - organisations for the authenticated user
- `POST /api/orgs` - create organisation and `org_owner` membership
- `GET /api/events?orgId=...` - organisation-scoped events
- `POST /api/events` - create event with optional ticket types
- `PATCH /api/events/[eventId]` - update event and ticket types
- `PATCH /api/events/[eventId]/publish` - publish/unpublish event
- `DELETE /api/events/[eventId]` - delete event if safe
- `GET /api/public/events` - published public events
- `GET /api/public/events/[eventId]` - published public event detail
- `POST /api/payments/checkout/event` - authenticated checkout start

## Event Lifecycle

- New events start as `draft`
- Draft events are not publicly visible
- Publish/unpublish is handled through `PATCH /api/events/[eventId]/publish`
- Publishing requires at least one ticket type and total quantity greater than zero
- Unpublishing is blocked if orders already exist

## Checkout Notes

Checkout is authenticated and server-scoped:

- The API resolves `organisationId` from the event, not the client
- The pending order is linked to `session.user.id`
- Validation checks event status, ticket type, and inventory before Stripe readiness

To complete checkout locally, the organisation must have a Stripe-ready connected account and Stripe env vars must be configured.

## Troubleshooting

### Route Exists But Returns 404 In Dev

If an App Router page exists in source but still returns 404, clear the dev cache:

```powershell
Remove-Item -LiteralPath .next -Recurse -Force
docker compose restart app
```

This was required for stale dynamic dashboard routes such as `/dashboard/[orgSlug]/events/new`.

### Dashboard Or Navbar Shows Old UI

If Docker/Turbopack serves stale output:

```bash
docker compose down
docker volume prune -f
rm -rf .next
docker compose up --build --force-recreate -d
docker compose run --rm app pnpm exec prisma migrate deploy
```

`docker volume prune -f` can wipe the local database volume.

## Project Structure

```text
app/           App Router pages and API routes
components/    UI and feature components
lib/           Auth, Prisma, validators, Stripe, client helpers
prisma/        Schema, migrations, seed script
docs/obsidian/ Internal codebase notes
docker/        Dockerfile and container setup
```
