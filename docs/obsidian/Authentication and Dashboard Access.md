---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Route Security Inventory]]", "[[API Reference]]", "[[Frontend and Backend Flow]]", "[[Email Delivery Implementation]]", "[[Audit Coverage]]"]
sources: [auth.ts, proxy.ts, lib/permissions/index.ts, lib/auth/access.ts, lib/auth/page-access.ts, lib/auth/context.ts, lib/auth/context-cookie.ts, lib/staff/live-authority.ts, lib/security/staff-mfa.ts, lib/auth/account-lifecycle.ts, lib/auth/email-change.ts, lib/auth/account-closure.ts, lib/guest/guest-access.ts, lib/staff/invites.ts, lib/staff/handover.ts]
---

# Authentication and Dashboard Access

**Owns:** who someone is and what they may do: roles and the permission matrix, the auth helpers routes and pages call, sessions and `authVersion`, the proxy, staff MFA, account verification, recovery, email change and closure, guest access, staff invitations, owner handover and the dashboard context.
**Read when:** adding a protected route or page, changing a role's reach, or touching sign-in, account security, guest sessions or staff management.
**Not here:** the order each route runs its checks and the rate-limit numbers ([[Route Security Inventory]]); request and response shapes ([[API Reference]]); which page needs which permission ([[Frontend and Backend Flow]]); emails sent ([[Email Delivery Implementation]]); deploys and rollback ([[Production Operations]]).

## Code

