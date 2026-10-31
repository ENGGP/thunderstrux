---
status: living
last-reviewed: 2026-10-31
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Stripe Payments and Connect]]", "[[Memberships and Merchandise]]", "[[Audit Coverage]]"]
sources: [lib/payments/order-refunds.ts, lib/payments/compensation-refunds.ts, lib/payments/purchase-disputes.ts, lib/payments/dispute-evidence.ts, lib/payments/fraud-warnings.ts, lib/payments/dispute-reversals.ts, lib/commerce/payment-recovery.ts, lib/orders/order-detail.ts]
---

# Payment Lifecycle Refunds and Disputes

**Owns:** money going back after a sale, for tickets and for memberships and merchandise: whole-order refunds and "refund the rest", compensation refunds of payments that couldn't be honoured, the "refunded outside Thunderstrux" mark, refunds made in Stripe's dashboard, disputes, early fraud warnings and lost-dispute transfer reversals.
**Read when:** changing a refund, dispute or cancellation path, the refunds worker, or what any of them does to orders and tickets.
**Not here:** order, ticket and hold states, fulfilment and compensation entry ([[Payment Lifecycle]]); free cancellation ([[Event Lifecycle]]); webhook routing, payouts and the Stripe calls' parameters ([[Stripe Payments and Connect]]); membership revocation and merchandise returns ([[Memberships and Merchandise]]); refund and cancellation emails ([[Email Delivery Implementation]]).

## Code

