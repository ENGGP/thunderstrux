# Authentication and Dashboard Access

## Auth Provider

Thunderstrux uses Auth.js / NextAuth with a Credentials provider.

Main files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/api/auth/signup/route.ts`
- `middleware.ts`
- `components/auth/credentials-login-form.tsx`
- `components/auth/signup-form.tsx`

## User Model

Users authenticate with:

- `email`
- `password`
- `accountRole`

Rules:

- Passwords are hashed with bcrypt before storage.
- Auth lookup normalises email to lowercase during credentials authorization.
- Signup validation is handled by Zod in `lib/validators/auth.ts`.
- Account role is either `member` or `organisation`.
- Member accounts represent people.
- Organisation accounts represent exactly one organisation.
- For MVP, organisation committee members may share the one organisation login. This is a temporary product tradeoff; future work should add named staff users, invites, MFA, audit logs, and per-user organisation permissions.

## Session Shape

Important session field:

```ts
session.user.id
session.user.accountRole
```

These values are used for dashboard routing and access checks.

## Protected Routes

`middleware.ts` protects:

```text
/dashboard/:path*
```

Behavior:

- If no token exists, user is redirected to `/login`
- Relative callback URL is preserved in the query string

## Login and Signup Flow

Login:

```text
/login
```

- Uses `signIn("credentials")`
- On success, redirects to `callbackUrl`

Signup:

```text
/signup
```

- POSTs to `/api/auth/signup`
- On successful user creation, immediately signs in with credentials
- Redirects to `callbackUrl`

## Navbar Behavior

Files:

- `app/layout.tsx`
- `components/layout/auth-session-provider.tsx`
- `components/layout/navbar.tsx`

Current behavior:

- Navbar is fixed globally at the top
- Logged-out users see `Sign in`
- Logged-in users see `Dashboard` and `Sign out`
- Sign out currently redirects to `http://localhost:3000/`

## Organisation Access Helpers

File:

```text
lib/auth/access.ts
```

Important helpers:

- `requireAuthenticatedUser`
- `getMemberOrganisations`
- `requireOrganisationMembershipBySlug`
- `requireOrganisationMembershipById`
- `requireEventManagementAccess`
- `requireFinanceAccess`
- `requireStripeConnectAccess`

## Dashboard Access Layers

Dashboard protection is layered:

1. Middleware blocks unauthenticated users from `/dashboard/*`
2. Route-level layout checks organisation membership
3. API handlers verify membership and role again on mutations

Organisation management is now available at:

```text
/dashboard
/dashboard/events
/dashboard/events/new
/dashboard/events/[eventId]/edit
/dashboard/orders
/dashboard/settings
```

Legacy `/dashboard/[orgSlug]/*` routes remain as compatibility redirects for organisation accounts that own the slug.

Organisation dashboard access is ultimately authorized by:

- session user id
- `User.accountRole = organisation`
- `Organisation.accountUserId`
- server-side organisation ownership checks

If ownership is missing, the organisation dashboard redirects to organisation creation or resolves as `notFound()` on legacy routes.

## Current Role Capabilities

Organisation accounts have full event, finance, settings, and Stripe Connect management access for their one organisation.

Member accounts can complete a profile, join organisations, browse public events, buy tickets, and view `/tickets`. They cannot access organisation management APIs or pages.

Recent verification:

- `admin@example.com` can start Stripe Connect onboarding for Arts Society.
- `user2@example.com`, which is only a `member` in Arts Society, still receives `403 Insufficient Stripe Connect permissions`.

## Trust Model

Trusted:

- Auth.js session
- `session.user.id`
- `OrganisationMember` row
- server-side Prisma query results

Not trusted as authority:

- Frontend role state
- frontend `organisationId`
- request headers such as `x-user-role`
- request headers such as `x-org-id`

Some helper functions exist for organisation header matching, but access decisions still need the database membership check.
