---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Stripe Payments and Connect]]", "[[Memberships and Merchandise]]", "[[Audit Coverage]]"]
sources: [lib/payments/order-refunds.ts, lib/payments/compensation-refunds.ts, lib/payments/purchase-disputes.ts, lib/payments/dispute-reversals.ts, lib/payments/free-cancellation.ts, lib/commerce/payment-recovery.ts, lib/orders/order-detail.ts]
---

# Payment Lifecycle Refunds and Disputes

**Owns:** money going back after a sale, for tickets and for memberships and merchandise: whole-order refunds and "refund the rest", compensation refunds of payments that couldn't be honoured, the "refunded outside Thunderstrux" mark, refunds made in Stripe's dashboard, disputes, lost-dispute transfer reversals, and free cancellation.
**Read when:** changing a refund, dispute or cancellation path, the refunds worker, or what any of them does to orders and tickets.
**Not here:** order, ticket and hold states, fulfilment and compensation entry ([[Payment Lifecycle]]); webhook routing, payouts and the Stripe calls' parameters ([[Stripe Payments and Connect]]); membership revocation and merchandise returns ([[Memberships and Merchandise]]); refund and cancellation emails ([[Email Delivery Implementation]]).

## Code

| Concern | Where |
| --- | --- |
| Whole-order refunds, worker, webhook | `lib/payments/order-refunds.ts`: `requestOrderRefund`, `requestCommerceRefund`, `processOrderRefundBatch`, `reconcileOrderRefundEvent` |
| Ticket compensation refunds | `lib/payments/compensation-refunds.ts`: `processCompensationRefundBatch`, `reconcileRefundEvent`, `confirmCompensationRefund` |
| Ticket disputes and outside refunds | `lib/payments/purchase-disputes.ts`: `reconcileDisputeEvent`, `reconcileExternalRefundEvent`, `restoreDisputedTickets`, `markExternalRefundReviewed` |
| Commerce disputes, outside refunds, automatic compensation | `lib/commerce/payment-recovery.ts` |
| Lost-dispute reversals | `lib/payments/dispute-reversals.ts`: `queueDisputeReversal`, `processDisputeReversalBatch` |
| Free ticket cancellation | `lib/payments/free-cancellation.ts`: `cancelFreePurchase` |
| Manual refund mark, resend refusals | `lib/orders/order-detail.ts`: `markOrganisationOrderManuallyRefunded` |
| Worker | `scripts/process-compensation-refunds.ts` (`pnpm compensation-refunds:process`) |
| Tests | `tests/integration/order-refunds.test.ts`, `tests/integration/compensation-refunds.test.ts`, `tests/integration/purchase-disputes.test.ts`, `tests/integration/commerce-payment-recovery.test.ts`, `tests/integration/membership-refunds.test.ts`, `tests/integration/merchandise-after-sale.test.ts`, `tests/integration/free-cancellation.test.ts`, `tests/e2e/order-refunds.spec.ts` |

## Staff routes

All take the order from the dashboard's selected society and lock it scoped to that society; another society's order is 404.

