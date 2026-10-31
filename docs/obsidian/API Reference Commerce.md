---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[API Reference]]", "[[API Reference Societies]]", "[[Payment Lifecycle]]", "[[Stripe Payments and Connect]]", "[[Memberships and Merchandise]]", "[[Email Delivery Implementation]]"]
sources: [app/api/payments, app/api/purchases, app/api/commerce, app/api/orders, app/api/notifications, app/api/stripe/connect, lib/commerce/http.ts, lib/purchases/pending-checkout-http.ts, lib/memberships/http.ts, lib/merchandise/http.ts, lib/stripe/http.ts, lib/validators/payments.ts, lib/validators/stripe-connect.ts]
---

# API Reference Commerce

**Owns:** the request and response contract of checkout, buyer purchase reads and cancels, staff ticket-order actions, membership and merchandise order actions, notifications, Stripe Connect and the Stripe webhooks. Shared conventions are in [[API Reference#Conventions]].
**Read when:** calling or changing one of these routes.
**Not here:** order, hold, refund, dispute and compensation states ([[Payment Lifecycle]]); Stripe parameters, Connect states and webhook processing ([[Stripe Payments and Connect]]); guard order and rate numbers ([[Route Security Inventory]]); email delivery ([[Email Delivery Implementation]]).

## Code

| Concern | Where |
| --- | --- |
| Ticket checkout | `lib/payments/checkout-creation.ts`: `createEventCheckout`, `CheckoutCreationError` |
| Commerce checkout route | `lib/commerce/http.ts`: `commerceCheckoutRoute`; service `lib/commerce/checkout.ts` |
| Buyer cancel route | `lib/purchases/pending-checkout-http.ts`: `cancelPendingCheckoutRoute`; service `lib/purchases/pending-checkout.ts` |
| Staff end routes (code-checked) | `lib/memberships/http.ts`: `staffEndRoute` |
| Connect errors | `lib/stripe/http.ts`: `connectRouteRules` |
| Refund service | `lib/payments/order-refunds.ts`: `requestOrderRefund`, `requestCommerceRefund`, `OrderRefundError` |

## Checkout

Buyer authority: a verified `member` account, or, with a guest cookie and no live login, a guest `checkout` session plus `x-thunderstrux-guest-csrf` (tickets and merchandise only). Bucket `checkout_create`, keyed on the buyer and the event or family. Answers: 200 `{kind: "stripe", url}` (go to Stripe), 200 `{kind: "fulfilled", …}` (a free total, or a replay of a finished checkout), or 202 `{attemptId, status: "processing"}` when Stripe's answer isn't known yet (the order and hold are kept; poll the attempt).

| Route | Body | Success id | Refusals |
| --- | --- | --- | --- |
| `POST /api/payments/checkout/event` | `lib/validators/payments.ts:createEventCheckoutSchema`: `eventId`, `ticketTypeId`, `quantity` 1 to 10 (`maxTicketsPerOrder`), `expectedUnitPrice` (cents shown), optional `code` (up to 30, case-blind), `idempotencyKey` (16 to 128 of letters, digits, `-`, `_`) | `orderId` | 401 no session or ended guest session; 403 unverified, bad guest CSRF; 400 organisation account (`path: ["accountRole"]`); 404 `event_not_found`, `ticket_type_not_found`; 400 `event_draft`, `sales_closed`, `sold_out`, `stripe_not_ready`, `insufficient_availability` (`path: ["quantity"]`, `value` = still sellable), `member_price_limit` (more than one ticket at the member price; `path: ["quantity"]`, `value` 1), `price_below_minimum` (a price saved under $2.00, no code used); 409 `quote_changed` (`value` = new unit price), `idempotency_conflict`, `purchase_in_progress` (one buyer's unpaid holds on an event stay within 10, SEC-005; the detail `id` is the buyer's own open order when there is one), `free_limit_reached` (one buyer's free tickets on an event stay within 10, SEC-030; `value` = how many more), `code_unavailable` (off, ended, used up or under the paid minimum; `value` = tickets left on it, [[Event Lifecycle#Codes]]); 503 "Payments are unavailable right now. Try again later." |
| `POST /api/payments/checkout/membership` | strict `{organisationId, selection: {planId}, expectedTotal, idempotencyKey}` | `commerceOrderId` | 401 also for a guest (no guest path); 403 unverified; 400 non-member, `stripe_not_ready`, bad `selection` (details under `selection`); 404 `not_available`; 409 `quote_changed`, `idempotency_conflict`, `unavailable`, and `reason` `plan_unavailable`, `term_overlap`, `purchase_in_progress` (detail `id` = the open order); 503 "Stripe is not configured." |
| `POST /api/payments/checkout/merchandise` | same envelope; `selection: {items: [{variantId, quantity 1-10}] (1 to 10 options of one society, each once), quoteVersion}` from `POST /api/merchandise/quote` | `commerceOrderId` | as membership, plus guest 401/403; 409 `reason` `unavailable`, `sold_out`, `not_enough` (`value` = left, path `["selection", "items", variantId]`), `quote_changed` (stale basket), `purchase_in_progress` (another unpaid basket in the society; detail `id` = that order), `free_limit_reached` (one buyer's free units of an option stay within 10; `value` = how many more) |
| `GET /api/payments/checkout/attempts/[attemptId]` | — | `{attemptId, status}`: `ready` (+`url`), `processing`, `completed` (+`orderId`, the ticket or commerce order), `failed` | 404 for another actor's or a missing attempt. `no-store`; no rate limit |

Effects:

- Every rule is checked again under the buyer, event and ticket-type locks: publication, sale state and close time, readiness, sellable stock, and the member price (a member whose running membership carries member prices pays `memberPrice`, one ticket per event; later tickets pay `price`).
- A paid ticket creates a pending `Order`, a `TicketReservation` and a Stripe Checkout Session lasting the event's hold or 30 minutes, the longer, plus 60 s; the seats are held for the event's hold (5 to 59 minutes, default 20) plus a 5-minute grace, and the stale-order job closes the page when the hold ends ([[Payment Lifecycle#Holds]]). Returns: success `/success?session_id={CHECKOUT_SESSION_ID}` (a guest gets `/guest/orders/[orderId]`), cancel `/cancel?order=[orderId]`, on the trusted request origin.
- A free ticket reads no Stripe settings and holds nothing: one transaction makes a paid `free` order, its tickets, the stock decrement, lifecycle `order_created` and `free_fulfilled`, and the ticket email; if the email can't be queued nothing is created.
- Commerce returns to `/memberships/orders/[orderId]` or `/merchandise/orders/[orderId]` (cancel adds `?left=1`).
- Only the signed webhook fulfils a paid order; no return page marks anything paid.

## Buyer reads and cancels

| Route | Auth | Answer | Errors and effects |
| --- | --- | --- | --- |
| `GET /api/purchases/tickets/[orderId]/status` | the member who bought it, or a guest session allowed to open it | `{status}`: `processing`, `paid`, `free`, `review`, `refund-processing`, `refunded`, `disputed`, `cancelled`, `failed`, `expired` (`lib/purchases/projection.ts`) | 404 for everyone else, including anonymous callers with a real id. Read-only. `no-store` |
| `GET /api/commerce/orders/[orderId]` | buyer (member, or a guest session that bought it or holds its purchase link); else staff of the selected society with `orders:read` | `{view: "buyer", order}` (status, payment kind, currency, total, seller and support email, society slug and pickup details, lines, history types and times; no buyer contact, fee or provider ids) or `{view: "finance", order}` (adds buyer snapshot, fee and policy, guest flag, Stripe references, review reason, paid and failed facts, history with actors) | 404 for a ticket order id, another buyer's or another society's order. A staff caller whose MFA grant expired gets 403 (`organisationAccessRule`). `no-store` |
| `POST /api/purchases/tickets/[orderId]/cancel`, `POST /api/commerce/orders/[orderId]/cancel` | the buyer or the guest session (with guest CSRF); `checkout_create` | 200 `{status: "cancelled"}`, or `{status: "paid"}` when Stripe was paid meanwhile (nothing changes) | 404 not the buyer; 403 bad guest CSRF; 409 `reason` `not_pending` (nothing to cancel) or `no_session` (Stripe hasn't opened the payment). Expires the Stripe Session first, then releases the hold through the same expiry path as `checkout.session.expired` (lifecycle source `checkout`); commerce records `buyer_cancelled`. No audit row |
| `POST /api/purchases/tickets/[orderId]/cancel-registration` | the buyer or the guest session (with guest CSRF); `checkout_create` | 200 `{status: "cancelled"}` or `{status: "already_cancelled"}` | 404 not the buyer; 403 bad guest CSRF; 409 `reason` `not_cancellable` (not a confirmed free registration) or `event_started`. The buyer releases a free registration (EVT-005): tickets void, places back to the ticket type under the event lock, lifecycle source `buyer_action`, audit `order.free_cancelled` (`by: "buyer"`), the buyer's `cancellation/{orderId}` notice ([[Event Lifecycle#Free cancellation]]) |

## Ticket orders (staff)

All use the selected dashboard context, its permission and staff MFA; another society's order is 404. Tenant comes from `Order.event.organisationId`.

| Route | Permission, bucket | Body / query | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `GET /api/orders/export` | `orders:read`; `data_export` | `family` (`tickets`, `memberships`, `merchandise`) and that Orders tab's filters | CSV (`text/csv`, `attachment`, `private, no-store`, UTF-8 byte-order mark) of every matching order, cells a spreadsheet would run as a formula prefixed with `'`; audit `order.list_exported` | 403 without `orders:read`; 404 another society's `eventId`; 413 over 10,000 rows |
| `GET /api/orders` | `orders:read` | `status` (`all`, `paid`, `expired`, `failed`; `pending` only with `includeSystem=true`; anything else reads as `all`), `eventId`, `search` (buyer email, case-insensitive), `startDate`, `endDate`, paging | `{groups: [{eventId, eventTitle, orders}], pageInfo}`; groups are page-local; each order has `status`, `projection`, ticket type, quantity, total, times, failure and review fields, `isManuallyRefunded`, `buyerEmail` | 400 bad date or paging, 404 foreign `eventId`. A date-only `startDate` or `endDate` is a whole day in the society's zone (`dateFilterBound`, `lib/zoned-time.ts`); any other value is read as an instant. Read-only |
| `GET /api/orders/[orderId]` | `orders:read` | — | `{order}`: status and times, compensation-review fields, buyer, event, purchased ticket type name, quantity, unit price and total (from the order snapshot; pre-T10 orders show today's name plus "(historical label unavailable)"), `paymentKind`, `projection`, ticket ids, Stripe session id, manual refund and email tracking | the lifecycle timeline is page-only |
| `POST /api/orders/[orderId]/refunds` | `orders:refund`; `staff_mfa_verify` when a code is sent | strict `{reason (8-500), confirmation (the short reference), mfaCode?}`, plus together (DEBT-002) `ticketIds` (1 to 10 valid tickets), `amount` (cents, 0 up to their value and what is left), `cancelTickets`, `notifyBuyer` and optional `buyerMessage` (up to 500); 0 needs `cancelTickets` | 200 `{refundRequestId, status: "succeeded"}`, or 202 with `pending` or `uncertain`; 200 `{status: "cancelled"}` for $0 (no refund, no Stripe; audit `order.tickets_cancelled`) | 400 `confirmation` (`confirmation_mismatch`), `ticketIds` (`invalid_selection`) or `mfaCode`; 409 `reason` `not_refundable`, `in_progress`, `already_refunded`, `disputed`, `verification_failed`, `provider_refused`; 503 Stripe or MFA config. Without tickets it refunds everything left; with them the amount chosen, with `reverse_transfer` and `refund_application_fee`; the request's tickets void when Stripe confirms, unless kept valid. Audit `order.refund_requested` |
| `POST /api/orders/[orderId]/cancel` | `orders:refund`; code | strict `{reason (8-500), mfaCode?}` | `{status: "cancelled" \| "already_cancelled", cancelledAt}` | 409 `not_cancellable` (paid, pending or unfulfilled). Free registrations only; moves no money, restores no stock. Audit `order.free_cancelled` |
| `POST /api/orders/[orderId]/review` | `orders:refund` | strict `{action: "restore_tickets", reason (8-500)}` or `{action: "mark_reviewed", ticketIds?}` (the valid tickets the outside refund covered, voided and back on sale; DEBT-002) | `{ok: true}` | 409 `not_allowed` (no won dispute, no partial outside refund, or a ticket not valid on this order). Restore needs every dispute on the order won; mark-reviewed repeats as a no-op and also accepts a membership or merchandise order id (PAY-003). Moves no money |
| `PATCH /api/orders/[orderId]/refund-manual` | `orders:refund_mark` + fresh MFA code unless `off` | strict `{reason (8-500), mfaCode?}`; `staff_mfa_verify` when a code is sent | `{order}` | 400 `mfaCode` missing or wrong; 409 a checkout that didn't complete, free registration, compensation in progress, a Thunderstrux refund, a dispute. Records a refund made outside Thunderstrux: sets `isManuallyRefunded`, voids the tickets (`refunded_outside`), first time lifecycle `manual_refund_marked`; no Stripe call, no status change, and payouts still hold the sale until its event is over. Audit `order.manual_refund_marked` |
| `POST /api/orders/[orderId]/resend` | `orders:email_resend`; `order_resend` | none | `{queued: true}` | 400 unpaid, disputed, cancelled or refunded (`refundStatus` set). Queues a manual ticket email even if one was sent; lifecycle `email_enqueued`; audit `order.ticket_email_queued` |
| `POST /api/orders/[orderId]/email-jobs/[jobId]/requeue` | `orders:email_resend`; `order_resend` | strict `{reason (8-500)}` | `{queued: true}` | 404 order or job; 400 on `reason` (missing, short, too long or an oversized body); 409 job not a terminal failed unaccepted one, order ineligible, changed meanwhile. Audit `email_outbox.requeued` |
| `POST /api/orders/[orderId]/compensation-refund/confirm` | `orders:refund` +fresh code unless MFA is `off`; `staff_mfa_verify` when a code is sent | strict `{refundId: "re_…", mfaCode?}` | `{confirmed: true}` | 400 `mfaCode`; 403 MFA; 404; 409 when the Stripe refund doesn't match the order's job, amount, currency, PaymentIntent and charge, didn't reverse the transfer and refund the fee, or needs review. Never a bare local marker. Audit `order.compensation_refund_confirmed` |

## Membership and merchandise orders (staff)

Slug routes (`organisationActor`): unknown slug or no role 404, this society's staff without the permission 403, `private, no-store`. The code-checked routes share `staffEndRoute`: strict `{reason (8-500), confirmation?, mfaCode?}`, `staff_mfa_verify` when a code is sent, and a code required unless MFA mode is `off`.

| Route | Permission | Success | Errors and effects |
| --- | --- | --- | --- |
| `POST /api/orgs/[orgSlug]/memberships/members/[grantId]/revoke` | `memberships:manage` | `{status: "revoked" \| "already_revoked", revokedAt}` | 404; 409 `not_revocable` (already ended). Ends it now, no refund. Audit `membership.revoked` |
| `POST /api/orgs/[orgSlug]/memberships/members/[grantId]/cancel` | `orders:refund` | `{status: "cancelled" \| "already_cancelled", cancelledAt}` | 409 `not_cancellable` (not a free membership). Audit `membership.free_cancelled` |
| `POST /api/orgs/[orgSlug]/memberships/members/[grantId]/refund` | `orders:refund`; a fresh `mfaCode` unless MFA is off; no bucket of its own (`staff_mfa_verify` when a code is sent) | 200 `{refundRequestId, status: "succeeded"}` or 202 `pending`/`uncertain` | needs `confirmation`; 400 `confirmation`; 409 `not_refundable`, `in_progress`, `already_refunded`, `disputed`, `verification_failed`, `provider_refused`; 503 "Stripe is not configured." The membership ends when the refund is confirmed. Audit `commerce_order.refund_requested` |
| `POST /api/orgs/[orgSlug]/merchandise/orders/[orderId]/refund` | `orders:refund` | as membership refund | same reasons; the 409 detail path is `["orderId"]`; 404 not a merchandise order of the society |
| `POST /api/orgs/[orgSlug]/merchandise/orders/[orderId]/cancel` | `orders:refund` | `{status: "cancelled" \| "already_cancelled", cancelledAt}` | 409 paid (refund it) or collected (record a return). No refund row; stock not restocked. Audit `merchandise_order.free_cancelled` |
| `POST /api/orgs/[orgSlug]/merchandise/orders/[orderId]/returns` | `merchandise:fulfil` (no code) | 201 `{return}` | strict `lib/merchandise/after-sale.ts:returnSchema` (`lineId`, `quantity` 1-10, `restock`, `reason` 3-500, `operationKey`); the same key answers the first return; 409 more than can be returned, not a completed order, key used on another order. Audit `merchandise_order.return_recorded` |
| `POST /api/orgs/[orgSlug]/merchandise/pickups` | `merchandise:fulfil` (no code) | `{pickups: {marked: [pickup], skipped: [{orderId, reference, message}]}}` | strict `pickupBatchSchema` (`orders`: 1 to 25 `{orderId, expectedVersion}`); each marked ready through `markPickup` in its own transaction, so one 409 skips that order and the rest go |
| `POST /api/orgs/[orgSlug]/merchandise/pickups/[orderId]` | `merchandise:fulfil` (no code) | `{pickup: {id, reference, pickupStatus, version, at, by}}` | strict `lib/merchandise/pickups.ts:pickupStepSchema` (`step` `ready`/`collected`, `expectedVersion`); 409 under review, disputed, refunded, cancelled or unpaid, a step out of order, or a stale version (names who took the step and when); nothing changes on a refusal. Audit `merchandise_order.ready` / `merchandise_order.collected` |

## Notifications

| Route | Permission, bucket | Answer | Errors and effects |
| --- | --- | --- | --- |
| `GET /api/notifications?cursor=` | ctx, `orders:email_resend` +MFA | `{jobs, nextCursor}`: 25 failed business notifications of the society; no security jobs, recipients or encrypted payloads. `no-store` | 400 bad cursor |
| `POST /api/notifications/requeue` | same; `order_resend` (society, `batch`) | `{queued: [jobId], skipped: [{id, message}]}` | strict `{jobIds (1-25), reason (8-500)}`, else 400; each job through `requeueBusinessNotification` with its own audit row; a foreign, missing or ineligible job is skipped |
| `POST /api/notifications/[jobId]/requeue` | same; `order_resend` | `{queued: true}` | strict `{reason (8-500)}`, else 400 on `reason`; 404 foreign or security job; 409 ineligible or changed. The audit commits with the queue update: `notification.requeued` |

## Stripe Connect

All need live `stripe:manage` +MFA, first anywhere (`requireStripeConnectCapability`, 403 "Insufficient permissions"), then on the target society (an unreachable or unknown society is 404 "Organisation was not found"; this society's staff without the permission 403). Errors map through `connectRouteRules`: provider text never reaches the client, an unexpected failure is a generic 500, and a missing Stripe key is 503 "Stripe is not configured." (it names no server setting). A disconnect Stripe couldn't answer is 503 too (`StripeDisconnectUnavailableError`). Bucket `stripe_connect_mutation` for the writes.

| Route | Body / query | Success | Errors and effects |
| --- | --- | --- | --- |
| `POST /api/stripe/connect/onboard` | `lib/validators/stripe-connect.ts:stripeDisconnectSchema` `{organisationId, mfaCode?}` (code needed unless `off`); `staff_mfa_verify` when a code is sent | `{url}` (Stripe onboarding) | 400 `mfaCode` missing or wrong, 403 not enrolled; creates the Express account if the society has none (audit `stripe_connect.account_created`; the idempotency key counts earlier such rows); 409 `{state: "PLATFORM_NOT_READY", message, actionRequired, actionUrl}` when Stripe's platform profile is incomplete. Return and refresh URLs use the trusted request origin |
| `POST /api/stripe/connect/continue` | `{organisationId, mfaCode?}` (code needed unless `off`) | `{url}` | 400 `mfaCode` missing or wrong, 403 not enrolled; 400 `path: ["organisationId"]` with no connected account. No audit |
| `POST /api/stripe/connect/dashboard` | `stripeDisconnectSchema` `{organisationId, mfaCode?}`; `staff_mfa_verify` when a code is sent | `{url}`: a single-use Express Dashboard sign-in link (one per click) | 400 `mfaCode` missing or wrong (Stripe not called), 403 not enrolled, 400 `path: ["organisationId"]` setup not finished. Audit `stripe_connect.dashboard_opened` |
| `POST /api/stripe/connect/disconnect` | `{organisationId, mfaCode?}` (code needed unless `off`) | `{disconnected: true, status: {state: "NOT_CONNECTED", connected: false, ready: false, …}}` | 400 `mfaCode`, 403 not enrolled; 409 while orders still depend on the account (count in the message): ticket or commerce orders pending, in compensation review or with an open compensation job, refund processing, dispute open, or an open refund request; also 409 while sale money is still held for refunds (`heldMoneyBlocksDisconnect`). Clears the society's Stripe fields (also `PLATFORM_NOT_READY`); the Stripe account itself is untouched. Audit `stripe_connect.disconnected` |
| `GET /api/stripe/connect/status?organisationId=` | — | status: `state` (`NOT_CONNECTED`, `PLATFORM_NOT_READY`, `CONNECTED_INCOMPLETE`, `RESTRICTED`, `READY`, `ERROR`), flags, requirements, `dashboard_available`; connected also `openObligations` and `payouts` | retrieves the account and persists `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, `stripeAccountStatus`; on a Stripe failure `ERROR` keeps the last flags with `error` |

State meanings, payouts and disconnect safety: [[Stripe Payments and Connect]].

## Webhooks

All three read the raw body (`readWebhookBody`, 413 over 1 MB), verify `stripe-signature`, use Stripe's response contract and have no origin check or rate limit. Processing: [[Stripe Payments and Connect#Webhooks]].

| Route | Answers | Events |
| --- | --- | --- |
| `POST /api/payments/webhook` | 413 over 1 MB; 400 missing or bad signature (alert `stripe_webhook_signature_failure`); 503 webhook not configured; 200 `{received: true, ignored: "mode_mismatch"}` when the event's livemode differs from the key (alert `stripe_webhook_mode_mismatch`); 200 `{received: true}`; 200 `Ignored` for other types; an exception is a 500, so Stripe retries | `checkout.session.completed` and `checkout.session.expired` (a Session with `metadata.family` goes to commerce; a commerce order's Session without one is ignored with alert `commerce_webhook_identity_mismatch`); `refund.created`, `refund.updated`, `refund.failed` (by metadata: `refundRequestId` → staff refund, `compensationRefundJobId` → compensation, neither → an outside refund, commerce first); `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` (commerce first, then ticket) |
| `POST /api/stripe/accounts/webhook` | same signature, config and mode answers; else 200 `{received: true}` | Accounts v2 thin events (PAY-023): account closed, identity, requirements and configuration changes re-read and persist flags; a failed read is a 500 so Stripe retries, except an out-of-reach 403, recorded and answered 200; an unknown account is logged and ignored |
| `POST /api/stripe/connect/webhook` | same signature, config and mode answers; else 200 `{received: true}` | `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.updated` (`lib/payouts/payouts.ts`); `account.external_account.created`, `account.external_account.updated` (emails the society's Stripe managers, `lib/stripe/connect.ts`) |

## Traps

- A new checkout refusal needs a `reason` in its detail; clients branch on `reason` and `value`, never on `message`.
- Never mark an order paid from a return page or the attempt read; only the signed webhook (or the recovery worker reading Stripe) fulfils.
- A staff action that ends or undoes a purchase belongs in `staffEndRoute` or must copy its code check; the `staff_mfa_verify` bucket only applies when a code is sent.

## Related

[[API Reference]] · [[API Reference Societies]] · [[Payment Lifecycle]] · [[Stripe Payments and Connect]] · [[Memberships and Merchandise]] · [[Route Security Inventory]] · [[Audit Coverage]]