| Concern | Where |
| --- | --- |
| Roles, permissions | `lib/permissions/index.ts`: `organisationPermissions`, `hasOrganisationPermission`, `organisationRolesWithPermission` |
| The one live authority rule | `lib/staff/live-authority.ts`: `liveStaffRole`, `liveStaffRoleForUser`, `roleHasPermission`, `legacyOrganisationAccessMode` |
| Route helpers | `lib/auth/access.ts` (see [Auth helpers](#auth-helpers)); error rules `lib/api/route-rules.ts` |
| Page helpers | `lib/auth/page-access.ts`: `requireManagementPage`, `redirectLegacyOrganisationPage` |
| Locked recheck in services | `lib/organisations/authority.ts`: `lockOrganisationActor` |
| Auth.js | `auth.ts` (Credentials provider, JWT and session callbacks), `lib/auth/credentials.ts`: `authorizeCredentials`, `lib/auth/secret.ts`: `resolveAuthSecret` |
| Live session | `lib/auth/live-session.ts`: `getLiveSession`; `lib/auth/session-identity.ts`: `getSessionIdentity` |
| Proxy | `proxy.ts`; cookie scheme `lib/auth/public-origin.ts`: `publicOriginIsHttps`, `appCookieSecure` |
| Dashboard context | `lib/auth/context.ts`: `readAccountContext`, `contextChoices`; `lib/auth/context-cookie.ts` |
| Staff MFA | `lib/security/staff-mfa.ts`; page `/mfa` |
| Signup, verification, reset, password change | `lib/auth/account-lifecycle.ts`; settings `lib/auth/account-settings.ts` |
| Email change | `lib/auth/email-change.ts` |
| Closure | `lib/auth/account-closure.ts` |
| Fragment capture for emailed links | `lib/auth/account-link-capture.ts` |
| Safe callback paths | `lib/security/safe-return-path.ts` |
| Guest access | `lib/guest/guest-access.ts`, `lib/guest/guest-csrf.ts`, `lib/guest/guest-claim.ts` |
| Staff | `lib/staff/invites.ts`, `lib/staff/invite-authority.ts`, `lib/staff/management.ts`, `lib/staff/handover.ts` |
| Sign-out | `lib/client/sign-out.ts`: `signOutTo` |
| Tests | `tests/integration/auth-access.test.ts`, `tests/integration/live-staff-authority.test.ts`, `tests/integration/staff-mfa.test.ts`, `tests/integration/staff-context.test.ts`, `tests/integration/account-verification.test.ts`, `tests/integration/password-recovery.test.ts`, `tests/integration/email-change.test.ts`, `tests/integration/account-closure.test.ts`, `tests/integration/guest-access.test.ts`, `tests/integration/guest-claim.test.ts`, `tests/integration/staff-invites.test.ts`, `tests/integration/staff-handover.test.ts`, `tests/integration/proxy-session-cookie.test.ts`, `tests/integration/dependency-security.test.ts` (real Auth.js sign-in, session, sign-out and proxy), `tests/e2e/account-lifecycle.spec.ts`, `tests/e2e/mfa-enforced.spec.ts` |

## Roles and permissions

Two account kinds (`User.accountRole`): `member` (a person) and `organisation` (a society login from before named staff). The account kind grants no management power; staff power comes only from an `OrganisationStaff` row (`role`, `status` `active` or `revoked`) or the legacy pointer below.

`OrganisationStaffRole` → permissions (`rolePermissions` in `lib/permissions/index.ts`; there is no per-user permission list):

| Permission | `owner` | `admin` | `event_manager` | `finance_manager` | `check_in_staff` | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| `events:read` | ✓ | ✓ | ✓ | ✓ | ✓ | events list and calendar pages, `GET /api/orgs/[orgSlug]/calendar`, choosing a staff context |
| `events:manage` | ✓ | ✓ | ✓ | | | event APIs and builder pages, event images, drafts in the calendar |
| `tickets:check_in` | ✓ | ✓ | ✓ | | ✓ | check-in API and page |
| `orders:read` | ✓ | ✓ | | ✓ | | orders API and pages, commerce order finance view, money in analytics (with `analytics:read`) |
| `orders:refund_mark` | ✓ | ✓ | | ✓ | | `PATCH /api/orders/[orderId]/refund-manual` |
| `orders:refund` | ✓ | ✓ | | ✓ | | refunds, free cancellations, dispute review, compensation confirm, membership cancel and refund, merchandise refund and cancel |
| `orders:email_resend` | ✓ | ✓ | | ✓ | | resend, email-job and notification requeue, `/dashboard/notifications` |
| `analytics:read` | ✓ | ✓ | ✓ | ✓ | | analytics and event summary pages, sales columns |
| `stripe:manage` | ✓ | ✓ | | | | Connect routes, `/dashboard/settings` |
| `staff:manage` | ✓ | ✓ | | | | staff list, edits, invitations; handover also needs `owner` |
| `organisation:settings` | ✓ | ✓ | | | | society profile, logo and cover images |
| `members:read` | ✓ | ✓ | | | | membership roster, membership ends in the calendar and overview |
| `memberships:manage` | ✓ | ✓ | | | | membership plan routes and pages, membership revoke |
| `merchandise:manage` | ✓ | ✓ | | | | product routes and pages, product photos |
| `merchandise:fulfil` | ✓ | ✓ | | | | pickups and returns |
| `audit:read` | ✓ | ✓ | | | | `/dashboard/history` ([[Audit Coverage#History]]) |
| `members:manage` | ✓ | ✓ | | | | defined, used by nothing |
| `openclaw:use` | ✓ | ✓ | ✓ | ✓ | | defined, used by nothing (OpenClaw is deferred) |

Extra rules outside the matrix: only an `owner` may invite an owner, change an owner row or grant owner (`lib/staff/management.ts`); handover needs an `owner`; invitation issuers also need a verified email (`lib/staff/invite-authority.ts`).

**Legacy `OrganisationRole`** (`org_owner`, `org_admin`, `event_manager`, `finance_manager`, `content_manager`, `member`) is the `OrganisationMember.role` join union. Joins use `member`; bootstrap also writes a compatibility `org_owner` row. It is display data for joined societies and never authority.

**Live authority** (`liveStaffRole`, the only place that decides a role; routes, locked services and workers all call it):

- An active staff row grants its role; a revoked row grants nothing.
- Any staff row for the society, active or revoked, supersedes legacy ownership.
- Otherwise an `organisation` account named on `Organisation.accountUserId` acts as `owner` only when `LEGACY_ORGANISATION_ACCESS_MODE=allow`. Unset means allow outside production; in production unset or invalid means deny and readiness fails (`assertLegacyOrganisationAccessConfigured`). Hosted compose must set `deny` (`scripts/container-config.mjs`).
- A disabled account holds no authority. Changes take effect on the next request, without waiting for the session to end.

## Auth helpers

| Helper (`lib/auth/access.ts` unless named) | Does | Throws |
| --- | --- | --- |
| `requireAuthenticatedUser` | live session; user exists, not disabled, `authVersion` matches; returns id, `authVersion`, `mfaSessionId`, `accountRole`, email, `emailVerifiedAt` | `AuthenticationRequiredError` (401) |
| `requireVerifiedUser` | the above plus a verified email | `OrganisationAccessError` "Verify your email before using this feature" |
| `requireAccountRole(role)` | the account kind | `OrganisationAccessError` |
| `requireOrganisationPermission(id, permission)` | live role, permission, then staff MFA | `OrganisationAccessError` "Organisation not found or access denied" (no role) or "Insufficient staff permissions"; `StaffMfaRequiredError` |
| `requireAnyOrganisationPermission(id, list)` | first permission that passes; an MFA failure stops at once | the last access error |
| `requireOrganisationEventManagementAccess`, `requireOrganisationFinanceAccess`, `requireOrganisationStripeConnectAccess` | `events:manage`, `orders:read`, `stripe:manage` | as above |
| `requireStripeConnectCapability` | `stripe:manage` in any society (or legacy owner), then MFA; callers still authorise the target | `OrganisationAccessError` "Insufficient permissions" |
| `requireCurrentOrganisationAccount` | the selected dashboard context, then staff MFA | `OrganisationAccessError` "Organisation account has no organisation"; `StaffMfaRequiredError` |
| `requireOrganisationAccessBySlug` | any live staff role, else (member accounts) a join row | `OrganisationAccessError` |
| `getAccessibleOrganisationsForCurrentAccount` | a member's joined societies with running-membership end dates; an organisation account's selected society | — |
| `getCurrentStaffOrganisations`, `getOrganisationAccessForUser` | active staff societies (plus a live legacy one); `GET /api/orgs` list | — |
| `organisationActor(slug, permission)` (`lib/organisations/http.ts`) | sign-in, slug, `requireOrganisationPermission`; unknown slug is the no-role error | as above |
| `requireManagementPage(permission or list, callback)` (`lib/auth/page-access.ts`) | `requireCurrentOrganisationAccount` then the permission(s); returns the society and context choices | redirects `/login?callbackUrl=…` (401), `/mfa?callbackUrl=…` (MFA), else `notFound()` |
| `redirectLegacyOrganisationPage` | `/dashboard/[orgSlug]/*`: authorise that slug, forward to the slugless page only if it is the selected context, else `/dashboard`; a GET never changes context | `notFound()` |
| `lockOrganisationActor(tx, actor, id, permission)` | inside a service transaction: lock User then Organisation, recheck version, role and MFA grant | as above |

`StaffMfaRequiredError` extends `OrganisationAccessError`, not `MfaRequiredError`, so `organisationAccessRule` maps it to 403. A route whose rules name only `MfaRequiredError` lets it fall to 500: `GET /api/commerce/orders/[orderId]` does this for staff whose grant expired (DEF-048).

## Sessions

- Auth.js with a Credentials provider (`auth.ts`); sign-in page `/login`. `authorizeCredentials` lower-cases the email and compares an unknown or disabled address against a dummy bcrypt hash of the same cost, so sign-in takes as long whether or not an account exists (DEF-035). Passwords are bcrypt hashes.
- The JWT gets `userId`, `authVersion` and a random `staffMfaSessionId` (the login id) only at password sign-in; a cookie refresh can't add or upgrade them. A session issued before these claims existed must sign in again.
- Every `auth()` read, page, API guard, CSRF token and the proxy compare the token's `authVersion` with the live user (`getSessionIdentity`). Password reset or change, email change and closure increment it, so every other session dies at its next request. The `/api/auth/session` response is `null` for a dead session.
- `AUTH_SECRET` comes from one resolver, `lib/auth/secret.ts`, shared by `auth.ts` and `proxy.ts` so the proxy reads sessions with the key that signed them. Outside tests and builds it refuses empty, `dev-secret`, `replace-with-a-non-empty-secret` and the Dockerfile's build placeholder, and production also needs at least 32 characters (SEC-016).
- Cookies: Auth.js uses `__Secure-authjs.session-token` when the public URL (`AUTH_URL`, then `NEXTAUTH_URL`, then the request) is https, even behind a plain-http tunnel; otherwise `authjs.session-token`. The guest and context cookies are `Secure` in production or whenever that URL is https (SEC-017).
- Sign-out goes through `signOutTo`, which signs out without Auth.js's absolute redirect and then goes to a same-site path, so staging ports and second trusted addresses stay on themselves.
- `/login` shows why a session ended for `passwordChanged=true`, `emailChanged=true` and `accountClosed=true`.

## Proxy and page guards

- `proxy.ts` matches `/dashboard/:path*` and `/account/:path*` only. It reads the JWT, checks the live identity and `authVersion`, and redirects a missing, stale or disabled session to `/login` with the path and query as `callbackUrl`.
- Everything else guards itself: public event pages `/events/[eventId]` are public; checkout and confirmation pages ask for sign-in themselves.
- An organisation account sees public event pages as a buyer would; the ticket box says society accounts can't buy (`viewer: "society"`). It is not redirected.
- Management pages call `requireManagementPage` with their permission; the page-to-permission map is in [[Frontend and Backend Flow]]. A member account with no staff row reaches personal pages only.

## Staff MFA

- **Modes** (`MFA_ENFORCEMENT_MODE`): `off` (no checks), `enroll` (enrolled staff need a grant; unenrolled staff pass), `enforce` (every staff check needs enrollment and a grant). Unset is `off` in development; in production unset or invalid throws, so readiness and staff checks fail. Hosted compose must set `enforce`.
- **Config:** setup, confirm and verify answer 503 unless `MFA_ENCRYPTION_KEY` is a base64 32-byte key and `RATE_LIMIT_ENABLED=true`; any mode except `off` needs the same.
- **Eligible:** an active staff row, or a legacy pointer with no staff row. An enrolled former staff member can still verify (for account security) without gaining authority.
- **Setup:** TOTP (SHA-1, six digits, 30 s), secret AES-256-GCM encrypted with a 16-byte tag; a pending secret lasts 10 minutes. Confirming returns ten one-time recovery codes (20 hex characters, stored as HMACs keyed by the MFA key) and grants the current login.
- **Verify:** a code is accepted for the previous, current or next 30 s step and never twice (`lastAcceptedStep`); a recovery code is deleted when used. A grant is keyed by an HMAC of the login id (`mfaGrantDigest`) and lasts 12 hours. A new sign-in needs its own verification.
- **Where it applies:** every `requireOrganisationPermission`, `requireCurrentOrganisationAccount`, `requireStripeConnectCapability` and `lockOrganisationActor`. Pages redirect to `/mfa`; APIs answer 403. Member purchases and joined-society views never need it.
- **Fresh codes:** refunds, cancellations, membership revoke and the Connect dashboard and disconnect also take a code in the body unless the mode is `off` ([[Route Security Inventory#Guard order]]).
- **Grants end** at expiry (the stale-orders worker then deletes them, [[Route Security Inventory#Tokens at rest]]). Password reset or change, email change and closure delete all of a user's grants at once.
- Audit rows `staff_mfa.enabled`, `staff_mfa.verified`, `staff_mfa.recovery_used` go to every society the person staffs.

## Dashboard context

- `GET /api/me/context` lists live staff societies with each role's permissions. `POST` selects `{mode: "personal"}` or `{mode: "staff", organisationId}`; staff mode rechecks `events:read` and MFA on the target.
- The choice is a signed, HttpOnly, SameSite=Lax cookie `thunderstrux-context` bound to user id, `authVersion` and login id. It is a preference, never authority: every request resolves it against live staff rows, and a revoked, tampered or stale choice selects nothing, never another society.
- A new sign-in invalidates it, so member staff start personal on each login. An organisation account with no context cookie selects its bootstrap society while that society still gives it a live role.
- The sidebar and mobile menu show only links the current role can use. Check-in staff see published events and attendance; event managers see attendance analytics without money; finance sees orders, refunds and money.
- `POST /api/orgs` (bootstrap) deletes the context cookie, so a stale personal choice can't hide the new society.

## Account lifecycle

- **Signup** (`/signup`, `POST /api/auth/signup`): `member` (default) or `organisation`. Always the same 202, for new and existing addresses; it never signs in. Creates an unverified account, a verification token digest and an encrypted notification atomically. Passwords: 8 or more characters and at most 72 UTF-8 bytes (`newPasswordSchema`).
- **Verification** (`/verify-email`): a token lasts 24 hours, single use; the latest one wins and resending cancels the previous queued email. Confirming needs the account's password, so a mailbox owner can't verify an account someone else registered (SEC-008); a wrong password leaves the link unused.
- **What needs verification:** purchases, joins, society bootstrap, staff invitations (issue and accept), handover. Rechecked under the account lock in the writing transaction. Unverified users can sign in, edit their profile and leave a society. Older accounts are not silently verified.
- **Reset** (`/forgot-password`, `/reset-password`): always the same 202. A 30-minute token bound to user, email and `authVersion`; the raw link exists only in the encrypted email. Confirming sets the password, increments `authVersion`, deletes every MFA grant, invalidates outstanding tokens and queues a security notice; enrollment and recovery codes stay. A completed reset also verifies an unverified email (it proves the mailbox). It never signs in.
- **Password change** (`/account/settings`): current password, plus a live grant whenever an authenticator is enrolled, even in mode `off`. Same effects as reset, without touching verification.
- **Email change** (`/change-email`): request, confirm and cancel need the current password, any enrolled authenticator, a live session and CSRF. The request alerts the old address and sends a 30-minute confirmation to the new one, whether or not that address is taken; the old login stays valid until confirmation. Confirmation rechecks uniqueness, sets the new email verified, increments `authVersion`, revokes grants and tokens, and notifies both addresses. Pending staff invitations to a verified old address are cancelled. Orders, tickets, joins and staff rows keep their user id.
- **Emailed links** (verification, reset, email change, guest, staff invite): the token travels in the URL fragment, a parser-time script captures it before hydration, the page removes it from history and redeems only on an explicit POST. Opening or prefetching never consumes a link. Callback paths go through `safeReturnPath`, which also refuses paths that normalise to `//host` (SEC-012).
- Account security events and notices are private to the account; they never appear in society History or notifications.

## Account closure

- Needs the current password, every enrolled authenticator (whatever the mode), a live session, CSRF, `account_security_change` and the exact acknowledgement `CLOSE MY ACCOUNT`. `GET /api/me/account/closure` is advisory; the POST rechecks under the account and order locks.
- **Blocked by:** active owner authority or a legacy pointer (hand over first), pending ticket, membership or merchandise orders, unresolved ticket compensation, and paid ticket orders (over $0) for events that haven't ended. A manual refund marker is not Stripe truth and doesn't clear a blocker.
- **Effect, in one transaction:** disable and mark the user closed, increment `authVersion`, replace the login email and password with unusable values, clear the editable profile and verification, delete MFA secrets, recovery codes, grants and tokens, cancel pending token emails, revoke active staff rows and pending invitations sent to or by the account, remove free join rows, record a private security event and queue a notice to the former address. The database refuses to clear or change `closedAt`; there is no self-service reversal.
- **Kept:** orders, tickets, attendance, audit and security records and the user id. Ticket orders without a purchase-time buyer capture get the current email and name with provenance `current_account_at_capture`; existing captures never change. A later signup at the same email is a new, unverified user with no old records.

## Guest access

- A guest proves an email without an account (`/guest/access`). The link token and session id are random 32-byte values; `GuestAccessGrant` stores their SHA-256 digests. A checkout link lasts 30 minutes and works once; the session cookie `thunderstrux-guest` (HttpOnly, SameSite=Lax) lasts two hours. Redemption locks the `GuestIdentity` row, so two clicks start one session.
- **Purposes:** a `checkout` session can buy (tickets and merchandise, not memberships) and reopen the orders its own checkout attempts made. A `purchase` session, from a ticket email, a guest merchandise receipt or a Find your purchase link (24 hours, once; up to the latest ten paid ticket orders and ten merchandise orders not claimed by a member), opens that one order and can't buy.
- `canOpenGuestOrder` and `canOpenGuestCommerceOrder` are the only rules for `/guest/orders/[orderId]` and `/merchandise/orders/[orderId]`; a missing, foreign or guessed order shows the same page.
- Guest writes carry `x-thunderstrux-guest-csrf`, an HMAC of the session id. `lib/guest/guest-csrf.ts` is the only guest module that loads the auth secret, so workers that mint guest links don't need it.
- A guest session is not a login and grants no member, staff or account access. Signing up or in with the same email claims nothing.
- **Add to my account** (`claimGuestOrder`): needs the member's login, a verified account and the guest session that opens the order. Under User, GuestIdentity, Order locks it checks the guest's verified email is the member's current email, sets `Order.userId` once and writes `order.guest_claimed`; the buyer snapshot and `verified_guest` provenance stay. A repeat by the same member is a no-op.

## Staff invitations

- Create and resend need live `staff:manage`, a verified issuer, staff MFA and both invite limits; only owners invite owners. The invite, the encrypted email and the audit row commit together; responses carry metadata only, never the token. Lists are capped at 100 staff and 100 pending invitations.
- Links last seven days. Resend rotates the token digest and version, replaces the issuer and cancels older queued emails; revoke cancels pending delivery.
- Acceptance (`/staff/invites/accept`) is an explicit POST by the matching verified, non-disabled identity. It rechecks the issuer's live authority under sorted User, Organisation and invite locks. An existing active role is kept; replaying an accepted token reports current access and never restores a revoked one.
- Revoking a staff member (directly, or as the outgoing owner of a handover) revokes their pending invitations to that society, so they can't rejoin without a manager (SEC-006). Closure cancels invitations sent by the closed account. Acceptance never selects a context.

## Owner handover

- An active owner hands ownership to another active, verified, non-disabled staff member of the same society, with the current password and the exact text `HAND OVER OWNERSHIP`; the outgoing owner becomes `admin` or `revoked`. An enrolled actor must verify this login even in mode `off`; `enforce` needs both people enrolled.
- Sorted User locks (actor, target, any legacy pointer), then the Organisation lock, recheck everything. The incoming owner is promoted before the outgoing access drops, so one active owner always remains. The legacy `accountUserId` is cleared and audited (`staff.ownership.handed_over`), never transferred. Nothing else moves: credentials, MFA, joins, history and Stripe setup stay where they are.
- Admins can't hand over. A foreign, self, missing or ineligible target and a concurrent change all answer one generic 409.

## Rules

- Trusted: the live session's user id, live `OrganisationStaff` rows, the canonical tenant the server resolves, `Organisation.accountUserId` only through the legacy mode, `OrganisationMember` for joins only.
- Not authority: the account kind, client role state, a client `organisationId`, headers such as `x-org-id` or `x-user-role`, join rows, the context cookie.
- One active owner always remains; last-owner changes serialise on the Organisation lock and audit in the same transaction.
- A society account can bootstrap one society; a retained pointer or active staff authority blocks another. Revoked rows alone don't.

## Traps

- Don't check `accountRole === "organisation"` for management power; call `requireOrganisationPermission` or `organisationActor`.
- A route that maps only `MfaRequiredError` turns an expired staff grant into a 500 (DEF-048); include `organisationAccessRule` or map `StaffMfaRequiredError`.
- Adding a permission means adding it to `organisationPermissions`, each role's list, this matrix, and the route or page that checks it.
- Rolling back past the account migrations (password recovery, email change, closure) leaves an older build that can't enforce session revocation or the closure fences; pause account changes first ([[Production Operations]]).

## Related

[[Route Security Inventory]] · [[API Reference]] · [[Frontend and Backend Flow]] · [[Audit Coverage]] · [[Email Delivery Implementation]] · [[Production Operations]] · [[Database and Multi Tenancy]]
