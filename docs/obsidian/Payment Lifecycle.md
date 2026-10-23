---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Stripe Payments and Connect]]", "[[Email Delivery Implementation]]"]
sources: [lib/payments/checkout-reconciliation.ts, lib/payments/order-lifecycle.ts]
---

# Payment Lifecycle

Delivery and defect-resolution evidence is retained in the validation section below and in merged PR #13. Repeatable engineering and PR procedure: [[Engineering Delivery Workflow]].

P3.19 adds an append-only business-event journal around the existing `Order`, `TicketReservation`, `Ticket`, refund, and `EmailOutbox` fields. Existing status enums and API response contracts remain authoritative for current state; `OrderLifecycleEvent` explains how that state was reached.

## Account Closure And Buyer Identity

Closure retains original Order/User identifiers, tickets, attendance and lifecycle records. Buyer contacts use immutable captures with explicit provenance; anonymised login email is not a delivery address. A new signup never inherits old purchases. Later provider payment/refund truth remains authoritative, independently of account closure. See [[Database and Multi Tenancy]] and [[Email Delivery Implementation]].

## Purchase Snapshots (T10)

Checkout records what was bought when it creates the order: `paymentKind` (`stripe` or `free`; required with no default), the purchased ticket type name, seller name and connected Stripe account, currency, the platform fee in cents and its policy version (`platform_fee_10_percent_v1`), `snapshotVersion`, and the buyer contact with provenance `purchase`. These are the values the Stripe Session charges, and later edits to the ticket type, society or profile never change them. Fulfilment sets `fulfilledAt` with `paidAt` and numbers each ticket with a unique `(orderId, issueSequence)`, so a second issuance for the same order fails instead of adding tickets. Tickets carry `validity` (`active`, `void`, `refund_review`); only active tickets appear in the wallet, ticket email and door list.

`lib/purchases/projection.ts` turns status, kind and compensation review into the one displayed status: Processing, Paid, Free, Payment review, Failed or Expired. Free orders keep the compatible `status = paid` and `paidAt`, so money queries must filter on `paymentKind`, not status. Legacy rows keep unknown names, sellers and fees as null; readers show today's ticket name followed by "(historical label unavailable)" and never write it back. Migration `20261015010000_ticket_purchase_snapshots` backfills only known facts: every existing order is Stripe (checkout always rejected zero totals), `fulfilledAt` is the first ticket's creation time for paid orders, and existing tickets are numbered by `(createdAt, id)`.

## Payment Destination and Mode (T17)

Fulfilment checks where the money went. `reconcileCompletedCheckoutSessionWithSideEffects`, the only production entry (signed webhook and the development success fallback), reads the Session's PaymentIntent from Stripe before any lock and passes its `transfer_data.destination`. Reconciliation compares it with the order's `sellerStripeAccountId` snapshot: a different destination, or a paid Session without a PaymentIntent, is held for compensation review (`webhook_mismatch`) instead of fulfilled. Orders from before T10 have no snapshot and are not checked. Both webhooks ignore events from the other Stripe mode, and live keys are refused outside production (see [[Stripe Payments and Connect]]).

## Free Registrations (T13)

`lib/payments/free-ticket-issuance.ts` fulfils a zero-price selection where checkout locks it (User, Event, then TicketType), after the same sale-state, readiness, price and sellable-stock checks as a paid checkout. It writes a free `Order` (`paymentKind: free`, `status: paid`, `paidAt = fulfilledAt`, unit price, total and fee 0, no seller Stripe account), numbered tickets, one stock decrement, `order_created` and `free_fulfilled` lifecycle events, a `CheckoutAttempt` without a reconcile time (so the recovery worker never claims it) and the automatic ticket email, all in one transaction. No Stripe call, fee calculation or hold. A replay with the same key returns the same order.

Free orders count as sold tickets (the Summary splits paid and free) but never as revenue: revenue by day and the overview's monthly revenue read `paymentKind: stripe`. The order page says nothing was charged and hides the refund and Stripe session controls, and marking a free order refunded is refused. Cancelling a free registration arrives with T18c.

## Checkout Attempts (T14a)

