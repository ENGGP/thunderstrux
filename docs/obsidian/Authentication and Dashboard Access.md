---
status: living
last-reviewed: 2026-10-09
owner: engineering
related: ["[[API Reference]]", "[[Email Delivery Implementation]]"]
sources: [auth.ts, proxy.ts, lib/auth/access.ts, lib/auth/account-lifecycle.ts, lib/auth/account-closure.ts]
---

# Authentication and Dashboard Access

## Staff MFA Rollout

Staff and legacy-owner management access now checks live database staff authority and a login-bound MFA grant when `MFA_ENFORCEMENT_MODE` is `enroll` (for enabled users) or `enforce` (for everyone). Production requires an explicit mode. The `/mfa` page supports authenticator enrollment and verification; successful setup returns ten one-time recovery codes. TOTP secrets are AES-GCM encrypted with `MFA_ENCRYPTION_KEY`, recovery codes are keyed hashes, and grants expire after 12 hours. Auth.js keeps a random login ID across cookie refreshes; a new login needs its own verification. Management page helpers redirect to `/mfa`; API helpers deny access until verification. Member purchases and joined-organisation views remain outside the staff gate.

Enrollment and challenge endpoints require the normal first-party origin and session CSRF token. They fail closed unless Redis-backed rate limiting is enabled and the separate MFA key is configured. `enroll` permits unenrolled staff to work while they are provisioned; `enforce` blocks them. See [[Production Readiness Verification 2026-09-22]] for activation and recovery gates.

## Dependency security update (2026-09-18)

