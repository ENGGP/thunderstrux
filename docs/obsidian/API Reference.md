---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[API Reference Societies]]", "[[API Reference Commerce]]", "[[Route Security Inventory]]", "[[Authentication and Dashboard Access]]", "[[Audit Coverage]]"]
sources: [app/api, lib/api/errors.ts, lib/api/request.ts, lib/api/route-rules.ts, lib/pagination/cursor.ts, lib/auth/account-security-http.ts, lib/auth/lifecycle-http.ts, lib/guest/guest-access.ts, lib/security/staff-mfa.ts]
---

# API Reference

**Owns:** the request and response contract of every `app/api/**/route.ts`: shared conventions, and the platform, account, MFA, context and guest routes. Societies, events and attendance are in [[API Reference Societies]]; checkout, orders, memberships, merchandise, Stripe and notifications in [[API Reference Commerce]].
**Read when:** calling, changing or adding an API route, or reading a client that does.
**Not here:** the order of guard checks and rate-limit numbers ([[Route Security Inventory]]); roles and permissions ([[Authentication and Dashboard Access#Roles and permissions]]); audit actions ([[Audit Coverage]]); pages such as `/tickets` and `/dashboard/orders` ([[Frontend and Backend Flow]]); logs and alerts ([[Production Operations#Logs, metrics and alerts]]).

## Code

| Concern | Where |
| --- | --- |
| Error envelope, mapper | `lib/api/errors.ts`: `apiError`, `mapRouteError`, `routeErrorRule` |
| Shared error rules | `lib/api/route-rules.ts`: `authenticationRule` (401), `staleSessionRule` (401), `organisationAccessRule` (403) |
| Body parsing | `lib/api/request.ts`: `validateJson` (re-exported by `lib/validators/index.ts`) |
| Pagination | `lib/pagination/cursor.ts`: `parsePaginationOptions`, `PageInfo` |
| Family helpers | `lib/auth/account-security-http.ts`, `lib/organisations/http.ts`, `lib/events/http.ts`, `lib/tickets/http.ts`, `lib/memberships/http.ts`, `lib/merchandise/http.ts`, `lib/commerce/http.ts`, `lib/stripe/http.ts`, `lib/staff/invite-http.ts`, `lib/purchases/pending-checkout-http.ts` |

## Conventions

- **Errors:** `{ error: { code, message, details: [{ path?, message, reason?, value? }] } }`. Codes: `BAD_REQUEST` and `VALIDATION_ERROR` (400, the latter "Invalid request body" with up to 20 issues), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500, generic), `SERVICE_UNAVAILABLE` (503). Clients choose what to show from `reason` and `value`, never from `message`.
- **Exceptions to the envelope:** Auth.js, both Stripe webhooks, the health routes and `GET /api/security/csrf`; the Connect `PLATFORM_NOT_READY` answer and profile and asset errors use their own shapes where noted.
- **401** for no session or a stale one (`authVersion` changed, disabled account). **403** for a missing permission, staff MFA, origin or CSRF. **404** also hides another society's or another buyer's ids: a foreign id answers exactly like a missing one.
- **Writes** need a trusted `Origin` (or `Referer`) and, with a login cookie, the `x-thunderstrux-csrf-token` header from `GET /api/security/csrf`; guest writes send `x-thunderstrux-guest-csrf` ([[Route Security Inventory#Trusted origin and CSRF]]).
- **Bodies** are JSON up to 100 KB, checked by the zod schema each row names ([[Route Security Inventory#Request bodies]]).
- **Money** is integer cents; times are ISO instants; a dashboard builder converts the society's wall-clock times before sending.
- **Pagination:** `limit` 1 to 100 (default 25), opaque `cursor`, `direction` `next` or `prev`; answers carry `pageInfo` (`limit`, `hasNextPage`, `hasPreviousPage`, `nextCursor`, `previousCursor`). A bad value is 400.
- **Caching:** `private, no-store` unless the route says otherwise ([[Route Security Inventory#Headers and caching]]).
- **Rate buckets** are named per row; numbers are in [[Route Security Inventory#Rate limits]].

## Family index

| Family | Routes | Note |
| --- | --- | --- |
| Health and platform | `/api/health`, `/api/health/ready`, `/api/security/csrf` | here |
| Sign-in and account | `/api/auth/*`, `/api/me/account*`, `/api/me/profile`, `/api/me/notification-preferences` | here |
| Staff MFA and dashboard context | `/api/me/mfa/*`, `/api/me/context` | here |
| Guest access | `/api/guest/*` | here |
| Societies, staff, profile, assets, calendar | `/api/orgs*`, `/api/staff/invites/accept` | [[API Reference Societies]] |
| Events and attendance | `/api/events*`, `/api/tickets/*` | [[API Reference Societies]] |
| Public reads | `/api/public/*` | [[API Reference Societies]] |
| Membership and merchandise catalogue | `/api/orgs/[orgSlug]/memberships*`, `/api/orgs/[orgSlug]/merchandise*`, `/api/merchandise/quote` | [[API Reference Societies]] |
| Checkout and buyer purchases | `/api/payments/checkout/*`, `/api/purchases/*`, `/api/commerce/orders/*` | [[API Reference Commerce]] |
| Ticket orders (staff) | `/api/orders*` | [[API Reference Commerce]] |
| Membership and merchandise orders (staff) | `.../memberships/members/*`, `.../merchandise/orders/*`, `.../merchandise/pickups/*` | [[API Reference Commerce]] |
| Notifications | `/api/notifications*` | [[API Reference Commerce]] |
| Stripe Connect and webhooks | `/api/stripe/connect/*`, `/api/payments/webhook` | [[API Reference Commerce]] |

## Health and platform

| Route | Auth | Answer |
| --- | --- | --- |
| `GET /api/health` | public | `{status: "ok", service: "thunderstrux"}`; no secrets, tenants or config |
| `GET /api/health/ready` | public | `{status: "ready", service}` when notification encryption config, `LEGACY_ORGANISATION_ACCESS_MODE`, staff MFA config, the database (a `User` read and `config/schema-contract.json`'s required migration, 2 s timeout) and Redis (when rate limiting is on) are ready; else 503 `{status: "unavailable"}` with no reason (`lib/ops/readiness.ts`). `no-store` |
| `GET /api/security/csrf` | live session | `{token}` for the current login, valid this UTC hour; 401 without a session. `no-store` |

## Sign-in and account

All answers are `no-store`. Account-security writes run through `accountSecurityMutation` (`lib/auth/account-security-http.ts`): live session, `account_security_change`, strict body, then the service checks the current password and any enrolled authenticator. Its errors: stale session 401, `AccountSecurityError` 403 (wrong password or MFA), token or email-change errors 400, Redis down or limits off 503.

| Route | Auth, bucket | Body | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `GET`/`POST /api/auth/[...nextauth]` | Auth.js; credentials callback: `login_ip_global`, `login_ip_email` | form | Auth.js | 400 "Send one email address" when the form repeats `email` (SEC-007). `GET /api/auth/session` answers `null` for a dead session |
| `POST /api/auth/signup` | public; `signup_ip`, `signup_email` (`signup`) | `lib/validators/auth.ts:signupSchema` (`accountRole` defaults `member`) | 202 `{accepted: true}` for new and existing addresses | creates an unverified account, token and encrypted email atomically; never signs in |
| `POST /api/auth/verification/request` | public; `signup_ip`, `signup_email` (`verification`) | strict `{email, callbackUrl?}` | 202 `{accepted: true}` | sends only to an existing, unverified, enabled account |
| `POST /api/auth/verification/confirm` | public; `account_token_ip`, `account_token_digest` | strict `{token, password}` | `{verified: true, callbackUrl}` | 400 one generic message for a wrong password or a bad, used, expired or superseded link (the link stays usable after a wrong password) |
| `POST /api/auth/password/request` | public; `signup_ip`, `signup_email` (`password_reset`) | strict `{email, callbackUrl?}` | 202 `{accepted: true}` | 30-minute link in an encrypted email |
| `POST /api/auth/password/confirm` | public; `account_token_ip`, `account_token_digest` | strict `{token, newPassword}` (`newPasswordSchema`) | `{reset: true, callbackUrl}` | 400 bad link; signs other sessions out, deletes MFA grants, verifies the email; never signs in |
| `GET /api/me/account` | live session | — | `{user, mfa: {enabled, verified}, pendingEmailChange: {email, expiresAt} \| null, securityEvents}` (latest ten) | 401 stale. `private, no-store` |
| `POST /api/me/account/password` | `account_security_change` | strict `{currentPassword, newPassword}` | `{changed: true, signInRequired: true}` | 403 wrong password or missing MFA grant |
| `POST /api/me/account/email/request` | `account_security_change` | strict `{currentPassword, newEmail}` | 202 `{accepted: true}` | alerts the old address, sends a 30-minute link to the new one |
| `POST /api/me/account/email/confirm` | `account_security_change`, then `account_token_ip`, `account_token_digest` | strict `{currentPassword, token}` | `{changed: true, signInRequired: true}` | 400 bad, foreign or taken address (one message) |
| `POST /api/me/account/email/cancel` | `account_security_change` | strict `{currentPassword}` | `{cancelled: true}` | invalidates outstanding change links |
| `GET /api/me/account/closure` | live session | — | `{eligible, blockers}` (advisory) | `private, no-store` |
| `POST /api/me/account/closure` | `account_security_change` | strict `{currentPassword, acknowledgement: "CLOSE MY ACCOUNT"}` | `{closed: true, signInRequired: true}` | 409 blocked (blockers joined in the message), 400 acknowledgement, 403 password or MFA |
| `PATCH /api/me/profile` | member account; no bucket | `lib/validators/auth.ts:memberProfileSchema` | `{user}` | 403 for an organisation account; sets `onboardingCompletedAt`; rechecks `authVersion` under the account lock |
| `PATCH /api/me/notification-preferences` | live session; no bucket | strict `{renewalReminders: boolean}` | `{preferences: {renewalReminders}}` | optional mail only |

What each flow does, and its token rules: [[Authentication and Dashboard Access#Account lifecycle]] and [[Authentication and Dashboard Access#Account closure]].

## Staff MFA and dashboard context

MFA writes answer 503 "Staff verification is unavailable" unless `MFA_ENCRYPTION_KEY` and `RATE_LIMIT_ENABLED=true` are set; confirm and verify answer 401 when the session has no login id. Their bodies are read with raw `request.json()` (SEC-028).

| Route | Auth, bucket | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/me/mfa/status` | session; staff-eligible or enrolled | — | `{enabled, mode}` | 403 not eligible |
| `POST /api/me/mfa/setup` | `staff_mfa_setup` | none | `{secret, otpauthUrl}`; pending 10 minutes | 403 not eligible or already enabled, 400 no email |
| `POST /api/me/mfa/confirm` | `staff_mfa_verify` | `{code}` | `{recoveryCodes}` (ten, shown once); grants this login; audit `staff_mfa.enabled` | 400 bad, expired or changed setup |
| `POST /api/me/mfa/verify` | `staff_mfa_verify` | `{code}` (six digits or a recovery code) | `{verified: true}`; 12-hour grant; audit `staff_mfa.verified` or `staff_mfa.recovery_used` | 400 wrong or reused code, 403 not enrolled |
| `GET /api/me/context` | session | — | `{mode: "personal" \| "staff", selected, organisations: [{id, name, slug, createdAt, staffRole, permissions}], accountRole}` | 401 |
| `POST /api/me/context` | session; no bucket | strict `{mode: "personal"}` or `{mode: "staff", organisationId}` | `{selected: true}` and the `thunderstrux-context` cookie | 403 no login id ("Sign out and sign in again…"), 403 no `events:read` or MFA on the target |

Rules: [[Authentication and Dashboard Access#Staff MFA]] and [[Authentication and Dashboard Access#Dashboard context]].

## Guest access

All `no-store`; the token routes use token authority, so a stale login cookie never demands the CSRF token.

| Route | Auth, bucket | Body | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `POST /api/guest/email/request` | public; `guest_email_ip`, `guest_email_address` | strict `{email, callbackUrl?}` | 202 `{accepted: true}` for any address | creates or reuses the `GuestIdentity`, revokes its unused checkout links (cancelling their emails) and queues one `guest_access` email linking `/guest/access#token=…` (30 minutes, once) |
| `POST /api/guest/email/confirm` | public; `guest_token_ip`, `guest_token_digest` | strict `{token}` | `{callbackUrl}` (safe local path, default `/events`) and cookie `thunderstrux-guest` (two hours) | 400 one generic message for wrong, used, revoked, superseded or expired links |
| `GET /api/guest/session` | guest cookie | — | `{email, expiresAt, csrfToken}` | 401 "Your guest session has ended…" |
| `POST /api/guest/recover` | public; same buckets with a `recover` key | strict `{email}` | 202 `{accepted: true}` | for a known guest: revokes unused links and queues one `guest_order_link` email per paid guest ticket order and merchandise order (latest ten of each, not claimed), each link 24 hours, once |
| `POST /api/guest/orders/[orderId]/claim` | member session + CSRF, guest session | none | `{claimed: true}`, or `{claimed: false}` when already this member's | 401, 403 unverified, 404 the guest session doesn't open the order, 409 `reason` `email_mismatch` or `already_claimed`. Audit `order.guest_claimed` |

Session purposes and the claim rules: [[Authentication and Dashboard Access#Guest access]].

## Traps

- A new route goes in this note's family index and in the right part note, with its bucket here by name and its check row in [[Route Security Inventory#Per-route checks]].
- Never answer 403 where a foreign id could be probed; use the 404 the family already uses.
- Keep provider and server configuration out of messages: Stripe errors map to generic text. The Connect 503 is the known exception (API-002, [[API Reference Commerce]]).

## Related

[[API Reference Societies]] · [[API Reference Commerce]] · [[Route Security Inventory]] · [[Authentication and Dashboard Access]] · [[Audit Coverage]] · [[Frontend and Backend Flow]]