Every paid checkout is a `CheckoutAttempt` (`lib/payments/checkout-attempts.ts`): the actor, the client's `idempotencyKey`, a hash of the selection (event, ticket type, quantity, expected price), the order, a stable server-generated `providerOperationKey` and, once bound, the Stripe Session. The attempt is created in the same transaction as the pending order and hold.

- The same actor and key returns the same attempt: a double click or a retry after a lost response never creates a second order or Session. The same key with a different selection is a 409.
- The provider key is sent to Stripe as its idempotency key, so replaying Session creation returns the original Session.
- Only a definite Stripe refusal (card, invalid request, authentication, permission or rate-limit error) fails the order, its attempt and the hold. A timeout, connection or unknown error, or a Session that cannot be bound, leaves the attempt `provider_uncertain` with its order and hold, and checkout answers 202. The buyer polls `GET /api/payments/checkout/attempts/[attemptId]`.
- A webhook that fulfils before the Session is bound converges: binding finds the order already on that Session and marks the attempt attached.
- States: `created`, `provider_uncertain`, `provider_attached`, `failed`. Completed and expired come from the order. `reconcileDueAt` marks attempts due for recovery.

## Checkout Attempt Recovery (T14b)

Checkout stores the exact Stripe Session request on the attempt (`providerRequest`) before calling Stripe. `scripts/process-checkout-attempts` (`pnpm checkout-attempts:process`, Compose service `checkout-recovery-worker`) claims due `created` or `provider_uncertain` attempts, locking the order and then the attempt and hiding each claim for a two-minute lease, so a crashed worker's claim reappears. It replays the stored request with the attempt's idempotency key:

- **Stripe returns a Session:** it is the original one. It is bound to the still-pending order, or the attempt converges on a webhook that bound it first.
- **Stripe refuses:** no Session exists. A request Stripe never received is by then within 30 minutes of its stored expiry, which Stripe rejects. The order fails and its hold is released.
- **Unknown again:** the hold is kept and recovery retries in two minutes, until Stripe's 24-hour idempotency window passes (alert `checkout_attempt_recovery_abandoned`).
- **The order already closed** (its hold and the Session expire together): the Session is recorded on the failed attempt. A payment on it still arrives by webhook and goes to compensation review.
- **No stored request:** checkout stopped before calling Stripe, so the order fails without a Stripe call.

Worker actions appear in the order history with source `checkout_recovery`. A worker failure logs `checkout_attempt_recovery.worker.failed` and alerts `checkout_attempt_recovery_failed`.

## Whole-Order Refunds (T18a)

`lib/payments/order-refunds.ts`. A refund is one `RefundRequest` for the whole order, started by staff with `orders:refund` from order detail (POST `/api/orders/[orderId]/refunds`). Rules, in order:

- **Request:** under the Order lock the order must be a paid, fulfilled Stripe order with no compensation review, no manual "recorded outside Thunderstrux" mark, no live compensation job and no `refundStatus`; the staff member types the order's short reference, gives a reason (8 to 500 characters) and, unless staff MFA is off, a fresh authenticator code. The request is recorded and `Order.refundStatus` becomes `processing`: the financial fence. Compensation refunds never start on a fenced order, and ordinary refunds never start on an order in compensation.
- **Stripe, outside the transaction:** the Checkout Session and PaymentIntent are re-read and must match the order (amount, currency, order id, the snapshot destination account, not disputed). A refund Stripe already holds that this request did not make (dashboard or compensation) stops the request for review rather than adding a second one. Then `refunds.create` with `reverse_transfer` and `refund_application_fee`, metadata `refundRequestId` and `orderId`, and the request's `operationKey` as the idempotency key.
- **Outcome:** `succeeded` sets `refundStatus = refunded`, voids every ticket (`validity: void`, reason `refunded`; attendance and check-ins are kept, stock is not restored), appends `refunded` and queues a refund notice to the buyer. `pending` keeps the fence until a webhook or the worker confirms. `failed`, a definite Stripe refusal or a verification mismatch lifts the fence and leaves the tickets valid.
- **No answer:** the request becomes `uncertain`. The refund worker (`scripts/process-compensation-refunds`, which now also runs `processOrderRefundBatch`) first looks for the request's own refund at Stripe; only if there is none does it send the same key again. After six attempts it stops retrying, keeps the fence and alerts `order_refund_unresolved`.
- **Webhooks:** `refund.created`, `refund.updated` and `refund.failed` carrying `refundRequestId` go to the ordinary refund, those carrying `compensationRefundJobId` to compensation, and anything else is a refund made outside Thunderstrux (T18b, below). The event must match the request's recorded PaymentIntent, amount and currency, is journalled once in `StripeRefundWebhookEvent`, and an older event never overrides a newer one.