| Concern | Where |
| --- | --- |
| Whole-order refunds, worker, webhook | `lib/payments/order-refunds.ts`: `requestOrderRefund`, `openOrderRefund`, `requestCommerceRefund`, `openCommerceRefund`, `openCommerceCompensation`, `closeRepaidReview`, `reopenRepaidReview`, `processOrderRefundBatch`, `reconcileOrderRefundEvent` |
| Ticket compensation refunds | `lib/payments/compensation-refunds.ts`: `processCompensationRefundBatch`, `resumeCompensationRefund`, `reconcileRefundEvent`, `confirmCompensationRefund` |
| Ticket disputes and outside refunds | `lib/payments/purchase-disputes.ts`: `reconcileDisputeEvent`, `reconcileExternalRefundEvent`, `restoreDisputedTickets`, `markExternalRefundReviewed` |
| Commerce disputes, outside refunds | `lib/commerce/payment-recovery.ts` |
| A dispute's draft answer, staged in Stripe | `lib/payments/dispute-evidence.ts`: `stageDisputeEvidence` |
| Early fraud warnings | `lib/payments/fraud-warnings.ts`: `reconcileEarlyFraudWarning`, `fraudRefundReason` |
| Lost-dispute reversals; what a refund didn't take back | `lib/payments/dispute-reversals.ts`: `queueDisputeReversal`, `processDisputeReversalBatch`, `unreversedRefundAmount` |
| Event cancellation (refund every order) | `lib/events/event-cancellation.ts`: `cancelOrganisationEvent` ([[Event Lifecycle#Cancelling]]) |
| Manual refund mark, resend refusals | `lib/orders/order-detail.ts`: `markOrganisationOrderManuallyRefunded` |
| Worker | `scripts/process-compensation-refunds.ts` (`pnpm compensation-refunds:process`) |
| Tests | `tests/integration/order-refunds.test.ts`, `tests/integration/compensation-refunds.test.ts`, `tests/integration/purchase-disputes.test.ts`, `tests/integration/commerce-payment-recovery.test.ts`, `tests/integration/membership-refunds.test.ts`, `tests/integration/merchandise-after-sale.test.ts`, `tests/integration/event-cancellation.test.ts`, `tests/integration/early-fraud-warnings.test.ts`, `tests/e2e/order-refunds.spec.ts` |

## Staff routes

All take the order from the dashboard's selected society and lock it scoped to that society; another society's order is 404.

| Route | Permission | Body | Answers |
| --- | --- | --- | --- |
| `POST /api/orders/[orderId]/refunds` | `orders:refund` + fresh MFA code unless MFA is `off` | `reason` (8 to 500), `confirmation` (the order's short reference), `mfaCode` | 200 when Stripe confirmed, 202 pending or uncertain; 400 `confirmation_mismatch`; 409 `not_refundable`, `in_progress`, `already_refunded`, `disputed`, `verification_failed`, `provider_refused` |
| `POST /api/orders/[orderId]/cancel` | `orders:refund` + fresh MFA code | `reason`, `mfaCode` | `{ status: "cancelled" }` or `already_cancelled`; 409 `not_cancellable` |
| `POST /api/orders/[orderId]/review` | `orders:refund` | `{ action: "restore_tickets", reason }` or `{ action: "mark_reviewed" }` | 409 `not_allowed` |
| `POST /api/orders/[orderId]/compensation-refund/confirm` | `orders:refund` | `refundId` (`re_...`) | 404; 409 when Stripe's refund doesn't verify or the job isn't confirmable |
| `PATCH /api/orders/[orderId]/refund-manual` | `orders:refund_mark` + fresh MFA code unless MFA is `off` | `reason` (8-500), `mfaCode` | 409 refusals below |

Membership and merchandise refunds go through `POST /api/orgs/[orgSlug]/memberships/members/[grantId]/refund` and `POST /api/orgs/[orgSlug]/merchandise/orders/[orderId]/refund`, which call `requestCommerceRefund` with the same body and 200 or 202. When a code is sent, `staff_mfa_verify` limits guesses. Audit rows: [[Audit Coverage]].

## Order refunds

A `RefundRequest` refunds one ticket order or one commerce order (database check: exactly one of `orderId`, `commerceOrderId`).

**`RefundRequestStatus`:** `pending` → `succeeded` or `failed`; `pending` → `uncertain` (no answer) → `succeeded`, `failed` or still `uncertain`.

**`refundStatus`** (`OrderRefundStatus`, on `Order` and `CommerceOrder`) is the financial fence: `processing` while a request is in flight, `refunded` once one succeeds. Compensation never starts on a fenced order, and an ordinary refund never starts on an order in compensation.

1. **Request** (under the purchase lock; commerce locks the family's resources first). The typed reference must match, then:
   - refused when already `refunded` or `processing`, or a dispute is `open` or `lost` (a won one can be refunded, PAY-036);
   - the order must be a Stripe, `paid`, fulfilled order with a Session and a seller snapshot, not under compensation review. Tickets also need no `isManuallyRefunded` mark and a compensation job that is absent or `recovered`.
   
   The checks and the fence are `openOrderRefund`, shared with event cancellation, and `openCommerceRefund`, shared with fraud warnings and commerce compensation. A staff refund sends at once under its own lease; an event cancellation leaves each request `pending` with no lease, and the refunds worker sends it on its next run (one code for the whole event instead of one per order).
   Without tickets (event cancellation, a fraud warning, Refund the rest) the amount is everything left, `totalAmount` less succeeded requests (`refundedSoFar`) and `externalRefundedAmount`, on every ticket still standing; with nothing left it is `already_refunded`, even when staff kept the tickets valid. **Ticket by ticket (DEBT-002, as Humanitix):** staff pick valid tickets (`ticketIds`), an amount up to `min(picked × unitPrice, left)`, whether they are cancelled (`cancelsTickets`) and whether the buyer is emailed (`notifyBuyer`, optional `buyerMessage` up to 500). $0 with cancel is `cancelOrderTickets`: no request and no Stripe; the tickets `void` (`cancelled`) and go back on sale, `tickets_cancelled`, audit `order.tickets_cancelled`, the buyer's notice if asked, and `refundStatus` unchanged. It records the request (`operationKey` `order-refund:<uuid>` or `commerce-refund:<uuid>`, `destinationAccountId` from the snapshot), sets `refundStatus = processing`, appends `refund_requested` and writes the audit row.
2. **Verify, outside the transaction:** re-read the Session with its PaymentIntent and charge. It must be paid, match total, currency and the order id in metadata, have `amount_received` equal to the total, and transfer to the snapshot account. The charge's `disputed` flag is not read: Stripe keeps it true after a dispute closes, so a won dispute would block every later refund. The order's `disputeStatus` fences an open or lost dispute, and Stripe refuses a refund while one is open (PAY-021). Stripe's other refunds on the payment must equal what is already recorded (earlier succeeded requests plus `externalRefundedAmount`), else `existing_refund_requires_review`, except as below. The PaymentIntent is recorded on the request and the order before anything is sent.

   **A refund made in Stripe while a request waits (PAY-049):** the charge says what Stripe will still refund (`amount` − `amount_refunded`). When that is less than a request the worker is sending:
   - at 0 the request closes `failed` (`refunded_elsewhere`), with no buyer email and no alert, because the buyer has their money; the staff order page says "Already refunded in Stripe";
   - otherwise `amount` drops to what is left and `operationKey` changes, in one update before sending, because Stripe refuses a key sent again with another amount.

   The mismatch check doesn't stop these: the buyer was promised this refund, and what Stripe has left is the most that can go, whether or not the webhook has recorded the other refund yet. It still stops a request that fits what is left, because then a refund nobody recorded isn't what made it impossible. It also stops every refund staff send themselves: they confirmed an amount, so they review what Stripe has instead of having it changed for them. Once a PaymentIntent was recorded the request's own refund may exist, so it is never resized or closed this way (SEC-011).
3. **Send:** `refunds.create` with `reverse_transfer`, `refund_application_fee`, metadata `refundRequestId` plus `orderId` or `commerceOrderId`, and `operationKey` as the idempotency key. A refund this request already made is reused, never sent twice.
4. **Outcome** (`applyOutcome`, under the purchase lock; an older Stripe event never overrides a newer one):
   - `succeeded` on tickets: the request's tickets `void` (`refunded`, check-ins kept, places back on sale: PAY-043; every standing one for a request without tickets; none when `cancelsTickets` is off), `refunded`, and if `notifyBuyer` the buyer's `refund/{requestId}` notice naming them. `refundStatus = refunded` once no ticket is left standing, even if staff kept part of the money; otherwise the fence lifts and the order can be refunded again.
   - `succeeded` on commerce: `refundStatus = refunded`, review cleared, every membership it bought revoked (`Refunded: {reason}`, by the requester), an uncollected pickup cancelled, and the buyer's notice. Stock comes back only through a return.
   - `pending`: the fence stays; `refund_pending` once, polled every minute.
   - `failed`, `canceled`, a verification mismatch or a definite refusal: request `failed`, fence lifted, `refund_failed`. Tickets stay valid and memberships active. Unless staff saw it fail on screen (a refund the worker, an event cancellation, a fraud warning or commerce compensation sent, or Stripe's later answer), it alerts `refund_failed`, and a cancelled event's buyer, told the refund had started, gets `refund-failed/{requestId}` (PAY-026).
   - **Came back after succeeding** (`refund.failed` on a `succeeded` request, PAY-025): the bank returned it and Stripe put the money in Thunderstrux's balance. The request stays `succeeded` (`lastErrorCode = provider_refund_returned`), tickets stay void (the society's share was taken back), `refund_failed` (`returned_by_bank`) is appended once, the buyer gets `refund-returned/{requestId}`, and `refund_failed` alerts a person to repay them another way.
5. **No answer:** the request becomes `uncertain`. The worker (`processOrderRefundBatch`) claims due `pending` and `uncertain` requests with a 10-minute lease and looks up the request's own refund at Stripe before sending the same key again. Once a PaymentIntent was recorded the refund may exist, so a failed lookup or refusal keeps it `uncertain` rather than failing it; Stripe's signed outcome settles it (SEC-011). After 6 attempts it keeps the fence, alerts `order_refund_unresolved` and asks Stripe hourly instead of every minute, so a late answer still settles it.
6. **Webhook** (`refund.*` with `refundRequestId`): the refund must name the request's purchase (and not the other kind), match amount, currency and the recorded PaymentIntent. It is journalled in `StripeRefundWebhookEvent` in the transaction that applies it, so a delivery that fails to apply is applied by Stripe's retry instead of being dropped as a duplicate.

The order keeps `status = paid`; lists show Refund processing or Refunded.

## Compensation refunds

A payment Stripe took that the order couldn't honour ([[Payment Lifecycle#Fulfilment]]).

**Tickets** use `CompensationRefundJob`, one per order, created from `compensationRefundModeSnapshot` (`CompensationRefundMode`). New events default to `automatic_full` (`lib/validators/events.ts`); the schema default and older events are `manual_review`.

| `CompensationRefundState` | Meaning | Next |
| --- | --- | --- |
| `review_required` | A person decides (manual mode, or automatic stopped for review) | `refunded` by staff confirmation |
| `auto_queued` | Waiting for the worker | `auto_processing` |
| `auto_processing` | Claimed by the worker (`processingToken`, 10-minute lease) | `refund_pending`, `refunded`, `refund_failed`, `review_required`, `auto_queued` (retry) |
| `refund_pending` | Stripe is processing the refund; polled every minute | `auto_processing`, `refunded`, `refund_failed`, `review_required` |
| `refunded` | Stripe confirmed; terminal | |
| `refund_failed` | Stripe failed it, or 5 tries errored; terminal for the worker | `refunded` by staff confirmation |
| `recovered` | History only: nothing writes it now, because a payment under review is never fulfilled; terminal | |

- **Claim** (SERIALIZABLE, order locked): `auto_queued`, `refund_pending`, or a stale `auto_processing`. The order must still be `failed`, under review, not manually refunded, without `refundStatus` or an open or lost dispute, `automatic_full`, ticketless, with a Session and a connected account. Otherwise → `review_required` (`local_state_not_eligible`). A claim appends `compensation_refund_started`.
- **Verify:** the Session, PaymentIntent and charge must match the job's amount, currency `aud` and the ticket metadata, and transfer to the society's connected account. As above, the charge's `disputed` flag is not read; the claim already refuses an open or lost dispute. Its own earlier refund (metadata `compensationRefundJobId`) is reused; any other refund on the payment → `review_required` (`existing_refund_requires_review`).
- **Send:** `refunds.create` with `reverse_transfer`, `refund_application_fee`, metadata `compensationRefundJobId` and `orderId`, key `compensation-refund:<orderId>`.
- **Outcome:** succeeded → `refunded`: review cleared, `isManuallyRefunded = true`, buyer notice `compensation-refund/{jobId}`, `compensation_refunded`. Failed or canceled → `refund_failed`. Pending → `refund_pending`, or `review_required` once 5 attempts are used (`provider_refund_pending_review`). Any other error → `auto_queued` after min(2^(n−1), 30) minutes, or `refund_failed` at 5 attempts.
- **Webhook** (`refund.*` with `compensationRefundJobId`): must match the job, its order, amount, currency and recorded PaymentIntent, is journalled once, and never moves a job out of `recovered`, `refunded` or `refund_failed` or back to an older event's state. A `refunded` job whose refund came back from the bank stays `refunded` (`provider_refund_returned`), appends `compensation_refund_failed` (`returned_by_bank`) and emails `compensation-refund-returned/{jobId}` (PAY-025).
- **Alert:** `compensation_refund_needs_review` whenever a job reaches `review_required` or `refund_failed`, or its refund came back (PAY-026).
- **Staff confirmation** (`confirmCompensationRefund`): staff paste the Stripe refund id of a refund made in the dashboard. It must have succeeded for the job's amount on the order's payment, and the payment must still verify. Stripe must also show the society's transfer reversed (`unreversedRefundAmount` is 0) and the application fee refunded, or it answers 409 asking for both (PAY-027). It needs a fresh authenticator code unless staff MFA is `off` (SEC-036). Allowed from `review_required`, `refund_pending` or `refund_failed`; it ends `refunded` with the same effects and audit `order.compensation_refund_confirmed`.
- **Held by a dispute (PAY-056):** Stripe refuses a refund during a dispute, and a lost one is already back with the buyer, so the claim stops the job. Once every dispute has closed won, `resumeCompensationRefund` returns a job the dispute stopped to `auto_queued` (`compensation_refund_queued`, `dispute_won`), and the claim and checks run as usual. Any other stopped job, so every `manual_review` one, stays with a person and alerts `reason: dispute_won`: nothing else says it can now be refunded.

**Commerce** has no compensation mode or job: `requireCompensation` calls `openCommerceCompensation`, which is `openCommerceRefund` with `compensation`: it queues a system `RefundRequest` for what isn't already back with the buyer (`totalAmount − externalRefundedAmount`, nothing at 0; PAY-038) (no actor, key `commerce-compensation:<id>:<uuid>`) under the usual fence, through the order refund path above. The order is failed, unfulfilled and under review, so the checks on a sale don't apply. An open dispute does (PAY-036): no request opens and the order stays in review, until the last dispute closes won and `reconcileCommerceDisputeEvent` opens it under the same locks (PAY-056). A verification mismatch fails the request and leaves the order in review for staff.

**Closing a review (PAY-057):** once lost disputes and refunds made in Stripe cover the whole payment, nothing is owed, so `closeRepaidReview` clears the review, ends a ticket job (`refunded`, no `stripeRefundId`), appends `refunded` (`dispute_lost` or `refunded_outside`), writes audit `compensation_review_closed` and emails `payment-review-closed/{id}`. It runs on the dispute and refund events and at the late paid webhook, which then sends no `payment-review/` notice and no alert. A refund in Stripe also sets `refundStatus`; a lost dispute doesn't, so payouts keep holding for its reversal. Short of the whole payment it stays with a person, who gets `paid_but_unfulfilled_compensation_required` (`reason: dispute_lost_for_part`); a commerce refund in flight settles the order itself. A dispute that turns from lost to won (a late win or withdrawal) takes the money back from the buyer, so `reopenRepaidReview` reopens the review and the win's path above refunds it; if the reversal already ran, that refund can fail and alerts `refund_failed`. A paid replay leaves a failed order with `paidAt` alone, so a closed review stays closed.

**What the buyer reads:** while a dispute holds the refund, the `payment-review/{id}` notice and order pages (`reviewDisputeWords`) say the bank decides how the money comes back, never that a refund is coming.

## Refunded outside Thunderstrux

**Manual mark** (`PATCH .../refund-manual`): with a reason (8 to 500 characters: how and when the buyer was refunded, kept on the lifecycle event and the audit row and shown in the order history and History) and a fresh authenticator code, sets `Order.isManuallyRefunded` once, voids the order's tickets (`refunded_outside`, places back on sale) and appends `manual_refund_marked`; nothing changes at Stripe. The buyer had their money back, so their tickets stop admitting, as after a full refund made in Stripe. Payouts still hold the sale until its event is over, because the mark proves nothing at Stripe (PAY-016). Allowed only on a `paid` order: a checkout that didn't complete took no money, and the mark emails the buyer a refund (PAY-047). Refused for free orders, orders under compensation or with a compensation job (staff confirm the Stripe refund instead), orders with `refundStatus`, and orders with an open or lost dispute. The buyer is emailed that their tickets are cancelled (`refund-marked/{orderId}`, PAY-039). A marked compensation order can't be recovered by a later webhook. A marked paid order reads "Refunded outside Thunderstrux" to staff and Refunded to the buyer ([[Payment Lifecycle#Display status]]); the order page's dialogs say places go back on sale (except for a cancelled event) and the buyer is emailed (UI-012).

**Refunds made in the Stripe dashboard** (a `refund.*` event naming neither a request nor a job): commerce is asked first, by PaymentIntent (stored on the order, or Stripe's Session with `family` metadata).
- The event's PaymentIntent must resolve to an order whose Session names it, in the same currency, paid to the seller snapshot (orders without a snapshot skip that check). Anything else changes nothing and logs `stripe.refund.unmatched`.
- `externalRefundedAmount` becomes the total of the payment's **succeeded** refunds that Thunderstrux didn't make; pending ones count for nothing. Each change clears `externalRefundReviewedAt` and appends `external_refund_recorded`.
- Full amount on a `paid` order or one under review (tickets count refunds made here too): `refundStatus = refunded`, tickets `void` (`refunded_outside`, places back on sale), memberships end. A review closes as above.
- Partial: tickets stay valid and the order reads Payment review until staff `mark_reviewed` (`external_refund_reviewed`), picking the tickets it covered (`void` `refunded_outside`, back on sale; none keeps all valid; DEBT-002), or a refund here takes the rest.
- A later drop (a refund that failed after succeeding) is recorded, but voided tickets and ended memberships stay so.
- **Not taken back from the society (PAY-027):** `externalUnreversedAmount` records what Stripe shows refunded on the payment but not reversed from its transfer (`unreversedRefundAmount`: the charge's `amount_refunded` less the transfer's `amount_reversed`). Above 0 it alerts `outside_refund_not_reversed`, and the payout hold keeps the sale's share until Stripe shows it reversed; the payout worker re-reads it before each run, so a reversal made by hand is seen within the hour.

## Disputes

`PurchaseDispute`, one per Stripe dispute, on a ticket order or a commerce order (never both). Each `charge.dispute.*` event is verified, journalled once, then projected from the dispute as re-read from Stripe:

- Verification: the dispute's PaymentIntent resolves to the order as above, and the dispute is on that payment's charge, in its currency and no larger than the order. Otherwise nothing changes; log `stripe.dispute.unmatched` and alert `purchase_dispute_unmatched`.
- Stripe's status maps to `OrderDisputeStatus`: `lost` → `lost`; `won` and `prevented` → `won`; anything else `open`. An inquiry (`warning_*`, a bank's question before any chargeback) doesn't count: it sets no `disputeStatus`, puts no ticket under review and blocks no refund; its alert and draft answer stay, and payouts hold the sale while it is open (PAY-037). A chargeback that follows puts the tickets under review then.
- **Worst of:** a charge can carry several disputes. The order's `disputeStatus` is the worst one: `lost`, then `open`, then `won` (SEC-024). One won dispute can't release another's fence or payout hold.

| | Ticket order | Commerce order |
| --- | --- | --- |
| Opens | `active` tickets → `refund_review` (`disputed`); `dispute_opened`; alert `purchase_dispute_opened` | `dispute_opened`; alert `purchase_dispute_opened` |
| While `open` | Refunds, ticket resends, the manual mark and compensation refunds are refused | Refunds and pickup hand-over are refused |
| Lost | Disputed tickets `void` (`dispute_lost`, places back on sale); status stays `lost`; reversal queued; the buyer reads "Refunded by your bank" (UI-010), staff still see the dispute | Memberships end; nothing to hand over; reversal queued |
| Won | Tickets stay under review until staff with `orders:refund` restore them; the order can be refunded meanwhile, and an event cancellation refunds it (PAY-036). A held compensation refund resumes | `disputeStatus` clears at once; the dispute stays in history. A held compensation refund opens |

**Who answers.** On destination charges the dispute is on the platform's account, and societies can't see it in Express, so the platform operator answers it in Stripe's Dashboard ([[Production Operations]]). An unanswered dispute is lost.
- **Draft answer** (`stageDisputeEvidence`): once the transaction that records a newly opened dispute commits, the facts Thunderstrux holds are staged on it with `disputes.update(..., { submit: false })`. Stripe's default would send them to the bank; staging never does, the operator submits. Only while Stripe still takes an answer (`needs_response`, `warning_needs_response`) and nothing is on it yet (`has_evidence` false).
  - Tickets: buyer name and email (`retainedBuyerIdentity`), what was bought, the event date, each ticket's door scan time (or that none was scanned, or that none was issued), the society's refund policy as checkout shows it today, and a summary: paid time, when the tickets were emailed, and every refund already made (Thunderstrux refunds with their Stripe ids and dates, a compensation refund, refunds made outside Thunderstrux). The policy is today's wording, since it isn't kept per sale. The refund lines answer a buyer who was refunded and disputed anyway.
  - Commerce: buyer, the lines bought, the refund policy, paid time, a collected merchandise pickup, and refunds already made.
  - Any failure (for example a key without Disputes write) logs `stripe.dispute.evidence_not_staged` and alerts `dispute_evidence_not_staged`; it never fails the webhook, because the event is already journalled.
- **Reminder:** the monitor alerts `purchase_dispute_evidence_due` for each dispute still `needs_response` or `warning_needs_response` whose `evidenceDueBy` is within 72 hours, every 6 hours, until a submitted answer moves Stripe's status and its `charge.dispute.updated` event updates `providerStatus`.

**Restore** (`restore_tickets`, reason 8 to 500): allowed only when `disputeStatus = won` and every unresolved dispute is won. It resolves them all together, puts `disputed` tickets back to `active`, clears `disputeStatus` and appends `dispute_resolved`. Later events for a resolved dispute are history only. A dispute is not a refund.

## Early fraud warnings

A card issuer's early fraud warning (`radar.early_fraud_warning.created`) usually comes before a fraud chargeback. Refunding first avoids the dispute fee and the society losing the sale (PAY-023). `reconcileEarlyFraudWarning` (`lib/payments/fraud-warnings.ts`):
- Journals the event once in `StripeRefundWebhookEvent`, re-reads the warning, and finds its order through the warning's PaymentIntent as disputes do (`verifiedCommercePayment`, then `verifiedOrderPayment`); the charge must be the warning's. Anything else alerts `early_fraud_warning` with `outcome: "unmatched"` and changes nothing.
- Under the purchase lock, an **actionable** warning on an **unused** order is refunded in full:
  - Tickets: no ticket scanned (`checkedInAt`), then `openOrderRefund` with no actor (history source `stripe_webhook`), so its usual refusals apply: refunded, in progress, disputed, in compensation, marked refunded.
  - Commerce: merchandise not collected, then `openCommerceRefund` with no actor, so the same refusals apply: refunded, in progress, disputed, in compensation; the amount is the total less `externalRefundedAmount`.
  - Either way a system `RefundRequest` (no actor, reason `fraudRefundReason`) is left `pending` for the refunds worker, as event cancellation does, and the buyer gets the usual refund email. History shows it as Thunderstrux's.
- A key that can't read the warning (a permission, authentication or invalid-request refusal) alerts `outcome: "unreadable"` and answers 200 instead of failing every delivery; other errors answer 500 so Stripe retries.
- Every decision alerts `early_fraud_warning` with `outcome`: `refund_queued`, or why not (`not_actionable`, `used`, `disputed`, `already_refunded`, `in_progress`, `not_refundable`, `not_found`).

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

## Traps

- Set the fence (`refundStatus = processing`) under the purchase lock before calling Stripe, and never call Stripe inside the transaction.
- Never send a refund key twice without first looking for its refund at Stripe; an uncertain request may already have moved money.
- An outside refund that is partial is never treated as full. Analytics don't see outside refunds at all ([[Analytics and Calendar]]).
- Refunds return the platform fee (`refund_application_fee`); Stripe keeps its processing fee (PAY-008).

## Failure and recovery

- **`order_refund_unresolved`:** the request is still uncertain after 6 tries and the fence stays; the worker keeps asking Stripe hourly. Check Stripe for a refund with that `refundRequestId`; there is no tool to settle it by hand.
- **`dispute_reversal_unresolved`:** reverse the transfer in Stripe's Dashboard, or decide not to.
- **Compensation `refund_failed` or `review_required`** (`compensation_refund_needs_review`): during a dispute, wait: Stripe refuses the refund, and `reason: dispute_won` says when it can go. Otherwise refund in Stripe's Dashboard with **Reverse transfer** and **Refund application fee** ticked: its webhook closes the review, and only if that doesn't arrive do you confirm the refund id on the order page. Any Dashboard refund needs both ticked, or the society keeps money Thunderstrux paid back.
- **`refund_failed`:** a failed refund can be sent again from the order page. One that came back from the bank (`returned_by_bank`) is in Thunderstrux's balance; repay the buyer another way.
- **`outside_refund_not_reversed`:** reverse the transfer by `unreversed` in Stripe (Connect, Transfers) and refund the application fee.
- **`purchase_dispute_unmatched`:** the dispute's payment didn't verify as any order's; investigate in Stripe.

## Related

[[Payment Lifecycle]] · [[Stripe Payments and Connect]] · [[Memberships and Merchandise]] · [[Email Delivery Implementation]] · [[Audit Coverage]] · [[Ticket Check-in Implementation]]
