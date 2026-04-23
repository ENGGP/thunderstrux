# Architecture Overview

## Stack

- Next.js App Router
- TypeScript
- Prisma ORM
- PostgreSQL
- Stripe Checkout
- Stripe Connect Express
- Auth.js / NextAuth Credentials provider
- Zod validation
- Tailwind CSS
- Docker Compose
- pnpm

## High-Level Layers

```text
Browser
  |
  | visits pages and calls APIs
  v
Next.js App Router
  |
  | page.tsx files render UI
  | route.ts files implement backend APIs
  v
lib/
  |
  | validation, permissions, Prisma, Stripe helpers
  v
PostgreSQL + Stripe
```

## Runtime Split

### Frontend

The frontend lives mainly in:

- `app/page.tsx`
- `app/(public)/events/[eventId]/page.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/*`
- `components/*`

Frontend responsibilities:

- Render pages
- Fetch public or dashboard data from APIs
- Submit forms
- Start checkout by calling the checkout API
- Redirect users to Stripe Checkout

Frontend does not decide payment status. Payment fulfilment is handled by Stripe webhooks.

### Backend

Backend route handlers live in:

- `app/api/events`
- `app/api/orgs`
- `app/api/public/events`
- `app/api/payments`
- `app/api/stripe/connect`

Backend responsibilities:

- Validate request bodies
- Enforce tenant scoping for private routes through authenticated membership
- Resolve trusted server-side IDs
- Create Stripe Checkout Sessions
- Process Stripe webhooks
- Create orders and tickets
- Persist Stripe Connect status

## Important Boundaries

### Public APIs

Public APIs do not require auth or `x-org-id`.

Current public APIs:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

They only return published event data and public-safe fields.

### Private/Dashboard APIs

Private/dashboard APIs require an authenticated session.

Organisation access is checked through `OrganisationMember` rows for the signed-in user. Role-sensitive actions use the member role stored in the database.

Frontend dashboard code should not send trusted `x-org-id` or `x-user-role` headers.

### Payment APIs

Checkout is public-facing, but secure because it does not trust frontend organisation data. It resolves the organisation through the published event.

Webhook fulfilment is the source of truth for paid orders and ticket issuance.
