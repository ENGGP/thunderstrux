---
status: living
last-reviewed: 2026-10-22
owner: engineering
related: ["[[Audit Coverage]]", "[[Authentication and Dashboard Access]]", "[[API Reference]]", "[[Production Operations]]"]
sources: [lib/api/errors.ts, lib/api/route-rules.ts, lib/security/request-guard.ts, lib/security/rate-limit.ts, lib/security/token-cleanup.ts, next.config.ts, tests/integration/route-contract.test.ts, tests/integration/security-headers.test.ts, tests/integration/security-limits.test.ts, tests/e2e/security-headers.spec.ts]
---

# Route Security Inventory

What every API route checks, and in which order (T39). [[Audit Coverage]] lists what each change records. `tests/integration/route-contract.test.ts` fails if a new route skips the central error mapper or, when it changes data, the origin check.

## Rules every route follows

- **Order of checks.** Origin first (`enforceTrustedMutationRequest` for every write; guest pages also send a guest CSRF token), then the rate limit where one applies, then sign-in, then the body against a strict schema, then live authority. The service rechecks authority under its row lock before it writes. A refused request writes nothing.
- **Authority is live.** Staff permission is read from `OrganisationStaff` on every request (`requireOrganisationPermission`, `organisationActor`, `lockOrganisationActor`), never from the session or a client id. The tenant comes from the canonical owner (an event's society, a commerce order's society), never from the request body. Another society's ids answer the same 404 as a missing one.
- **Staff MFA.** Where enforcement is on, staff permission checks need a fresh authenticator grant. Refunds, membership revocations, merchandise refunds and cancellations, and Stripe disconnect ask for a code again (`staff_mfa_verify`).
- **Errors.** Every route maps failures through `mapRouteError` (directly or through its family's `http` helper). Known errors map to the documented status and message. Anything else answers a generic 500 and logs only the error's class and the operation, never the error object, its message, the request body or provider data. The exceptions are Auth.js, the two Stripe webhooks, health and readiness, and the CSRF token route, which keep their own response contracts.
- **Caching.** Every `/api` answer except `/api/public/*` and `/api/health*` is `Cache-Control: private, no-store` by default (`next.config.ts`). Public reads set their own short public caching.
- **Headers.** Every response carries a Content-Security-Policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy` and, in production, HSTS.
  - The CSP allows scripts, styles, images (including `data:` and `blob:` previews), fonts and requests only from this site.
  - It forbids framing in both directions, plugins and form posts elsewhere.
  - Stripe Checkout and Connect onboarding are reached by navigation, so they need no allowance.
  - Scripts still allow `'unsafe-inline'` for Next's bootstrap until pages take a per-request nonce.
  - Every browser test fails if the CSP blocks anything.
- **Bounds.**
  - Bodies are strict schemas with string, array and number limits.
  - Ticket and member prices stop at 99,999,999 cents (Stripe's largest charge) and ticket stock at 1,000,000. Membership and merchandise prices have the same cap, merchandise stock stops at 100,000, and commerce totals are checked in `BigInt`.
  - So no total leaves a 32-bit integer.
- **Rate limits.** The policies are in `lib/security/rate-limit.ts`. Account, token, invite, upload, MFA and guest policies fail closed (503 when Redis is unavailable); checkout, resend and check-in fail open so a Redis outage doesn't stop sales or the door. Client IPs come only from the single edge-owned header; proxy chains are refused.
- **Tokens.** Sign-in, reset, verification and email-change tokens, guest access grants and staff MFA grants are stored as digests and expire. Rows more than 30 days past expiry are deleted 500 at a time by the notification worker each minute (`lib/security/token-cleanup.ts`); rows that point at them are set to null.

## Families

| Family | Routes | Authority | Rate policy | Notes |
| --- | --- | --- | --- | --- |
| Sign-up and recovery | `auth/signup`, `auth/password/request`, `auth/verification/request` | Public | `signup_ip`, `signup_email` (closed) | The same answer whether or not the address has an account. |
| Token redemption | `auth/password/confirm`, `auth/verification/confirm` | The token | `account_token_ip`, `account_token_digest` (closed) | Single use; a used, expired or replaced token is refused. |
| Sign-in | `auth/[...nextauth]` | Auth.js | `login_ip_email`, `login_ip_global` (closed) | Auth.js CSRF and responses. |
| Account | `me/account`, `me/profile`, `me/notification-preferences`, `me/context` | Signed in, live session version | `account_security_change` (closed) for password, email change and closure | Changing password or email signs other devices out. |
| Staff MFA | `me/mfa/setup`, `confirm`, `verify`, `status` | Signed in | `staff_mfa_setup`, `staff_mfa_verify` (closed) | Grants are bound to the session. |
| Events | `events`, `events/[eventId]` (+`publish`, `sales`, `ticket-types`) | `events:manage` (reads `events:read`) | — | Version compare-and-swap; inventory lock on edits. |
| Attendance | `events/[eventId]/tickets`, `tickets/[ticketId]/check-in`, `check-out` | `tickets:check_in` | `ticket_check_in_out` (open) | One state change wins when two volunteers act. |
| Calendar | `orgs/[orgSlug]/calendar` | `events:read`; drafts need `events:manage`, membership endings `members:read` | — | Range of at most 93 days. |
| Ticket orders | `orders`, `orders/[orderId]` (+`refunds`, `cancel`, `review`, `refund-manual`, `resend`, `email-jobs/…/requeue`, `compensation-refund/confirm`) | `orders:read`, `orders:refund`, `orders:refund_mark`, `orders:email_resend` | `order_resend` (open); `staff_mfa_verify` for refunds and cancellations | Refunds are webhook-confirmed. |
| Commerce orders | `commerce/orders/[orderId]`, memberships and merchandise order actions | Buyer or guest session; staff `orders:read`, `memberships:manage`, `merchandise:fulfil` | `staff_mfa_verify` for refunds, revocations and cancellations | |
| Membership plans | `orgs/[orgSlug]/memberships` (+`[planId]`, `publish`, `archive`) | `memberships:manage` | — | |
| Merchandise | `orgs/[orgSlug]/merchandise` (+`[productId]`, `publish`, `archive`, `restore`, `pickups`, `orders/…`) | `merchandise:manage`, `merchandise:fulfil` | — | Stock can't go below checkout holds. |
| Society | `orgs` (create), `orgs/[orgSlug]`, `profile`, `assets`, `assets/[assetId]` | Verified organisation account to create; `organisation:settings` and the asset's permission after | `organisation_create`, `organisation_profile`, `asset_upload`, `asset_delete` (closed) | Images are re-encoded and size-checked. |
| Joining | `orgs/[orgSlug]/join`, `leave` | Verified member account | `organisation_join_leave` | A free join only; no staff authority. |
| Staff | `orgs/[orgSlug]/staff`, `staff/[staffId]`, `staff/handover`, `staff/invites` (+`resend`, `revoke`), `staff/invites/accept` | `staff:manage`; owner changes need an owner; the invitee's verified account and token to accept | `staff_invite_actor`, `staff_invite_email`, `account_security_change`, `account_token_*` (closed) | At least one active owner always remains. |
| Email delivery | `notifications`, `notifications/[jobId]/requeue` | `orders:email_resend` | `order_resend` (open) | |
| Stripe Connect | `stripe/connect/onboard`, `continue`, `dashboard`, `disconnect`, `status` | `stripe:manage` | `stripe_connect_mutation`; `staff_mfa_verify` to disconnect | No provider messages reach the browser. |
| Checkout | `payments/checkout/event`, `membership`, `merchandise`, `payments/checkout/attempts/[attemptId]` | Verified member, or a guest session with its CSRF token | `checkout_create` (open) | Idempotency key; prices re-read under lock. |
| Guest access | `guest/email/request`, `guest/email/confirm`, `guest/recover`, `guest/session`, `guest/orders/[orderId]/claim` | Public with rate limits; the guest session; a signed-in member to claim | `guest_email_ip`, `guest_email_address`, `guest_token_ip`, `guest_token_digest` (closed) | The same answer for any address. |
| Purchases | `purchases/tickets/[orderId]/status` | The buyer or the guest session that may open it | — | Everyone else gets the same 404. |
| Public reads | `public/events`, `public/events/[eventId]`, `public/organisations/search`, `orgs/search`, `public/assets/[assetId]`, `merchandise/quote` | Public (members-only events and their images only to members) | — | No app rate limit: abusive read volume is for the hosting edge (T42). |
| Webhooks | `payments/webhook`, `stripe/connect/webhook` | Stripe signature | — | Idempotent by event id; Stripe's own response contract. |
| Health | `health`, `health/ready`, `security/csrf` | Public; CSRF issues a token to the session | — | No data. |

## Residual items

- Script CSP keeps `'unsafe-inline'`. A per-request nonce would make every page dynamic; revisit with T43's hosting work.
- Public reads have no app-level rate limit; the hosting edge owns that (T42).