The order keeps `status: paid`; projections read `refundStatus` first, so lists and detail show Refund processing or Refunded.

**Commerce orders (T23c).** The same code refunds a membership order and, since T28b, a merchandise order (a confirmed refund cancels a pickup not yet collected; stock comes back only through a return): a `RefundRequest` names exactly one of `orderId` or `commerceOrderId` (database check), and `CommerceOrder.refundStatus` is the same fence, allowed only on Stripe payments. `requestCommerceRefund` locks the family's resources then the order (member, society, order for a membership) and accepts only a fulfilled, paid Stripe order with no compensation review; the Session check reads `commerceOrderId` from its metadata, and the refund carries `commerceOrderId` (never `orderId`), which the webhook checks. Verification, the stable key, the uncertain-outcome lookup, the worker and the webhook journal are shared with tickets; a few helpers in `order-refunds.ts` pick the purchase's lock, history, fence and metadata. A confirmed refund marks the order `refunded`, revokes every membership it bought (`Refunded: {reason}`, by the requesting staff member) and emails the buyer; a failure lifts the fence and the membership stays active. Commerce orders have no projection of disputes or refunds made in Stripe's dashboard yet, so a request stops for review if Stripe already shows another refund (PAY-003).

## Disputes and Refunds Made Outside Thunderstrux (T18b)

`lib/payments/purchase-disputes.ts`. Stripe reports both through signed webhooks, but each handler re-reads Stripe's current state (the dispute, or the payment's refund list), so duplicate and out-of-order deliveries reach the same result. Before anything changes, the event's PaymentIntent must resolve to an order (by `Order.stripePaymentIntentId`, or the Checkout Session Stripe lists for it, which must name the order and be its session), the Session must name the order, the currency must match and the money must have gone to the order's seller snapshot. A dispute must also be on the payment's own charge and no larger than the order. Anything that does not verify changes nothing; an unmatched dispute alerts `purchase_dispute_unmatched`. Applied events are journalled once in `StripeRefundWebhookEvent` (with neither link set).

- **Disputes** (`charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`): the first verified event records a `PurchaseDispute`, sets `Order.disputeStatus = open`, moves every active ticket to `refund_review` (reason `disputed`, shown as "Under review"; check-in accepts only active tickets), appends `dispute_opened` and alerts `purchase_dispute_opened`. While `disputeStatus` is set, Thunderstrux refunds, ticket resends, the manual "recorded outside Thunderstrux" mark and compensation refunds are refused. A dispute is not a refund. `lost` voids the disputed tickets (reason `dispute_lost`) and stays set. `won` (or `warning_closed`, an inquiry that never became a chargeback) keeps the tickets under review until an owner or finance manager restores them with a reason of 8 to 500 characters (`dispute_resolved`, audited); that clears the fence, and later events for that dispute are history only.
- **Refunds made outside Thunderstrux** (a `refund.*` event naming neither a request nor a compensation job, typically from the Stripe dashboard): `Order.externalRefundedAmount` becomes the total of the payment's succeeded refunds that Thunderstrux did not make; pending ones count for nothing. A full amount on a paid order sets `refundStatus = refunded` and voids the tickets (reason `refunded_outside`). A partial amount is never treated as full: the tickets stay valid, the order reads Payment review until staff mark it reviewed, and Refund the rest sends a Thunderstrux refund for the remainder (the T18a check accepts Stripe's other refunds only when they total exactly the part already refunded). Each change appends `external_refund_recorded`.

Lists and order detail read `disputeStatus` first: Disputed, then Refunded, Refund processing, and Payment review for compensation or an unreviewed partial refund.

## Cancelling a Free Registration (T18c)

