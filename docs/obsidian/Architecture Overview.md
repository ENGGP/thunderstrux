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

## Product Account Model

`User.accountRole` is exactly one of:

- `member`
- `organisation`

Member accounts represent people. They can complete a profile, join organisations, browse published events, buy tickets, and view `/tickets`.

Organisation accounts represent exactly one organisation through `Organisation.accountUserId`. They manage that organisation directly at `/dashboard`.

For MVP, organisation committee members may share one organisation login. This is a product tradeoff, not the final security model. Future work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

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
      page.tsx                         Role-aware member/org dashboard
      create/page.tsx                  Organisation-account onboarding
      organisations/page.tsx           Member organisation search/join
      events/layout.tsx                Explicit route boundary
      events/page.tsx                  Organisation event list
      events/new/page.tsx              Organisation event creation
      events/[eventId]/edit/page.tsx   Organisation event editing
      orders/page.tsx                  Organisation order review
      settings/page.tsx                Organisation settings/Stripe Connect
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

- Branches by `session.user.accountRole`.
- Renders the member dashboard for `member` accounts.
- Resolves `Organisation.accountUserId` and renders the organisation dashboard for `organisation` accounts.
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

- Member accounts see profile completion, joined organisations, organisation search, public event discovery, and ticket links.
- Organisation accounts see their organisation dashboard directly with upcoming events, recent orders, past-month revenue, and management navigation.

`/dashboard/events`

- Renders the organisation event list through `components/events/events-list.tsx`.

`/dashboard/events/new`

- Renders the event creation form for the signed-in organisation account.

`/dashboard/events/[eventId]/edit`

- Renders the event edit form after verifying the event belongs to the signed-in organisation account.

`/dashboard/orders`

- Renders organisation-scoped order and payment review.

`/dashboard/settings`

- Renders Stripe Connect settings UI.
- The UI is state-driven from the backend Connect lifecycle: `NOT_CONNECTED`, `PLATFORM_NOT_READY`, `CONNECTED_INCOMPLETE`, `RESTRICTED`, `READY`, and `ERROR`.

`/dashboard/organisations`

- Member-only organisation search and join page.

`/dashboard/[orgSlug]/*`

- Legacy compatibility routes.
- Redirect to the matching slugless organisation dashboard route when the signed-in organisation account owns the slug.
- Return not found when ownership does not match.

## Authentication Model

- Auth uses the Credentials provider in `auth.ts`.
- Passwords are stored hashed with bcrypt.
- JWT callback stores `userId`, `accountRole`, profile names, and onboarding timestamp in the token.
- Session callback exposes `session.user.id` and `session.user.accountRole`.
- Custom sign-in page is `/login`.

## Multi-Tenancy Model

- `Organisation` remains the tenant, event owner, order owner, ticket owner, and Stripe Connect owner.
- Organisation dashboard access is resolved from the authenticated organisation account plus `Organisation.accountUserId`.
- Member join relationships use `OrganisationMember`.
- `OrganisationMember` is not staff access for the MVP, although legacy compatibility rows may still exist.
- `Organisation.slug` remains a stable identifier for compatibility, public display, and lookup APIs.
- The frontend may send `organisationId`, but backend permission checks must still verify the authenticated account and organisation ownership.

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
- `lib/stripe/connect.ts` owns Express account creation, platform-readiness detection, onboarding link creation, status retrieval, lifecycle mapping, and local disconnect.
- API routes own authentication, role checks, validation, and structured JSON responses.
- `components/settings/stripe-connect-settings.tsx` owns the user guidance and action buttons.

The platform owns the UX. Stripe owns compliance and sensitive onboarding data collection.

`PLATFORM_NOT_READY` means the Stripe platform account behind `STRIPE_SECRET_KEY` cannot yet create Express accounts. It is shown before a connected account exists and links the operator to:

```text
https://dashboard.stripe.com/settings/connect/platform-profile
```
