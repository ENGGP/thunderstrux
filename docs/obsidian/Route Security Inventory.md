---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[API Reference]]", "[[Authentication and Dashboard Access]]", "[[Audit Coverage]]", "[[Production Operations]]"]
sources: [lib/security/request-guard.ts, lib/security/csrf.ts, lib/security/rate-limit.ts, lib/api/request.ts, lib/api/errors.ts, lib/api/route-rules.ts, lib/security/token-cleanup.ts, next.config.ts, tests/integration/route-contract.test.ts, tests/integration/security-headers.test.ts, tests/integration/security-limits.test.ts, tests/integration/rate-limit.test.ts]
---

# Route Security Inventory

**Owns:** what every API route checks and in which order: trusted origin and CSRF, rate-limit policies and their numbers, client IP keys, body caps, security headers and caching, and the per-route check table.
**Read when:** adding or changing an API route, a limit, a header, or anything a request must pass before it reaches a service.
**Not here:** request and response shapes ([[API Reference]]); roles, permissions, sessions and MFA ([[Authentication and Dashboard Access]]); what each change records ([[Audit Coverage]]); log events and alerts ([[Production Operations#Logs, metrics and alerts]]).

## Code

| Concern | Where |
| --- | --- |
| Trusted origin and session CSRF | `lib/security/request-guard.ts`: `enforceTrustedMutationRequest`, `trustedRequestOrigin` |
| CSRF token | `lib/security/csrf.ts`: `createCsrfTokenForRequest`, `verifyCsrfTokenForRequest`, header `x-thunderstrux-csrf-token`; issued by `GET /api/security/csrf` |
| Guest CSRF | `lib/guest/guest-csrf.ts`: `verifyGuestCsrf`, header `x-thunderstrux-guest-csrf` |
| Rate limits | `lib/security/rate-limit.ts`: `enforceRateLimit`, `getRateLimitClientIp`, `clientKey`, `policies` |
| Account-link limits | `lib/auth/lifecycle-http.ts`: `lifecycleIpLimit`, `lifecycleEmailLimit`, `lifecycleRedemptionLimit` |
| Body reading | `lib/api/request.ts`: `readJsonBody`, `parseJsonBody`, `validateJson` |
| Error envelope | `lib/api/errors.ts`: `mapRouteError`, `apiError`; shared rules `lib/api/route-rules.ts` |
| Headers, default caching | `next.config.ts`: `securityHeaders`, `contentSecurityPolicy`, `headers()` |
| Expired token cleanup | `lib/security/token-cleanup.ts`: `cleanUpExpiredTokens` |
| Contract test | `tests/integration/route-contract.test.ts` fails a route that skips `mapRouteError` or, when it writes, the origin check (its exemption lists name each exception and why) |
| Tests | `tests/integration/security-limits.test.ts`, `tests/integration/rate-limit.test.ts`, `tests/integration/security-headers.test.ts`, `tests/e2e/security-headers.spec.ts` |

## Guard order

There is no one universal order. Each family runs its checks in this order; a refused request writes nothing, and the owning service rechecks authority under its row lock (`lockOrganisationActor` in `lib/organisations/authority.ts`) before it writes.

| Family | Order |
| --- | --- |
| Sign-up and link requests (`auth/signup`, `auth/verification/request`, `auth/password/request`) | origin → `signup_ip` → body → `signup_email` (per purpose) → service |
| Link redemption (`auth/verification/confirm`, `auth/password/confirm`) | origin → body → `account_token_ip` → `account_token_digest` → service |
| Sign-in (`auth/[...nextauth]`, credentials callback only) | `login_ip_global` → one `email` field (else 400, SEC-007) → `login_ip_email` → `login_email` (per account across addresses, DEBT-002) → Auth.js (its own CSRF) |
| Guest links (`guest/email/request`, `guest/recover`) | origin → `guest_email_ip` → body → `guest_email_address` → service |
| Society enquiry (`orgs/[orgSlug]/enquiries`) | origin → `society_enquiry` (IP, slug) → body → `society_enquiry` (sender) → service |
| Guest redemption (`guest/email/confirm`) | origin → body → `guest_token_ip` → `guest_token_digest` → service |
| Account security (`me/account/password`, `me/account/email/*`, `POST me/account/closure`) | origin → sign-in (live `authVersion`) → `account_security_change` → body → email confirm only: `account_token_ip`/`account_token_digest` → service (current password, enrolled MFA) |
| Profile, notification preferences | origin → body → sign-in → service (no rate limit) |
| Dashboard context `POST me/context` | origin → body → sign-in → login id present → staff mode: `events:read` + MFA on the target |
| Staff MFA (`me/mfa/setup`, `confirm`, `verify`, `recovery-codes`) | origin → config (`MFA_ENCRYPTION_KEY`, `RATE_LIMIT_ENABLED=true`, else 503) → sign-in → `staff_mfa_setup` / `staff_mfa_verify` → bounded strict body → setup and `recovery-codes`: the account password |
| Event writes (`PATCH`/`DELETE events/[eventId]`, `publish`, `sales`) | origin → dashboard context (+MFA) → `events:manage` → sign-in → body |
| `POST /api/events` | origin → body → `events:manage` on the body's `organisationId` → sign-in |
| Event reads (`GET events`, `GET events/[eventId]`) | `orgId` query → `events:manage` |
| Check-in, check-out | origin → dashboard context → `tickets:check_in` → `ticket_check_in_out` → sign-in |
| Staff order decisions (`refunds`, `cancel`, `review`) | origin → context → permission → sign-in → body → `staff_mfa_verify` when a code is sent → fresh code unless MFA mode `off` → service |
| `refund-manual` | origin → context → `orders:refund_mark` → sign-in → strict body → `staff_mfa_verify` when a code is sent → fresh code unless `off` |
| `resend` | origin → context → `orders:email_resend` → order in this society (404) → `order_resend` → sign-in |
| Email and notification requeue | origin → context → `orders:email_resend` → order/job exists (404) → `order_resend` → bounded strict body → sign-in |
| `compensation-refund/confirm` | origin → body → context → `orders:refund` → sign-in → `staff_mfa_verify` when a code is sent → fresh code unless MFA is `off` (SEC-036) |
| Society slug routes (`organisationActor`: profile, assets, calendar, memberships, merchandise) | origin (writes) → sign-in → slug → permission (+MFA) → rate limit where one applies → body |
| Staff end routes (membership revoke/cancel/refund, merchandise refund/cancel) | as slug routes, then `staff_mfa_verify` when a code is sent → fresh code unless `off` |
| Staff management | list: slug → `staff:manage`. `PATCH`: origin → body → sign-in → slug → `staff:manage`. Invites: origin → body → verified → slug → `staff:manage` (owner role needs an owner) → invite limits. Handover: origin → body → verified → slug → owner → `account_security_change` |
| Invite acceptance | origin → body → `account_token_ip` → `account_token_digest` (keys prefixed `staff_invite`) → verified |
| Society bootstrap `POST /api/orgs` | origin → organisation account → verified → `organisation_create` → body |
| Join / leave | origin → member account → (join only) verified → `organisation_join_leave` |
| Stripe Connect | origin → `requireStripeConnectCapability` (`stripe:manage` somewhere, +MFA) → body → `organisationId` → `stripe:manage` on it (+MFA) → `stripe_connect_mutation` → `staff_mfa_verify` when a code is sent. Status `GET`: capability → target → `stripe_connect_status` (SEC-037) |
| Checkout (`payments/checkout/*`) | origin → body → guest branch (no login and a guest cookie: `checkout` session → guest CSRF → `checkout_create`) or member branch (verified → member account → `checkout_create`) |
| Buyer cancel (`purchases/tickets/[orderId]/cancel`, `purchases/tickets/[orderId]/cancel-registration`, `commerce/orders/[orderId]/cancel`) | origin → order → guest (guest CSRF) or sign-in → buyer owns it (else 404) → `checkout_create` (`authorizeBuyer` in `lib/purchases/pending-checkout-http.ts`) |
| Buyer reads (status, attempts, commerce order) | session or guest session → ownership (else 404); no origin check, no rate limit |
| Webhooks | Stripe signature on the raw body; nothing else |

## Rules

- **Authority is live.** Staff permission is read from `OrganisationStaff` on every request through `requireOrganisationPermission` and `liveStaffRole` ([[Authentication and Dashboard Access#Roles and permissions]]), never from the session or a client id. The tenant is the canonical owner (an event's society, a commerce order's society, the selected dashboard context, or a slug), never a body field taken on trust. Another society's ids answer the same 404 as a missing one.
- **Fresh staff code.** Outside MFA mode `off`, cancelling an event (one code for all its refunds, `requireFreshStaffMfa` in `lib/security/fresh-staff-mfa.ts`), ticket refunds and free cancellations, membership revoke, cancel and refund, merchandise refund and free cancellation, and the Connect dashboard link and disconnect each need an authenticator code in the body, verified at the route (`verifyStaffMfa`), not only the login grant.
- **Errors.** Every route maps failures through `mapRouteError` (directly or through its family helper). Unknown errors answer a generic 500 and log `api.request_failed` with the operation and error class only. Exempt: Auth.js, both Stripe webhooks, `health`, `health/ready`, `security/csrf`.
- **Bounds.** Prices follow `lib/validators/price.ts` (free, or 50 to 99,999,999 cents, Stripe's largest charge); ticket stock and capacity stop at 1,000,000 (`lib/validators/events.ts`), merchandise stock at 100,000; commerce totals are summed in `BigInt` and capped at 2,147,483,647 (`lib/commerce/orders.ts`).

## Trusted origin and CSRF

`enforceTrustedMutationRequest(request)` (every write except the webhooks, Auth.js and `merchandise/quote`):

- An `Origin` header must be exactly a serialised origin in the trusted set: `NEXT_PUBLIC_APP_URL` plus `TRUSTED_APP_ORIGINS` (comma list). `Origin: null` is refused.
- With no `Origin`, a `Referer` must have a trusted origin. With neither, the request is refused.
- Then, if the request carries an Auth.js session cookie, header `x-thunderstrux-csrf-token` must match. The token is `v1.<hour>.<hmac>` over the session cookie (chunks joined in order, first duplicate wins, SEC-027) and is valid for the current UTC hour only.
- Skipped for the eight token-authority paths, so a stale login cookie can't block them: `auth/signup`, `auth/verification/request`, `auth/verification/confirm`, `auth/password/request`, `auth/password/confirm`, `guest/email/request`, `guest/email/confirm`, `guest/recover`. Also skipped for `orgs/[orgSlug]/enquiries`, which reads no session at all (anyone may write to a society), so a session token protects nothing there; the origin check still applies.
- Refusals are 403 `Untrusted request origin` or `Invalid CSRF token`, logged as `trusted_origin.rejected` with the reason.
- Guest writes (checkout, buyer cancel) check `verifyGuestCsrf` against the guest session id instead.
- `trustedRequestOrigin` picks where Stripe returns the browser (Checkout success/cancel, Connect return/refresh): a trusted `Origin`, else the app URL, never the `Host` header. Emails and workers always use `NEXT_PUBLIC_APP_URL`.

## Rate limits

`enforceRateLimit({ policy, request, keyParts, required })` is a Redis fixed window (`INCR` + `EXPIRE`).

- **Switch.** Off unless `RATE_LIMIT_ENABLED=true`. When off, a call with `required: true` answers 503 and any other call passes. Hosted compose must set it (`scripts/container-config.mjs` refuses otherwise), so login, organisation-create, profile and MFA-verify limits, which are not `required`, are only off in local development.
- **Fail mode** applies when enabled and Redis fails: `closed` answers 503 `Request protection is temporarily unavailable`; `open` logs `rate_limit.backend_unavailable` and lets the request through.
- **Over the limit:** 429 `RATE_LIMITED` with `Retry-After`; logged `rate_limit.rejected` with policy, method and the path with ids replaced by `:id`.
- **Keys** are `policy:keyParts` hashed with SHA-256 under `RATE_LIMIT_KEY_PREFIX` (default `thunderstrux`). No raw email, user, order or IP reaches Redis or logs.
- **Redis client:** 1.5 s connect and command timeouts, three reconnects, offline queue off.

| Policy | Limit / window | Fail | Key parts | Routes |
| --- | --- | --- | --- | --- |
| `login_ip_global` | 50 / 10 min | closed | IP | credentials sign-in (not required) |
| `login_ip_email` | 10 / 10 min | closed | IP, email | credentials sign-in (not required) |
| `login_email` | 30 / 1 h | closed | email | credentials sign-in (not required); at worst someone else's guesses lock the account for an hour |
| `signup_ip` | 25 / 1 h | closed | IP (one bucket for all three) | signup, verification request, password request |
| `signup_email` | 3 / 1 h | closed | purpose (`signup`, `verification`, `password_reset`), email | same three; one bucket per purpose (SEC-026) |
| `account_token_ip` | 50 / 10 min | closed | IP; invites `staff_invite`, IP | verification confirm, password confirm, email-change confirm, invite accept |
| `account_token_digest` | 10 / 10 min | closed | token digest; invites `staff_invite`, digest | same |
| `account_security_change` | 5 / 1 h | closed | user | password change, email request/confirm/cancel, closure, owner handover |
| `organisation_create` | 5 / 1 h | closed | user, IP | `POST /api/orgs` (not required) |
| `checkout_create` | 5 / 10 min | open | user, event or family; `guest`, guest identity, event or family; `cancel`, order | ticket, membership and merchandise checkout; buyer cancel |
| `order_resend` | 10 / 15 min | open | society, order or job | resend, email-job requeue, notification requeue |
| `organisation_join_leave` | 30 / 10 min | open | user, slug, `join`/`leave` | join, leave |
| `ticket_check_in_out` | 300 / 1 min | open | society, `check-in`/`check-out` | check-in, check-out |
| `stripe_connect_mutation` | 20 / 10 min | open | society, action | Connect onboard, continue, dashboard, disconnect |
| `stripe_connect_status` | 30 / 10 min | open | society | Connect status read (each asks Stripe) |
| `staff_invite_actor` | 20 / 1 h | closed | actor, society | invite create, resend, revoke |
| `staff_invite_email` | 3 / 1 h | closed | society, address | invite create, resend |
| `data_export` | 20 / 1 h | closed | society, user | orders and attendee CSV downloads |
| `society_enquiry` | 5 / 1 h | closed | IP and slug; then sender email | Contact {society} (required) |
| `ticket_code_check` | 30 / 10 min | open | IP, event | a `?code=` read on the event and checkout pages (`codeForBuyer`), so codes can't be found by trying them; when limited the page says to wait |
| `staff_mfa_setup` | 5 / 1 h | closed | user | MFA setup (not required) |
| `staff_mfa_verify` | 10 / 10 min | closed | user | MFA confirm, verify and new recovery codes; every fresh-code action when a code is sent (not required) |
| `asset_upload` | 20 / 1 h | closed | `actor`, user; and `tenant`, society (two buckets) | asset upload |
| `asset_delete` | 30 / 10 min | closed | user, society | asset delete |
| `organisation_profile` | 30 / 10 min | closed | user, society | profile `PATCH` (not required) |
| `guest_email_ip` | 20 / 1 h | closed | IP; recovery adds `recover` | guest link request, Find your purchase |
| `guest_email_address` | 3 / 1 h | closed | email; recovery adds `recover` | same |
| `guest_token_ip` | 50 / 10 min | closed | IP | guest link redemption |
| `guest_token_digest` | 10 / 10 min | closed | token digest | guest link redemption |

Not rate limited: public reads (abusive read volume belongs to the hosting edge), `merchandise/quote`, `payments/checkout/attempts/[attemptId]`, buyer status reads, event and staff writes not listed above, the webhooks.

### Client IP

`getRateLimitClientIp` reads one header, `RATE_LIMIT_TRUSTED_PROXY_HEADER` (default `x-forwarded-for`), which the edge must overwrite with a single address. A bad header name, a missing value or a comma-separated chain all map to the shared key `unknown`; they are not refused, so such clients share one bucket. `clientKey` strips an IPv6 zone, maps `::ffff:a.b.c.d` to the IPv4 address and groups other IPv6 addresses by /64.

## Request bodies

- `validateJson` → `readJsonBody` reads at most 100,000 bytes (a larger `Content-Length` is refused before reading; the stream stops past the cap): 400 `Request body is too large`; bad JSON is 400 `Request body must be valid JSON`. Validation answers carry at most 20 issues.
- Profile `PATCH` reads with an 80,000-byte cap and answers 413. Asset upload reads multipart through `readImageForm` ([[Society Profiles and Assets]]).
- Most body schemas are `.strict()` (unknown keys 400). These strip unknown keys instead: `lib/validators/events.ts` (event create, update, publish, sales), `lib/validators/payments.ts:createEventCheckoutSchema`, `lib/validators/stripe-connect.ts`, `lib/validators/orgs.ts:createOrganisationSchema`, `lib/validators/auth.ts:signupSchema` and `memberProfileSchema`, `lib/validators/staff.ts:updateStaffSchema`, and the compensation confirm schema.

## Headers and caching

- `next.config.ts` adds to every path: `Content-Security-Policy` (`default-src 'self'`; scripts `'self' 'unsafe-inline'`, plus `'unsafe-eval'` in development; images also `data:` and `blob:`; `connect-src 'self'`, plus `ws:`/`wss:` in development; `frame-src`, `frame-ancestors`, `object-src` `'none'`; `form-action 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB, and outside development `Strict-Transport-Security` (one year, subdomains).
- Stripe is reached by navigation, so the CSP needs no Stripe allowance. Every browser test fails on a CSP violation.
- `/api/*` gets `Cache-Control: private, no-store` unless the path starts with `public/` or `health`. Routes that set their own: `GET /api/public/organisations/search` `public, max-age=60`; `GET /api/public/assets/[assetId]` `public, max-age=300` for a shared image and `private, no-store` for a members-only event image, with an `ETag` and 304; `GET /api/health/ready` `no-store`. `GET /api/public/events` and `GET /api/public/events/[eventId]` set none.
- `images.unoptimized`: `/_next/image` answers 404, so the server never keeps or transcodes withdrawn images.

## Tokens at rest

Sign-in, reset, verification and email-change tokens, guest access grants and staff MFA grants are stored as digests and expire. The stale-orders worker deletes MFA grants at expiry (`deleteExpiredMfaGrants`, 500 a run); the notification worker deletes auth tokens, guest grants and MFA grants 30 days past expiry, 500 of each a run, and logs `security.tokens.cleaned` ([[Production Operations]]).

## Per-route checks

Methods in backticks; "ctx" is the selected dashboard context ([[Authentication and Dashboard Access#Dashboard context]]); "+MFA" is the login grant when enforcement is on; "code" is a fresh authenticator code.

| Route | Checks |
| --- | --- |
| `GET` `/api/health`, `GET` `/api/health/ready` | public; no data |
| `GET` `/api/security/csrf` | live session |
| `GET`/`POST` `/api/auth/[...nextauth]` | Auth.js; login limits on the credentials callback |
| `POST` `/api/auth/signup`, `/api/auth/verification/request`, `/api/auth/password/request` | origin, `signup_ip`, `signup_email` |
| `POST` `/api/auth/verification/confirm`, `/api/auth/password/confirm` | origin, account token limits |
| `POST` `/api/guest/email/request`, `/api/guest/recover` | origin, guest email limits |
| `POST` `/api/guest/email/confirm` | origin, guest token limits |
| `GET` `/api/guest/session` | guest cookie |
| `POST` `/api/guest/orders/[orderId]/claim` | origin + CSRF, signed in, verified, guest session opens the order |
| `GET` `/api/me/account` | live session |
| `POST` `/api/me/account/password`, `/api/me/account/email/request`, `/api/me/account/email/confirm`, `/api/me/account/email/cancel`; `GET`/`POST` `/api/me/account/closure` | live session; writes: origin + CSRF, `account_security_change`, current password, enrolled MFA |
| `PATCH` `/api/me/profile` | origin + CSRF, member account |
| `PATCH` `/api/me/notification-preferences` | origin + CSRF, signed in |
| `GET`/`POST` `/api/me/context` | signed in; staff selection `events:read` +MFA |
| `GET` `/api/me/mfa/status`; `POST` `/api/me/mfa/setup`, `/api/me/mfa/confirm`, `/api/me/mfa/verify`, `/api/me/mfa/recovery-codes` | signed in, staff-eligible; writes: origin, MFA config, MFA limits |
| `GET`/`POST` `/api/events`; `GET`/`PATCH`/`DELETE` `/api/events/[eventId]`; `PATCH` `/api/events/[eventId]/publish`, `/api/events/[eventId]/sales` | `events:manage` +MFA; writes: origin, ctx |
| `POST` `/api/events/[eventId]/codes`; `PATCH` `/api/events/[eventId]/codes/[codeId]` | origin, ctx, `events:manage` +MFA; the event scoped to the selected society under its lock |
| `POST` `/api/events/[eventId]/cancel` | origin, ctx, `events:manage` and `orders:refund` +MFA, typed title, fresh code (`staff_mfa_verify` when sent) |
| `GET` `/api/events/[eventId]/tickets`; `POST` `/api/tickets/[ticketId]/check-in`, `/api/tickets/[ticketId]/check-out` (with `?eventId=`, DEBT-002) | ctx, `tickets:check_in` +MFA; writes: origin, `ticket_check_in_out` |
| `GET` `/api/orders`, `/api/orders/[orderId]` | ctx, `orders:read` +MFA |
| `GET` `/api/orders/export`, `/api/events/[eventId]/tickets/export` | ctx, `orders:read` +MFA (attendees also `tickets:check_in`), `data_export`; audited |
| `POST` `/api/orders/[orderId]/refunds`, `/api/orders/[orderId]/cancel`, `/api/orders/[orderId]/review` | origin, ctx, `orders:refund` +MFA; refunds and cancel also code |
| `PATCH` `/api/orders/[orderId]/refund-manual` | origin, ctx, `orders:refund_mark` +MFA, fresh code |
| `POST` `/api/orders/[orderId]/resend`, `/api/orders/[orderId]/email-jobs/[jobId]/requeue` | origin, ctx, `orders:email_resend` +MFA, `order_resend` |
| `POST` `/api/orders/[orderId]/compensation-refund/confirm` | origin, ctx, `orders:refund` +MFA, a fresh code unless MFA is `off`, Stripe refund evidence with the transfer reversed and the fee refunded |
| `GET` `/api/notifications`; `POST` `/api/notifications/[jobId]/requeue`, `/api/notifications/requeue` | ctx, `orders:email_resend` +MFA; requeue: origin, `order_resend` |
| `GET` `/api/orgs`; `POST` `/api/orgs` | signed in; create: origin, verified organisation account, `organisation_create` |
| `GET` `/api/orgs/search` | member account |
| `GET` `/api/orgs/[orgSlug]` | any live staff role in it, or a member join |
| `POST` `/api/orgs/[orgSlug]/join`, `/api/orgs/[orgSlug]/leave` | origin, member account (join: verified), `organisation_join_leave` |
| `POST` `/api/orgs/[orgSlug]/enquiries` | origin, no session, `society_enquiry` twice; sends only to the society's own addresses, never shown |
| `GET`/`PATCH` `/api/orgs/[orgSlug]/profile` | `organisation:settings` +MFA; `PATCH`: origin, `organisation_profile` |
| `POST` `/api/orgs/[orgSlug]/assets`; `GET`/`DELETE` `/api/orgs/[orgSlug]/assets/[assetId]` | the kind's permission +MFA; writes: origin, `asset_upload` / `asset_delete` |
| `GET` `/api/orgs/[orgSlug]/calendar` | `events:read` +MFA (drafts follow `events:manage`, membership ends `members:read`) |
| `GET`/`POST` `/api/orgs/[orgSlug]/memberships`; `PATCH` `/api/orgs/[orgSlug]/memberships/[planId]`; `POST` `/api/orgs/[orgSlug]/memberships/[planId]/publish`, `/api/orgs/[orgSlug]/memberships/[planId]/archive` | `memberships:manage` +MFA; writes: origin |
| `POST` `/api/orgs/[orgSlug]/memberships/members/[grantId]/revoke` | origin, `memberships:manage` +MFA, code |
| `POST` `/api/orgs/[orgSlug]/memberships/members/[grantId]/cancel`, `/api/orgs/[orgSlug]/memberships/members/[grantId]/refund` | origin, `orders:refund` +MFA, code |
| `GET`/`POST` `/api/orgs/[orgSlug]/merchandise`; `GET`/`PATCH` `/api/orgs/[orgSlug]/merchandise/[productId]`; `POST` `/api/orgs/[orgSlug]/merchandise/[productId]/publish`, `/api/orgs/[orgSlug]/merchandise/[productId]/archive`, `/api/orgs/[orgSlug]/merchandise/[productId]/restore` | `merchandise:manage` +MFA; writes: origin |
| `POST` `/api/orgs/[orgSlug]/merchandise/pickups`, `/api/orgs/[orgSlug]/merchandise/pickups/[orderId]`, `/api/orgs/[orgSlug]/merchandise/orders/[orderId]/returns` | origin, `merchandise:fulfil` +MFA |
| `POST` `/api/orgs/[orgSlug]/merchandise/orders/[orderId]/refund`, `/api/orgs/[orgSlug]/merchandise/orders/[orderId]/cancel` | origin, `orders:refund` +MFA, code |
| `GET` `/api/orgs/[orgSlug]/staff`; `PATCH` `/api/orgs/[orgSlug]/staff/[staffId]` | `staff:manage` +MFA; `PATCH`: origin, owner rows need an owner |
| `POST` `/api/orgs/[orgSlug]/staff/invites`, `/api/orgs/[orgSlug]/staff/invites/[inviteId]/resend`, `/api/orgs/[orgSlug]/staff/invites/[inviteId]/revoke` | origin, verified, `staff:manage` +MFA, invite limits |
| `POST` `/api/orgs/[orgSlug]/staff/handover` | origin, verified, owner +MFA, `account_security_change`, current password |
| `POST` `/api/staff/invites/accept` | origin, account token limits, verified invitee |
| `POST` `/api/stripe/connect/onboard`, `/api/stripe/connect/continue`, `/api/stripe/connect/dashboard`, `/api/stripe/connect/disconnect`; `GET` `/api/stripe/connect/status` | `stripe:manage` +MFA; writes: origin, `stripe_connect_mutation`, and a fresh code (onboarding, the dashboard and disconnect can change where money goes) |
| `POST` `/api/payments/checkout/event`, `/api/payments/checkout/membership`, `/api/payments/checkout/merchandise` | origin, verified member or guest `checkout` session + guest CSRF (not membership), `checkout_create` |
| `GET` `/api/payments/checkout/attempts/[attemptId]` | the attempt's own member or guest session |
| `POST` `/api/purchases/tickets/[orderId]/cancel`, `/api/purchases/tickets/[orderId]/cancel-registration`, `/api/commerce/orders/[orderId]/cancel` | origin, buyer or guest session + guest CSRF, `checkout_create` |
| `GET` `/api/purchases/tickets/[orderId]/status`, `/api/commerce/orders/[orderId]` | buyer or guest session; commerce also staff `orders:read` |
| `POST` `/api/payments/webhook`, `/api/stripe/connect/webhook`, `/api/stripe/accounts/webhook` | Stripe signature |
| `GET` `/api/public/events`, `/api/public/events/[eventId]`, `/api/public/organisations/search` | public |
| `GET` `/api/public/assets/[assetId]` | public image, or a members-only event image to a member it is open to |
| `POST` `/api/merchandise/quote` | public, no origin check (changes nothing) |

## Traps

- A new write route needs `enforceTrustedMutationRequest` (or the guest CSRF check) and `mapRouteError`, or `tests/integration/route-contract.test.ts` fails.
- A new account or token flow must pass `required: true`, or it runs unlimited when `RATE_LIMIT_ENABLED` is off.
- Don't key a limit on the client IP where the buyer or actor is known; a shared proxy maps many people to `unknown`.
- A new anonymous token endpoint must be added to the CSRF skip list in `lib/security/request-guard.ts`, or a stale login cookie blocks it.
- Script CSP keeps `'unsafe-inline'` until pages take a per-request nonce, which would make every page dynamic.

## Related

[[API Reference]] · [[Authentication and Dashboard Access]] · [[Audit Coverage]] · [[Production Operations]] · [[Society Profiles and Assets]]