`lib/payments/free-cancellation.ts`, the readiness plan section 3.3 shape that T23 (membership grants) and T28 (pickups) reuse. Staff with `orders:refund` cancel a confirmed free order (`paymentKind = free`, `status = paid`, fulfilled) from order detail with a reason of 8 to 500 characters and, unless staff MFA is off, a fresh authenticator code (POST `/api/orders/[orderId]/cancel`). Under the Order lock it records `cancelledAt`, `cancelledByUserId` and `cancellationReason`, voids the tickets (reason `cancelled`; check-ins are kept), appends `free_cancelled`, writes `order.free_cancelled` to the audit log and queues one cancellation notice to the buyer (event key `cancellation/{orderId}`). It is never a refund: no `RefundRequest`, no refund totals, and the order keeps `status = paid` and its original fulfilment. Stock is not restored; that stays a separate reviewed action. A repeat answers `already_cancelled` without changing anything, and the database refuses a cancellation on a non-free order or without a reason.

Read models show Cancelled before every other state ("Cancelled", long form "Cancelled – free purchase"); resends are refused, and the guest order page says the registration was cancelled instead of listing tickets.

## Membership and Merchandise Checkout (T21)

`lib/commerce/` (database spec 6.1 to 6.3 and 7), the commerce twin of ticket checkout. Each family (memberships since T23a; merchandise since T27a) plugs in through `lib/commerce/families.ts`: a selection schema, whether guests may buy, and four hooks that run inside the caller's transaction (`quote`, `lock`, `fulfil`, `release`). Lock order is the family's own resources first (membership: member then society; merchandise: variants in ascending id), then the commerce order. The registry ships empty: until a family is registered its checkout route answers 404 and a webhook for it fulfils nothing.

- **Checkout** (`lib/commerce/checkout.ts`, POST `/api/payments/checkout/membership` and `/merchandise`): the same key and selection replay the same attempt; the same key with a different selection is 409. Under the buyer lock (member, or for merchandise a verified guest's checkout session) the family quotes the lines; a total different from `expectedTotal` is a 409 quote change. A free total is created, fulfilled through the family and completed in the same transaction (`free_fulfilled`), with no Stripe call. A paid total needs a society that can take payments (a Session returns to `/memberships/orders/{id}` or `/merchandise/orders/{id}` on success and with `?left=1` on cancel; free options in a paid basket stay off Stripe's line items); the order (fee and policy snapshot, `expiresAt` 30 minutes out) and its attempt are committed, then the Session is created outside the transaction with the attempt's stable key and metadata `family`, `commerceOrderId` and `organisationId` on both the Session and the PaymentIntent, and bound to the order (`stripe_session_attached`). A lost Stripe answer leaves the attempt `provider_uncertain`; the attempt recovery worker replays the stored request with the same key and binds the original Session.
- **Webhook** (`lib/commerce/reconciliation.ts`): `checkout.session.completed` and `.expired` go to commerce only when the Session carries `family`. The order is found by its unique Session, or by `commerceOrderId` before the Session is bound; an unknown family, two different matches, a family or society that disagrees with the order, or another Session already bound is ignored with `commerce_webhook_identity_mismatch` and never sent to another family or to tickets. A Session without `family` is a ticket Session unless it belongs to a commerce order, which is also ignored with the alert. Under the family's locks and the order lock, a paid Session is checked for amount, currency and the destination snapshot, then the family fulfils it (`payment_fulfilled`); a replay changes nothing. A mismatch, a payment on an order that had already closed, a family that can no longer honour it (for example out of stock) or a family not registered becomes a compensation review on the order (`requiresCompensationReview`, `reviewReason`, `compensation_required`, alert `paid_but_unfulfilled_compensation_required`) and releases any hold. A completed but unpaid Session fails the order; an expired one expires it.
- **Workers**: attempt recovery (`process-checkout-attempts`) covers commerce attempts; the stale-order worker (`process-stale-orders`) expires pending paid commerce orders five minutes after their Session expired and releases their holds.

A commerce payment that needs review is recorded on the order.

