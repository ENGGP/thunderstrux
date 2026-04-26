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

Rules:

- Passwords are hashed with bcrypt before storage.
- Auth lookup normalises email to lowercase during credentials authorization.
- Signup validation is handled by Zod in `lib/validators/auth.ts`.

## Session Shape

Important session field:

```ts
session.user.id
```

This is the value used for all dashboard access checks.

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

`/dashboard/[orgSlug]/*` is ultimately authorized by:

- session user id
- database membership row
- server-side role checks

If membership is missing, the org dashboard layout resolves as `notFound()`.

## Current Role Capabilities

Event management:

- `org_owner`
- `org_admin`
- `event_manager`

Finance management:

- `org_owner`
- `org_admin`
- `finance_manager`

Stripe Connect onboarding:

- `org_owner`
- `org_admin`
- `event_manager`
- `finance_manager`
- `content_manager`

`member` cannot manage Stripe Connect. Users without an organisation membership cannot access the organisation dashboard or Connect APIs.

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