NextAuth is pinned to 5.0.0-beta.32 with @auth/core 0.41.3. The Credentials provider remains in use; the session includes a random staff MFA login ID in the JWT/session callbacks. `dependency-security.test.ts` exercises actual credential rejection/login/session/logout plus malformed Bearer and valid-cookie proxy handling; this supplements the mocked-auth route suite. See [[Dependency Automation]].

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
session.user.authVersion
```

The first two values support dashboard routing and access checks. The random MFA login ID binds verification to one sign-in. Sessions created before this claim was introduced must sign out and sign in again before staff verification.

## Protected Routes

`proxy.ts` protects:

```text
/dashboard/:path*
/events/:path*
/account/:path*
```

Behavior:

- If no token exists, user is redirected to `/login`
- Relative callback URL is preserved in the query string
- Organisation accounts requesting `/events/[eventId]` are redirected to `/dashboard/events/[eventId]`
- Management pages resolve live staff/capability/MFA authority; a member accountRole alone neither grants nor prevents staff access.
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
- Returns the same `202 {accepted:true}` for eligible new and existing addresses; it does not sign in automatically or disclose duplicate addresses.
- Atomically creates an unverified account, a purpose-bound token digest and an encrypted notification. New passwords require at least 8 characters and no more than 72 UTF-8 bytes. Existing password login remains compatible.
- `/verify-email` removes the token fragment from browser history, then requires an explicit POST confirmation; GET/prefetch never consumes a token. Verification lasts 24 hours. Resend invalidates the previous token and cancels its queued/claimed intent; workers independently suppress obsolete tokens.
- Verification request and confirmation require trusted origin and enabled fail-closed Redis limits. They use email/token authority and deliberately ignore login-cookie CSRF authority, so stale cookies do not block verification. Protected account mutations retain session CSRF.
- Unverified users may sign in and edit profiles; purchases, society joins/bootstrap and staff invite acceptance require live verified identity, rechecked under an account lock in the write transaction. Legacy users are not silently verified. Disabled users cannot sign in or pass protected access guards.
- Callback paths use the shared safe-return-path helper. Confirmation never logs in or changes staff authority. Successful confirmation offers sign-in.
- JWT authVersion is established only at password login. Auth.js session output, application pages, API guards, CSRF and proxy compare it to live active identity. Missing/old versions are rejected; cookie refresh cannot upgrade a revoked session.

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
- Logged-in users see Dashboard, private Settings (/account/settings), and Sign out; members also see My tickets.
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
2. Dashboard pages resolve the signed context preference against live staff authority
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

Legacy `/dashboard/[orgSlug]/*` routes authorize their target and forward only when it matches the selected tenant; otherwise they return to the dashboard chooser. A GET never changes context.

Organisation dashboard access is authorized from the authenticated user, an active `OrganisationStaff` record, its live role and permissions, and the canonical target organisation resolved by the server. Disabling or changing staff authority takes effect without waiting for session expiry.

The legacy `Organisation.accountUserId` ownership path is used only according to `LEGACY_ORGANISATION_ACCESS_MODE` during migration. Missing authority redirects to an appropriate safe page or resolves as `notFound()` where revealing the tenant would disclose information.

## Explicit dashboard context

GET `/api/me/context` lists only live authorized staff organisations and role capabilities. POST selects personal or staff mode with trusted origin/session CSRF; staff selection rechecks target permission and MFA. A signed HttpOnly SameSite cookie binds the preference to the account, authVersion and password-login ID. It carries no authority. Revocation, tampering or stale selection never selects another tenant. Member staff start in personal mode on a fresh login; selected staff context lasts only that login. Organisation accounts without a preference retain their owned tenant only when it still has live authority, for bootstrap compatibility. Personal tickets and private account settings stay available to individual accounts.

The desktop sidebar and mobile menu filter links by current capabilities and mark the active page. Check-in staff see published events and attendance only. Event managers see event/attendance analytics without financial values or the revenue query; finance sees orders/refunds and financial analytics. Only owners may invite owners or change any owner row; other staff management still permits admins. Last-owner changes serialize on the organisation and audit atomically.

## Current Role Capabilities

Named staff receive event, finance, settings, administration, and Stripe Connect capabilities from their live role and explicit permissions. Server handlers re-check these capabilities for every protected operation.

Member accounts can complete a profile, join/leave organisations, browse events and view tickets; purchases/joins require verified identity. Members with active named staff authority can also use permitted management pages/APIs. A join membership alone never grants that access.

Organisation accounts can view public event URLs only as redirects to the organiser event view. They cannot buy tickets.

Recent verification:

- `admin@example.com` can start Stripe Connect onboarding for Arts Society.
- `user2@example.com`, which is only a `member` in Arts Society, still receives `403 Insufficient Stripe Connect permissions`.

## Trust Model

Trusted:

- Auth.js session
- `session.user.id`
- active `OrganisationStaff` status, role, and permissions from the database
- the canonical organisation resolved server-side
- `Organisation.accountUserId` only through the configured legacy migration fallback
- `OrganisationMember` row for member joins only
- server-side Prisma query results

Not trusted as authority:

- Frontend role state
- frontend `organisationId`
- request headers such as `x-user-role`
- request headers such as `x-org-id`

Some helper functions exist for organisation header matching, but access decisions still need live server-side staff authority, the explicitly enabled legacy fallback, or member-access checks as appropriate.

## Recovery And Private Settings (T04a)

`/forgot-password` returns generic acceptance for known, absent and disabled accounts. A 30-minute reset token is bound to user/email/authVersion and stored as a digest; the raw link exists only inside an encrypted notification. Latest issuance supersedes earlier links of that purpose. `/reset-password` clears the fragment and requires an explicit POST; opening/prefetching the URL never consumes it. Confirmation never creates a login.

`/account/settings` and GET `/api/me/account` expose only the current user's selected profile, verification/MFA status and ten private security events. Profile writes recheck the session version under the account lock. Password changes require the current password and, whenever an authenticator is enrolled, a login-bound grant even with staff enforcement off. Former staff can verify their existing enrollment without receiving staff authority.

Reset and change atomically update the bcrypt password, advance authVersion, delete every MFA login grant, invalidate outstanding auth tokens/cancel their pending messages, record a private AccountSecurityEvent and enqueue the security notice. MFA enrollment/recovery codes and email verification are preserved. Passwords must have at least eight characters and at most 72 UTF-8 bytes. Anonymous recovery requires first-party origin and fail-closed Redis limits; authenticated changes also retain session CSRF and a five-per-user/hour limit.

Deploy `20261005010000_password_recovery` before the app. Existing versionless cookies require fresh login. Rollback retains additive data; an older executable cannot enforce session revocation, so pause authenticated traffic during rollback. Independent security review is required before production activation. Provider acceptance, inbox delivery and hosted recovery remain separate evidence.

## Email Changes (T04b)

Authenticated request/confirm/cancel endpoints require live session version, current password, any enrolled login MFA grant, session CSRF/trusted origin and fail-closed account rate limits. Requests always queue an old-address alert and new-address confirmation intent; pending state is private and independent of whether the proposed address is already registered. The old login remains active until confirmation. The 30-minute digest token binds user, original email/version and proposed email. Uniqueness is enforced again transactionally at confirmation, including competing accounts.

`/change-email` removes the fragment and supports explicit credentials login on the same page before explicit confirmation; no token creates a session. Enrolled MFA can be verified in a separate tab while this page stays open. A static parser-time capture script runs before router hydration; queued hashchange events use their original newURL even if the router has already removed the fragment. All three account link forms handle a new fragment in an already mounted page, including after prior completion, and retain one bounded document-memory link across repeated effect setup/router remounts. Success clears it; a full document reload discards it. Raw tokens remain in page memory, never query callbacks or browser storage.

Confirmation atomically verifies the new email, increments authVersion, revokes grants/outstanding tokens, cancels token messages, records a private security event and notifies both addresses. Historical orders, tickets, joins and staff rows keep their user IDs. Pending staff invites to a verified old address are cancelled so a recycled address cannot accept them. An unverified old address has not established invite authority and does not cancel another recipient's invitations. Cancellation invalidates outstanding change links without changing the current email/session version.

Deploy `20261005020000_email_change` before app/worker. Older workers suppress this purpose; pause new security changes during rollback. No hosted activation or old-inbox approval is implied.

## Permanent Account Closure (T04c)

Settings exposes private eligibility and an explicit closure form. Closure requires the current password, every enrolled login authenticator regardless of staff enforcement mode, session CSRF/trusted origin, a live matching-version account, fail-closed five/hour account limits and the exact acknowledgement CLOSE MY ACCOUNT. The transaction rechecks active owner/legacy ownership pointers, pending orders, unresolved compensation and upcoming paid purchases; a manual refund marker is not Stripe truth and cannot bypass blockers. Organisation owners must hand over both active owner authority and any legacy account pointer first.

Closure locks the User and its orders before the final decision. Checkout, free joins, organisation bootstrap, invite acceptance, staff updates and MFA credential writes share account locks. Staff changes also recheck live actor/version/permission/MFA under locks, serialize last-owner changes and audit in the same transaction. Closure disables and permanently marks the retained user ID, increments authVersion, replaces login email/password with unusable values, clears editable profile/verification, deletes MFA secrets/recovery/grants and auth tokens, cancels pending token jobs, revokes active staff and verified-address pending invites, and removes free join rows. A private security event and encrypted former-inbox notice commit atomically. The database prevents clearing/changing closedAt or clearing disabledAt on a closed row; there is no self-service reversal.

Orders, tickets, attendance, security/audit records and historical user IDs remain. Orders lacking a capture retain the current account email/name at closure with current_account_at_capture provenance and a capture timestamp; this does not claim unknown purchase-time profile facts. Existing captures are immutable. Tenant-scoped order details, email search/pagination, check-in and ticket delivery resolve retained contacts. Historical security notification recipients/encrypted payloads are retained privately; closure is profile/login anonymisation, not deletion of all personal information. A new signup at the former email gets a new user ID, unverified state and no old records. Later legitimate provider events still update payment/compensation truth without reopening the identity.

Deploy 20261005030000_account_closure before the app/workers. The additive schema supports retained records, but anonymisation cannot be reversed by app rollback. Pause closure, account mutations and buyer contact/ticket delivery flows before rolling back to a version that cannot read captures or fence closure. Independent high-risk review and hosted recovery remain release gates; no activation is implied.