**Commerce disputes, outside refunds and compensation (PAY-003).** `lib/commerce/payment-recovery.ts` gives membership and merchandise orders what T18b gives ticket orders. The webhook asks commerce first: a `charge.dispute.*` or unlabelled `refund.*` event is commerce's when its PaymentIntent belongs to a commerce order (stored on the order, or found from Stripe's Session by `family` metadata), and the order, family and destination still match. Anything else goes to the ticket handlers unchanged. Events are journalled once and projected from Stripe's state as re-read. A dispute (`PurchaseDispute` names exactly one of `orderId` or `commerceOrderId`) sets `CommerceOrder.disputeStatus`. While it is `open`, refunds and pickup hand-over are refused; `lost` ends the order's memberships and leaves nothing to hand over; `won` clears the status, and the dispute stays in history. Refunds made in the Stripe dashboard are totalled into `externalRefundedAmount`. A full one marks the order refunded and ends its memberships, which also settles a payment under review. A partial one shows as Payment review until staff mark it reviewed (`POST /api/orders/[orderId]/review` accepts a commerce order); a refund here then takes only the rest. A paid order that can't be filled is refunded in full automatically: compensation queues a system `RefundRequest` (no actor) under the usual fence, and the refund worker verifies the payment before sending it. A mismatch fails the request and leaves the order under review. Commerce has no per-order compensation mode, because automatic is what a ticketing platform does with an order it can't complete. Hosted activation still waits on PAY-002.

## Storage

`OrderLifecycleEvent` belongs to one order and has a unique `(orderId, sequence)` pair. Events store a typed event and source, optional staff actor, Stripe event/session references, email job reference, reason, before/after order and reservation statuses, and a small allowlisted `facts` object.

New orders start with `order_created`. Existing orders are not backfilled. Their first later transition receives `legacy_baseline`, and the organiser timeline warns that earlier history is incomplete.

The journal must not contain raw webhook bodies, checkout payloads, email addresses, provider credentials, invite tokens, or payment-card data.

## Recorded Transitions

- Checkout: order creation, Stripe session attachment, and checkout creation failure.
- Stripe reconciliation: ordinary failure, expiry, compensation required, successful fulfilment, and compensation recovery.
- Stale cleanup: reservation-backed and legacy pending-order expiry after lock-time revalidation.
- Staff actions: manual refund bookkeeping and manual ticket-email enqueue, attributed to the authenticated user.
- Email worker: automatic/manual enqueue, retry scheduling, provider acceptance, and terminal exhaustion.

Duplicate webhook delivery and idempotent actions do not append duplicate business transitions. Worker claim/reclaim operations are operational leases and are not journal events.

## Transition Rules

| Operation | Allowed state and result |
| --- | --- |
| Create checkout | Create a pending order and active reservation together. |
| Attach Stripe Session | Bind only an unbound pending order; an identical existing binding is a no-op. Never replace another Session. |
| Checkout creation failure | Only pending orders become failed; release an active reservation. Do not overwrite a concurrently completed order. |
| Complete paid checkout | Validate identity, metadata, amount, currency, reservation, and inventory before atomically confirming the reservation, decrementing inventory, issuing tickets, marking paid, and enqueuing email. |
| Paid but unfulfillable | Record failed plus compensation-review state, preserving payment evidence and the actual resulting reservation state. No tickets or automatic email job. |
| Late paid checkout | Expired or ordinarily failed orders enter compensation review rather than ordinary fulfilment. |
| Compensation recovery | Requires an active unexpired reservation, no manual refund, and successful fulfilment validation. Otherwise retain review state. |
| Expire checkout | Only pending orders expire; revalidate cleanup candidates after locking. Paid/failed/expired terminal states are not overwritten by expiry. |
| Manual refund | Existing visible paid/failed/expired orders may receive the bookkeeping flag once; order/payment status is unchanged. |
| Email delivery | The current processing-token holder may record retry, exhaustion, or provider acceptance. Stale claims cannot finalize. Payment state is unchanged. |

Ambiguous order identity never causes a transition. Repeated fulfilment of an already-paid order is a no-op, with integrity diagnostics if historical ticket counts disagree. All journal writes share the business transaction; a failed outbox insert rolls back fulfilment and its journal together.

## Transition Safety

