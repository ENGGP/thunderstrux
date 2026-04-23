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

## Users And Passwords

Users sign up and sign in with email/password.

Rules:

- Email is normalised to lowercase on signup.
- Email must be unique.
- Password must be 8-200 characters.
- Passwords are hashed with `bcryptjs`.
- Plain passwords are never stored.

## Session

The Auth.js session includes:

```ts
session.user.id
```

This ID is used for all dashboard membership checks.

## Protected Routes

Middleware protects:

```text
/dashboard
/dashboard/:path*
```

Unauthenticated users are redirected to `/login`.

## Login And Signup

Login route:

```text
/login
```

Signup route:

```text
/signup
```

After login, a safe relative `callbackUrl` can redirect the user back to the dashboard route they attempted to access.

## Global Navbar

Root layout:

```text
app/layout.tsx
```

Navbar files:

- `components/layout/auth-session-provider.tsx`
- `components/layout/navbar.tsx`

Behaviour:

- Logged-out users see `Sign in`.
- Logged-in users see `Dashboard` and `Sign out`.
- Sign out redirects to `http://localhost:3000/` in local development.

`app/layout.tsx` calls `auth()` on the server and passes the session into `AuthSessionProvider`. This prevents the navbar from disappearing while the client session is loading.

## Organisation Access

Organisation access is stored in `OrganisationMember`.

Access helpers:

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

Direct access to `/dashboard/[orgSlug]/*` is protected by:

1. Middleware authentication.
2. `app/(dashboard)/dashboard/[orgSlug]/layout.tsx` membership check.

If the signed-in user is not a member of the organisation, the route resolves as not found.

## Organisation Creation

`POST /api/orgs` requires authentication.

The creator is added as `org_owner` in the same transaction as organisation creation.

## API Access Rules

Dashboard APIs:

- Require authentication.
- Use `session.user.id`.
- Load `OrganisationMember` rows.
- Use database roles for permission checks.

Do not trust frontend role state, `x-org-id`, or `x-user-role` as authority.

## Dashboard Navigation

Organisation dashboard navigation is documented in [[UI Architecture Rules]].

