# Authentication and Dashboard Access

## Staff MFA rollout (branch `codex/production-readiness-verification`)

Staff and legacy-owner management access now checks live database staff authority and a login-bound MFA grant when `MFA_ENFORCEMENT_MODE` is `enroll` (for enabled users) or `enforce` (for everyone). Production requires an explicit mode. The `/mfa` page supports authenticator enrollment and verification; successful setup returns ten one-time recovery codes. TOTP secrets are AES-GCM encrypted with `MFA_ENCRYPTION_KEY`, recovery codes are keyed hashes, and grants expire after 12 hours. Auth.js keeps a random login ID across cookie refreshes; a new login needs its own verification. Management page helpers redirect to `/mfa`; API helpers deny access until verification. Member purchases and joined-organisation views remain outside the staff gate.

Enrollment and challenge endpoints require the normal first-party origin and session CSRF token. They fail closed unless Redis-backed rate limiting is enabled and the separate MFA key is configured. `enroll` permits unenrolled staff to work while they are provisioned; `enforce` blocks them. See [[Production Readiness Verification 2026-09-22]] for activation and recovery gates.

## Dependency security update (2026-09-18)

NextAuth is pinned to 5.0.0-beta.32 with @auth/core 0.41.3. The Credentials provider remains in use; this branch adds a random staff MFA login ID to the JWT/session callbacks. `dependency-security.test.ts` exercises actual credential rejection/login/session/logout plus malformed Bearer and valid-cookie proxy handling; this supplements the mocked-auth route suite. See [[Handover 2026-09-18 Dependency Security Remediation]].

## Auth Provider

Thunderstrux uses Auth.js / NextAuth with a Credentials provider.

Main files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/api/auth/signup/route.ts`
- `proxy.ts`
- `components/auth/credentials-login-form.tsx`
- `components/auth/signup-form.tsx`

`AUTH_SECRET` rules:

- production runtime requires a real non-placeholder `AUTH_SECRET`
- development may use a dev-only fallback with a warning
- Docker image builds use a build-time placeholder only so real secrets are not required during image creation
- `proxy.ts` also rejects missing or placeholder production `AUTH_SECRET` values so proxy token decoding cannot silently fall back to `dev-secret`

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
- Named staff users, invites, roles, MFA, and initial audit logging are implemented. The legacy organisation login remains supported during migration and should be retired after all management users have individual accounts.

## Session Shape

Important session field:

```ts
session.user.id
session.user.accountRole
session.user.staffMfaSessionId
```

The first two values support dashboard routing and access checks. The random MFA login ID binds verification to one sign-in. Sessions created before this claim was introduced must sign out and sign in again before staff verification.

## Protected Routes

`proxy.ts` protects:

```text
/dashboard/:path*
/events/:path*
```

Behavior:

- If no token exists, user is redirected to `/login`
- Relative callback URL is preserved in the query string
- Organisation accounts requesting `/events/[eventId]` are redirected to `/dashboard/events/[eventId]`
- Member accounts requesting `/dashboard/events/[eventId]` are redirected to `/`
- In production, proxy initialization fails for unsafe `AUTH_SECRET` values: empty string, `dev-secret`, or `replace-with-a-non-empty-secret`

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
- Thunderstrux logo links to `/dashboard` for organisation accounts
- Thunderstrux logo links to `/` for member and logged-out users
- Logged-out users see `Sign in`
- Logged-in users see `Dashboard` and `Sign out`
- Member accounts see `My tickets`
- Organisation accounts do not see `My tickets`
- Sign out redirects to `/` on the current site, including isolated staging ports.

## Organisation Access Helpers

File:

```text
lib/auth/access.ts
```

Important helpers:

- `requireAuthenticatedUser`
- `getAccessibleOrganisationsForCurrentAccount`
- `requireOrganisationAccessBySlug`
- `requireOrganisationAccessById`
- `requireOrganisationEventManagementAccess`
- `requireOrganisationFinanceAccess`
- `requireOrganisationStripeConnectAccess`
- `requireOrganisationStaffAccess`
- `requireOrganisationAdminAccess`

## Dashboard Access Layers

Dashboard protection is layered:

1. Proxy blocks unauthenticated users from `/dashboard/*`
2. Dashboard pages resolve the current account role
3. API handlers verify ownership or member access again on mutations

Organisation management is now available at:

```text
/dashboard
/dashboard/events
/dashboard/events/[eventId]
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

Member accounts can complete a profile, join and leave organisations, view public-safe organisation details, browse public events, buy tickets, and view `/tickets`. They cannot access organisation management APIs or pages.

Organisation accounts can view public event URLs only as redirects to the organiser event view. They cannot buy tickets.

Recent verification:

- `admin@example.com` can start Stripe Connect onboarding for Arts Society.
- `user2@example.com`, which is only a `member` in Arts Society, still receives `403 Insufficient Stripe Connect permissions`.

## Trust Model

Trusted:

- Auth.js session
- `session.user.id`
- `Organisation.accountUserId` for organisation management
- `OrganisationMember` row for member joins only
- server-side Prisma query results

Not trusted as authority:

- Frontend role state
- frontend `organisationId`
- request headers such as `x-user-role`
- request headers such as `x-org-id`

Some helper functions exist for organisation header matching, but access decisions still need server-side database ownership or member-access checks.
