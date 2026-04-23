# Authentication and Dashboard Access

## Auth Provider

Dashboard authentication uses Auth.js / NextAuth with the Credentials provider.

Users sign up and sign in with email and password. Passwords are hashed with `bcryptjs` before storage and are never stored as plain text.

Main files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/api/auth/signup/route.ts`
- `middleware.ts`
- `components/layout/auth-session-provider.tsx`
- `components/layout/navbar.tsx`
- `app/login/page.tsx`
- `app/signup/page.tsx`
- `components/auth/credentials-login-form.tsx`
- `components/auth/signup-form.tsx`
- `lib/validators/auth.ts`

Required environment variables:

```text
AUTH_SECRET=
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
```

`AUTH_URL` and `NEXTAUTH_URL` are browser-facing canonical URLs. In local Docker development they should use `localhost`, not the server bind address `0.0.0.0`.

## Login Flow

Unauthenticated dashboard users are redirected to:

```text
/login
```

The login page shows an email/password form and calls `signIn("credentials")`. After sign-in, the client redirects back to the original dashboard URL when a safe relative `callbackUrl` is present.

## Signup Flow

Users can create an account at:

```text
/signup
```

The signup page posts to `POST /api/auth/signup`.

Signup rules:

- Email is normalised to lowercase.
- Email must be unique.
- Password must be 8-200 characters.
- Password is hashed with bcrypt before `User` creation.
- Duplicate emails return a structured validation error.

## Protected Routes

Middleware protects:

```text
/dashboard
/dashboard/:path*
```

Unauthenticated access redirects to `/login`.

## User Records

User records are local credentials accounts.

The Prisma `User` model stores:

- `email` as a unique identifier
- `password` as a bcrypt hash

The session receives:

```ts
session.user.id
```

This local user ID is used for membership checks.

## Global Navbar

The global navbar is mounted in `app/layout.tsx`.

Important details:

- `app/layout.tsx` calls `auth()` on the server.
- The resulting session is passed into `AuthSessionProvider`.
- `components/layout/navbar.tsx` uses `useSession()`.
- Logged-out users see `Sign in`.
- Logged-in users see `Dashboard` and `Sign out`.
- Sign out calls `signOut({ callbackUrl: "http://localhost:3000/" })` in local development so Auth.js does not resolve redirects against the Docker bind host.

## Organisation Access

Dashboard organisation access uses `OrganisationMember`.

Helpers live in:

```text
lib/auth/access.ts
```

Important helpers:

- `requireAuthenticatedUser`
- `getMemberOrganisations`
- `requireOrganisationMembershipBySlug`
- `requireOrganisationMembershipById`
- `requireEventManagementAccess`
- `requireStripeConnectAccess`

## API Rules

`GET /api/orgs` returns only organisations where the authenticated user is a member.

`GET /api/orgs/[orgSlug]` returns an organisation only if the authenticated user is a member.

Dashboard event APIs no longer trust frontend `x-org-id` or `x-user-role` headers. They use the authenticated session and `OrganisationMember.role`.

## Direct URL Protection

Direct URL access to `/dashboard/[orgSlug]/*` is blocked in two layers:

- Middleware requires authentication.
- The dashboard layout checks membership for `orgSlug`.

If the signed-in user is not a member of the organisation, the dashboard route resolves as not found.

## Organisation Creation

`POST /api/orgs` requires authentication.

The creator is added as an `org_owner` member in the same transaction as organisation creation.
