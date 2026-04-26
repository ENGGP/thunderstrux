# Thunderstrux

Thunderstrux is a Next.js App Router SaaS foundation for student societies. It supports organisation-scoped dashboards, event management, ticket types, public event discovery, credentials-based authentication, and Stripe-based checkout/connect flows.

Last reviewed: 2026-04-26

## Stack

- Next.js 16 App Router
- React 19
- Auth.js / NextAuth Credentials provider
- Prisma
- PostgreSQL
- Tailwind CSS
- Docker Compose
- Stripe Checkout
- Stripe Connect Express

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

The Docker dev server intentionally runs `next dev --webpack --hostname 0.0.0.0` with polling enabled. Turbopack was unreliable in this local Docker setup and served stale UI during development.

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

Common local accounts all use `password123`:

- `user1@example.com` - Engineering Society owner
- `admin@example.com` - admin across Engineering and Arts
- `event.manager@example.com` - Engineering event manager and Robotics owner
- `finance@example.com` - Engineering finance manager and Payments Lab owner
- `content@example.com` - Engineering content manager
- `member@example.com` - Engineering member
- `user2@example.com` - Arts member and seeded buyer
- `empty@example.com` - owner of Empty Society with no events
- `outsider@example.com` - no organisation memberships

Additional one-off e2e test users may exist in the local database if validation scripts were run.

## Main Routes

Public:

- `/` - homepage, published events only
- `/events/[eventId]` - public event page
- `/tickets` - authenticated buyer ticket history

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
- `/dashboard/[orgSlug]/orders` - organiser order review
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
- `POST /api/payments/webhook` - Stripe Checkout webhook fulfilment
- `GET /api/stripe/connect/status?organisationId=...` - sync Stripe Connect status
- `POST /api/stripe/connect/onboard` - create/reuse Express account and return onboarding URL
- `POST /api/stripe/connect/continue` - return a fresh onboarding URL for an existing account
- `POST /api/stripe/connect/disconnect` - local-only disconnect
- `POST /api/stripe/connect/webhook` - Stripe Connect account status webhook

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

Fulfilment happens only through Stripe webhooks. Frontend success/cancel redirects do not issue tickets or mark orders paid.

## Stripe Connect Notes

Stripe Connect is organisation-scoped. The Stripe account itself lives in Stripe; Thunderstrux stores the connected account id and cached readiness flags on the local `Organisation` row:

```text
stripeAccountId
stripeAccountStatus
stripeChargesEnabled
stripePayoutsEnabled
stripeDetailsSubmitted
```

Current lifecycle states:

- `NOT_CONNECTED` - no local connected account id is stored
- `PLATFORM_NOT_READY` - the Stripe platform profile/setup blocks Express account creation
- `CONNECTED_INCOMPLETE` - account exists but onboarding details are not submitted
- `RESTRICTED` - details are submitted but charges are not enabled
- `READY` - charges are enabled and checkout can proceed
- `ERROR` - an existing connected account could not be retrieved or synced

Disconnect is local-only. It clears the organisation Stripe fields in Thunderstrux but does not delete the account in Stripe. Reconnecting to the exact same old account requires manually restoring the old `acct_...` id in the database and refreshing status.

## Troubleshooting

### Route Exists But Returns 404 In Dev

If an App Router page exists in source but still returns 404, clear the dev cache:

```powershell
Remove-Item -LiteralPath .next -Recurse -Force
docker compose restart app
```

This was required for stale dynamic dashboard routes such as `/dashboard/[orgSlug]/events/new`.

### Dashboard Or Navbar Shows Old UI

If Docker serves stale output:

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