| Route | Permission | Body | Answers |
| --- | --- | --- | --- |
| `POST /api/orders/[orderId]/refunds` | `orders:refund` + fresh MFA code unless MFA is `off` | `reason` (8 to 500), `confirmation` (the order's short reference), `mfaCode` | 200 when Stripe confirmed, 202 pending or uncertain; 400 `confirmation_mismatch`; 409 `not_refundable`, `in_progress`, `already_refunded`, `disputed`, `verification_failed`, `provider_refused` |
| `POST /api/orders/[orderId]/cancel` | `orders:refund` + fresh MFA code | `reason`, `mfaCode` | `{ status: "cancelled" }` or `already_cancelled`; 409 `not_cancellable` |
| `POST /api/orders/[orderId]/review` | `orders:refund` | `{ action: "restore_tickets", reason }` or `{ action: "mark_reviewed" }` | 409 `not_allowed` |
| `POST /api/orders/[orderId]/compensation-refund/confirm` | `orders:refund` | `refundId` (`re_...`) | 404; 409 when Stripe's refund doesn't verify or the job isn't confirmable |
| `PATCH /api/orders/[orderId]/refund-manual` | `orders:refund_mark` | none | 409 refusals below |

Membership and merchandise refunds go through `POST /api/orgs/[orgSlug]/memberships/members/[grantId]/refund` and `POST /api/orgs/[orgSlug]/merchandise/orders/[orderId]/refund`, which call `requestCommerceRefund` with the same body and 200 or 202. When a code is sent, `staff_mfa_verify` limits guesses. Audit rows: [[Audit Coverage]].

## Order refunds

A `RefundRequest` refunds one ticket order or one commerce order (database check: exactly one of `orderId`, `commerceOrderId`).

**`RefundRequestStatus`:** `pending` → `succeeded` or `failed`; `pending` → `uncertain` (no answer) → `succeeded`, `failed` or still `uncertain`.

**`refundStatus`** (`OrderRefundStatus`, on `Order` and `CommerceOrder`) is the financial fence: `processing` while a request is in flight, `refunded` once one succeeds. Compensation never starts on a fenced order, and an ordinary refund never starts on an order in compensation.

1. **Request** (under the purchase lock; commerce locks the family's resources first). The typed reference must match, then:
   - refused when already `refunded` or `processing`, or `disputeStatus` is set;
   - the order must be a Stripe, `paid`, fulfilled order with a Session and a seller snapshot, not under compensation review. Tickets also need no `isManuallyRefunded` mark and a compensation job that is absent or `recovered`.
   
   The amount is `totalAmount − externalRefundedAmount`, so after a partial refund made in Stripe this is **refund the rest**. It records the request (`operationKey` `order-refund:<uuid>` or `commerce-refund:<uuid>`, `destinationAccountId` from the snapshot), sets `refundStatus = processing`, appends `refund_requested` and writes the audit row.
2. **Verify, outside the transaction:** re-read the Session with its PaymentIntent and charge. It must be paid, match total, currency and the order id in metadata, have `amount_received` equal to the total, transfer to the snapshot account, and not be disputed. Stripe's other refunds on the payment must total exactly what this request leaves out, else `existing_refund_requires_review`. The PaymentIntent is recorded on the request and the order before anything is sent.
3. **Send:** `refunds.create` with `reverse_transfer`, `refund_application_fee`, metadata `refundRequestId` plus `orderId` or `commerceOrderId`, and `operationKey` as the idempotency key. A refund this request already made is reused, never sent twice.
4. **Outcome** (`applyOutcome`, under the purchase lock; an older Stripe event never overrides a newer one):
   - `succeeded` on tickets: `refundStatus = refunded`, every ticket `void` (`refunded`, check-ins kept, stock not restored), `refunded`, and the buyer's `refund/{requestId}` notice.
   - `succeeded` on commerce: `refundStatus = refunded`, review cleared, every membership it bought revoked (`Refunded: {reason}`, by the requester), an uncollected pickup cancelled, and the buyer's notice. Stock comes back only through a return.
   - `pending`: the fence stays; `refund_pending` once, polled every minute.
   - `failed`, `canceled`, a verification mismatch or a definite refusal: request `failed`, fence lifted, `refund_failed`. Tickets stay valid and memberships active.
5. **No answer:** the request becomes `uncertain`. The worker (`processOrderRefundBatch`) claims due `pending` and `uncertain` requests with a 10-minute lease and looks up the request's own refund at Stripe before sending the same key again. Once a PaymentIntent was recorded the refund may exist, so a failed lookup or refusal keeps it `uncertain` rather than failing it; Stripe's signed outcome settles it (SEC-011). After 6 attempts it keeps the fence, alerts `order_refund_unresolved` and asks Stripe hourly instead of every minute, so a late answer still settles it.
6. **Webhook** (`refund.*` with `refundRequestId`): the refund must name the request's purchase (and not the other kind), match amount, currency and the recorded PaymentIntent. It is journalled in `StripeRefundWebhookEvent` in the transaction that applies it, so a delivery that fails to apply is applied by Stripe's retry instead of being dropped as a duplicate.

The order keeps `status = paid`; lists show Refund processing or Refunded.

## Compensation refunds

A payment Stripe took that the order couldn't honour ([[Payment Lifecycle#Fulfilment]]).

**Tickets** use `CompensationRefundJob`, one per order, created from `compensationRefundModeSnapshot` (`CompensationRefundMode`). New events default to `automatic_full` (`lib/validators/events.ts`); the schema default and older events are `manual_review`.

| `CompensationRefundState` | Meaning | Next |
| --- | --- | --- |
| `review_required` | A person decides (manual mode, or automatic stopped for review) | `recovered`; `refunded` by staff confirmation |
| `auto_queued` | Waiting for the worker | `auto_processing` |
| `auto_processing` | Claimed by the worker (`processingToken`, 10-minute lease) | `refund_pending`, `refunded`, `refund_failed`, `review_required`, `auto_queued` (retry) |
| `refund_pending` | Stripe is processing the refund; polled every minute | `auto_processing`, `refunded`, `refund_failed`, `review_required` |
| `refunded` | Stripe confirmed; terminal | |
| `refund_failed` | Stripe failed it, or 5 tries errored; terminal for the worker | `refunded` by staff confirmation |
| `recovered` | A late webhook fulfilled the order after all; terminal | |

- **Claim** (SERIALIZABLE, order locked): `auto_queued`, `refund_pending`, or a stale `auto_processing`. The order must still be `failed`, under review, not manually refunded, without `refundStatus` or `disputeStatus`, `automatic_full`, ticketless, with a Session and a connected account. Otherwise → `review_required` (`local_state_not_eligible`). A claim appends `compensation_refund_started`.
- **Verify:** the Session, PaymentIntent and charge must match the job's amount, currency `aud` and the ticket metadata, transfer to the society's connected account, and not be disputed. Its own earlier refund (metadata `compensationRefundJobId`) is reused; any other refund on the payment → `review_required` (`existing_refund_requires_review`).
- **Send:** `refunds.create` with `reverse_transfer`, `refund_application_fee`, metadata `compensationRefundJobId` and `orderId`, key `compensation-refund:<orderId>`.
- **Outcome:** succeeded → `refunded`: review cleared, `isManuallyRefunded = true`, buyer notice `compensation-refund/{jobId}`, `compensation_refunded`. Failed or canceled → `refund_failed`. Pending → `refund_pending`, or `review_required` once 5 attempts are used (`provider_refund_pending_review`). Any other error → `auto_queued` after min(2^(n−1), 30) minutes, or `refund_failed` at 5 attempts.
- **Webhook** (`refund.*` with `compensationRefundJobId`): must match the job, its order, amount, currency and recorded PaymentIntent, is journalled once, and never moves a job out of `recovered`, `refunded` or `refund_failed` or back to an older event's state.
- **Staff confirmation** (`confirmCompensationRefund`): staff paste the Stripe refund id of a refund made in the dashboard. It must have succeeded for the job's amount on the order's payment, and the payment must still verify. Allowed from `review_required`, `refund_pending` or `refund_failed`; it ends `refunded` with the same effects and audit `order.compensation_refund_confirmed`.
- Tickets never come back, because none were issued.

**Commerce** has no compensation mode or job: compensation queues a system `RefundRequest` (no actor, key `commerce-compensation:<id>:<uuid>`) under the usual fence, through the order refund path above. A verification mismatch fails the request and leaves the order in review for staff. A full refund made in Stripe also settles it.

## Refunded outside Thunderstrux

**Manual mark** (`PATCH .../refund-manual`): sets `Order.isManuallyRefunded` once and appends `manual_refund_marked`; nothing changes at Stripe. Allowed on visible orders (`paid`, `failed`, `expired`). Refused for free orders, orders under compensation or with a compensation job (staff confirm the Stripe refund instead), orders with `refundStatus`, and disputed orders. A marked compensation order can't be recovered by a later webhook.

**Refunds made in the Stripe dashboard** (a `refund.*` event naming neither a request nor a job): commerce is asked first, by PaymentIntent (stored on the order, or Stripe's Session with `family` metadata).
- The event's PaymentIntent must resolve to an order whose Session names it, in the same currency, paid to the seller snapshot (orders without a snapshot skip that check). Anything else changes nothing and logs `stripe.refund.unmatched`.
- `externalRefundedAmount` becomes the total of the payment's **succeeded** refunds that Thunderstrux didn't make; pending ones count for nothing. Each change clears `externalRefundReviewedAt` and appends `external_refund_recorded`.
- Full amount on a `paid` ticket order: `refundStatus = refunded`, tickets `void` (`refunded_outside`). Commerce: also when the order is under review; memberships end and review clears.
- Partial: tickets stay valid and the order reads Payment review until staff `mark_reviewed` (`external_refund_reviewed`), or a refund here takes the rest.
- A later drop (a refund that failed after succeeding) is recorded, but voided tickets and ended memberships stay so.

## Disputes

`PurchaseDispute`, one per Stripe dispute, on a ticket order or a commerce order (never both). Each `charge.dispute.*` event is verified, journalled once, then projected from the dispute as re-read from Stripe:

- Verification: the dispute's PaymentIntent resolves to the order as above, and the dispute is on that payment's charge, in its currency and no larger than the order. Otherwise nothing changes; log `stripe.dispute.unmatched` and alert `purchase_dispute_unmatched`.
- Stripe's status maps to `OrderDisputeStatus`: `lost` → `lost`; `won`, `warning_closed` (an inquiry that never became a chargeback) and `prevented` → `won`; anything else `open`.
- **Worst of:** a charge can carry several disputes. The order's `disputeStatus` is the worst one: `lost`, then `open`, then `won` (SEC-024). One won dispute can't release another's fence or payout hold.

| | Ticket order | Commerce order |
| --- | --- | --- |
| Opens | `active` tickets → `refund_review` (`disputed`); `dispute_opened`; alert `purchase_dispute_opened` | `dispute_opened`; alert `purchase_dispute_opened` |
| While `open` | Refunds, ticket resends, the manual mark and compensation refunds are refused | Refunds and pickup hand-over are refused |
| Lost | Disputed tickets `void` (`dispute_lost`); status stays `lost`; reversal queued | Memberships end; nothing to hand over; reversal queued |
| Won | Tickets stay under review until staff with `orders:refund` restore them | `disputeStatus` clears at once; the dispute stays in history |

**Restore** (`restore_tickets`, reason 8 to 500): allowed only when `disputeStatus = won` and every unresolved dispute is won. It resolves them all together, puts `disputed` tickets back to `active`, clears `disputeStatus` and appends `dispute_resolved`. Later events for a resolved dispute are history only. A dispute is not a refund.

## Lost-dispute reversals

On destination charges Stripe takes a lost dispute's amount and fee from the platform. The society bears a lost sale, so the transfer that paid it is reversed by the disputed amount; Thunderstrux keeps its fee and pays Stripe's dispute fee (PAY-004). Nothing moves while a dispute is open or after it is won.

`DisputeReversalStatus` on `PurchaseDispute`:

| Status | Meaning |
| --- | --- |
| `pending` | Queued in the transaction that recorded the loss; later events for the same dispute queue nothing new |
| `uncertain` | Stripe's answer was unknown; retried after 1 to 30 minutes, doubling |
| `succeeded` | `stripeTransferReversalId` and `reversalAmount` stored; `dispute_funds_recovered` appended, audit `order.dispute_funds_recovered` or `commerce_order.dispute_funds_recovered` |
| `failed` | No transfer, destination or currency mismatch with the seller snapshot, nothing left to reverse, or a definite refusal; alert `dispute_reversal_unresolved`. A person settles it in Stripe's Dashboard |

`processDisputeReversalBatch` runs after the refund batches. It claims a row with a 10-minute lease, reads the charge's transfer, and looks for its own reversal (metadata `disputeId`) before creating one. It reverses min(dispute amount, transfer amount − already reversed), with metadata `disputeId` plus `orderId` or `commerceOrderId` and key `dispute-reversal:<disputeId>`. It doesn't touch the application fee. After 6 unknown outcomes it alerts `dispute_reversal_unresolved` and keeps looking the reversal up hourly; payouts hold the amount until it settles or the 80-day cap.

## Free cancellation

`cancelFreePurchase` (`POST /api/orders/[orderId]/cancel`) for a confirmed free ticket order (`paymentKind = free`, `paid`, fulfilled):
- Records `cancelledAt`, `cancelledByUserId` and `cancellationReason`; tickets `void` (`cancelled`, check-ins kept); `free_cancelled`; audit `order.free_cancelled`; the buyer's `cancellation/{orderId}` notice.
- It is never a refund: no `RefundRequest`, `status` stays `paid`, fulfilment stays, stock is not restored.
- A repeat answers `already_cancelled` and changes nothing. The database refuses a cancellation on a non-free order or without a reason.
- Read models show Cancelled first, resends are refused, and the guest order page says the registration was cancelled.

Free memberships and free merchandise orders cancel the same way through their own routes ([[Memberships and Merchandise]]).

## Traps

- Set the fence (`refundStatus = processing`) under the purchase lock before calling Stripe, and never call Stripe inside the transaction.
- Never send a refund key twice without first looking for its refund at Stripe; an uncertain request may already have moved money.
- An outside refund that is partial is never treated as full. Analytics don't see outside refunds at all ([[Analytics and Calendar]]).
- Refunds return the platform fee (`refund_application_fee`); Stripe keeps its processing fee (PAY-008).

## Failure and recovery

- **`order_refund_unresolved`:** the request is still uncertain after 6 tries and the fence stays; the worker keeps asking Stripe hourly. Check Stripe for a refund with that `refundRequestId`; there is no tool to settle it by hand.
- **`dispute_reversal_unresolved`:** reverse the transfer in Stripe's Dashboard, or decide not to.
- **Compensation `refund_failed` or `review_required`:** refund in Stripe's Dashboard, then confirm the refund id on the order page.
- **`purchase_dispute_unmatched`:** the dispute's payment didn't verify as any order's; investigate in Stripe.

## Related

[[Payment Lifecycle]] · [[Stripe Payments and Connect]] · [[Memberships and Merchandise]] · [[Email Delivery Implementation]] · [[Audit Coverage]] · [[Ticket Check-in Implementation]]
