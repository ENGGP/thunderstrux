# Architecture Overview

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma ORM
- PostgreSQL 16
- Auth.js / NextAuth credentials provider
- Stripe Checkout
- Stripe Connect Express
- Zod validation
- Tailwind CSS v4
- Docker Compose
- pnpm

## Runtime Shape

```text
Browser
  -> Next.js App Router pages and layouts
  -> Client components submit forms and call route handlers
  -> Route handlers validate input and enforce auth/tenancy
  -> Prisma reads and writes PostgreSQL
  -> Stripe APIs create checkout sessions and onboarding links
  -> Stripe webhooks reconcile payments and sync account readiness
```

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

## Layout Responsibilities

`app/layout.tsx`

- Loads the auth session on the server.
- Wraps the tree in `AuthSessionProvider`.
- Renders the fixed global `Navbar`.
- Offsets page content with `pt-16` so content does not sit under the fixed header.

`app/(dashboard)/dashboard/[orgSlug]/layout.tsx`

- Resolves `orgSlug`.
- Calls `requireOrganisationMembershipBySlug(orgSlug)`.
- Uses `notFound()` when membership is missing.
- Passes the organisation name and slug into `DashboardShell`.

`components/layout/dashboard-shell.tsx`

- Renders the fixed left sidebar below the global header.
- Renders the organisation heading row.
- Owns shared organisation dashboard nav.
- Must remain the single source of dashboard navigation.

## Page Responsibilities

`/dashboard`

- Loads the signed-in user’s organisations through `GET /api/orgs`.
- Shows empty-state onboarding when there are no memberships.
- Shows organisation cards with `Open dashboard` when memberships exist.

`/dashboard/[orgSlug]`

- Renders overview content only.
- Shows `View events`.
- Must not duplicate `Settings` navigation.

`/dashboard/[orgSlug]/events`

- Renders the events list via `components/events/events-list.tsx`.

`/dashboard/[orgSlug]/settings`

- Renders Stripe Connect settings UI.

## Authentication Model

- Auth uses the Credentials provider in `auth.ts`.
- Passwords are stored hashed with bcrypt.
- JWT callback stores `userId` in the token.
- Session callback exposes `session.user.id`.
- Custom sign-in page is `/login`.

## Multi-Tenancy Model

- A user can belong to many organisations.
- `Organisation.slug` is the stable route identifier.
- Dashboard access is always resolved from the authenticated session plus the database membership row.
- The frontend may send `organisationId`, but backend permission checks must still verify membership and role.

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

Important historical context:

- Tailwind previously appeared “partially broken” because the project was using legacy `@tailwind base/components/utilities` directives under Tailwind v4.
- The broken symptom was: structural utilities compiled, but color/spacing/radius/shadow utilities did not.
- The current v4 import setup fixes that.
