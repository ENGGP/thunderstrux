# Architecture Overview

## Stack

- Next.js App Router
- React Server Components and client components where needed
- TypeScript
- Prisma ORM
- PostgreSQL
- Auth.js / NextAuth Credentials provider
- Stripe Checkout
- Stripe Connect Express
- Zod validation
- Tailwind CSS
- Docker Compose
- pnpm

## Runtime Shape

```text
Browser
  -> Next.js App Router pages and layouts
  -> Client components submit forms and call APIs
  -> Route handlers validate input and enforce auth/tenancy
  -> Prisma reads/writes PostgreSQL
  -> Stripe APIs and webhooks handle payment side effects
```

## App Router Structure

Route groups are filesystem-only. The `(dashboard)` and `(public)` folders do not appear in URLs.

```text
app/
  layout.tsx
  page.tsx
  (public)/
    events/[eventId]/page.tsx
  (dashboard)/
    dashboard/
      page.tsx
      create/page.tsx
      [orgSlug]/
        layout.tsx
        page.tsx
        events/page.tsx
        events/new/page.tsx
        events/[eventId]/edit/page.tsx
        settings/page.tsx
  api/
```

## Public Routes

- `/` renders public event discovery.
- `/events/[eventId]` renders a public event detail page.
- Public pages only expose published events.
- Public event detail uses `GET /api/public/events/[eventId]`.

## Dashboard Routes

### `/dashboard`

File:

```text
app/(dashboard)/dashboard/page.tsx
```

Responsibilities:

- Load the signed-in user's organisations through `GET /api/orgs`.
- Show onboarding if the user has no memberships.
- Show organisation cards if the user has memberships.
- Provide `Open dashboard` links to `/dashboard/[orgSlug]`.

The dashboard root does not render a Settings action for organisation cards.

### `/dashboard/[orgSlug]`

Files:

```text
app/(dashboard)/dashboard/[orgSlug]/layout.tsx
app/(dashboard)/dashboard/[orgSlug]/page.tsx
components/layout/dashboard-shell.tsx
```

Responsibilities:

- The layout validates the signed-in user's membership for `orgSlug`.
- The layout renders `DashboardShell`.
- `DashboardShell` owns shared organisation navigation.
- The page renders only overview content and a `View events` action.

## Layout vs Page Responsibilities

Layouts own shared structure:

- Root layout owns app-wide session provider and global navbar.
- Organisation dashboard layout owns membership gating and `DashboardShell`.
- `DashboardShell` owns organisation dashboard navigation.

Pages own route-specific content:

- `/dashboard` owns organisation selection/onboarding content.
- `/dashboard/[orgSlug]` owns the organisation dashboard overview card.
- `/dashboard/[orgSlug]/events` owns event list content through `EventsList`.
- `/dashboard/[orgSlug]/settings` owns Stripe Connect settings content.

Do not duplicate shared navigation in page files. See [[UI Architecture Rules]].

## Backend Boundaries

Route handlers live under `app/api`.

Main API groups:

- `app/api/auth`
- `app/api/orgs`
- `app/api/events`
- `app/api/public/events`
- `app/api/payments`
- `app/api/stripe/connect`

Private dashboard APIs require an authenticated session and organisation membership. They should not trust frontend role headers or frontend organisation scope as authority.

Public APIs do not require authentication but only return published, public-safe data.

Payment APIs resolve trusted organisation context server-side and rely on webhooks for fulfilment.