Sensitive mutations reload state while holding database row locks and use conditional updates. Checkout locks the buyer, then the event and ticket type through `lib/events/inventory.ts`, and decides price, sale state and stock only under those locks (T12). Payment fulfilment locks the event and ticket type before the order and its reservation/outbox writes, and re-checks the event capacity once. Candidate discovery for stale cleanup happens outside the mutation transaction; every candidate is revalidated after its order lock is acquired.

Serializable checkout/reservation transactions retry bounded write conflicts, including raw-query PostgreSQL serialization/deadlock errors. Other database errors are not retried or suppressed.

Completed or expired Stripe sessions are ignored and alert with `payment_reconciliation_ambiguous_order` if metadata and `stripeSessionId` resolve to different local orders. A paid session arriving after an ordinary local failure enters durable compensation review and releases any active reservation. A manually refunded compensation order cannot be recovered by a later webhook retry.

Email claims receive a rotating `processingToken`. Final success/failure writes require the token, so a timed-out worker cannot overwrite a newer worker's result. Deployments introducing this token must drain old email workers before starting new workers.

## Operator View

The organisation order detail page shows a newest-first, 25-event timeline. It uses canonical event ownership for tenant isolation and the existing finance access guard. Older/newer links page by per-order sequence. Staff-attributed actions show the actor's display name; system events show their source.

The timeline is diagnostic history. It does not replace Stripe as payment-provider truth or turn `isManuallyRefunded` into a Stripe refund.

## Migration And Rollback

Migration `20260921010000_formal_payment_lifecycle` is additive: it creates the journal enums/table/indexes and adds nullable `EmailOutbox.processingToken`. The previous application release can run against the expanded schema because it ignores these additions. Before rollback, drain new email workers; an older worker does not understand processing-token fencing. Do not drop the journal during an application rollback.

## Validation

- Fresh migration and Prisma generation pass.
- 213 integration tests pass, including lifecycle ordering/idempotency, concurrent replay, tenant isolation, actor attribution, ambiguous identity, late-paid compensation, manual-refund recovery blocking, cleanup concurrency, and stale-worker fencing.
- Typecheck, production build, 15 browser/signed-webhook tests, 13 runner-safety tests, and the high-severity audit pass (no known vulnerabilities).
- Three consecutive runs on unchanged implementation revision `138c982` each passed all 15 browser/signed-webhook tests with cleanup: `p216-d057dd2d2efe4f3aa17a417c`, `p216-dbf811d56f13115a5084c9ba`, and `p216-049df43b5b5520a8597ff398`. They cover history pagination, desktop/mobile overflow, tenant denial, and concurrent/expiry transport. Desktop/mobile history screenshots were inspected.
- Final operations rehearsal `p217-ci-2931ec054f` passed backup/restore with a lifecycle event, outage probes, corrupt-archive quarantine, rollback compatibility, and migration-failure blocking.
- Independent review identified an incorrect compensation reservation after-state; the journal now reads the actual resulting reservation, with regression coverage. Follow-up review found no further correctness issues.
- Real Stripe campaign `p216-20010cf603f4e0763ec530c1` passed success, decline, manually attested cancellation, and forced expiry on API version `2026-03-25.dahlia`. It verified the new lifecycle sequence and real Stripe event correlation, destination-charge configuration, inventory, tickets, outbox, and buyer visibility. Listener HTTP 200 and app receipt were correlated. Stripe cleanup and run-owned resource cleanup passed.
- Real event evidence: success `evt_1UHz3tRuN9MD4SvFpGbf8zTn`, decline/expiry `evt_1UHz62RuN9MD4SvFMJeKqd9x`, cancellation/expiry `evt_1UHz8uRuN9MD4SvFZRbGqV1c`. This does not claim natural timeout or email-provider delivery.
- Implementation revision: `138c982`; merged through [PR #13](https://github.com/ENGGP/thunderstrux/pull/13) after five latest-head checks passed. Local evidence did not replace CI.
- See [[E2E and Staging Payments]] for the real Stripe acceptance procedure required after payment-path changes.

Related: [[Stripe Payments and Connect]], [[Email Delivery Implementation]], [[Database and Multi Tenancy]], [[Production Operations]].
