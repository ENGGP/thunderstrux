---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle Refunds and Disputes]]", "[[Stripe Payments and Connect]]", "[[Email Delivery Implementation]]", "[[Database and Multi Tenancy]]", "[[Memberships and Merchandise]]"]
sources: [lib/payments/checkout-creation.ts, lib/payments/checkout-reconciliation.ts, lib/payments/checkout-attempts.ts, lib/payments/checkout-attempt-recovery.ts, lib/payments/checkout-binding.ts, lib/payments/free-ticket-issuance.ts, lib/payments/order-lifecycle.ts, lib/tickets/reservations.ts, lib/orders/stale-orders.ts, lib/commerce/checkout.ts, lib/commerce/reconciliation.ts, lib/purchases/projection.ts, lib/purchases/pending-checkout.ts]
---

# Payment Lifecycle

**Owns:** Thunderstrux-side purchase state for tickets and for memberships and merchandise: order, ticket, hold and checkout-attempt states, checkout and fulfilment, holds, expiry, buyer cancel, attempt recovery, purchase snapshots, the order history journal, display statuses, transaction rules and the payment workers. Refunds, compensation, disputes, reversals and free cancellation are in [[Payment Lifecycle Refunds and Disputes]].
**Read when:** changing checkout, fulfilment, order or ticket states, holds, the stale-order or recovery workers, or how an order's status is shown.
**Not here:** Stripe calls, Session parameters, webhook endpoints and Connect ([[Stripe Payments and Connect]]); ticket and refund emails ([[Email Delivery Implementation]]); membership and merchandise family rules ([[Memberships and Merchandise]]); models and indexes ([[Database and Multi Tenancy]]); what validity means at the door ([[Ticket Check-in Implementation]]).

## Code

| Concern | Where |
| --- | --- |
| Ticket checkout (paid and free) | `lib/payments/checkout-creation.ts`: `createEventCheckout`; free path `lib/payments/free-ticket-issuance.ts`: `issueFreeOrder` |
| Attempts and buyer polling | `lib/payments/checkout-attempts.ts`: `findCheckoutAttempt`, `checkoutAttemptStatus`, `readCheckoutAttempt` |
| Bind or fail a ticket order | `lib/payments/checkout-binding.ts`: `attachStripeSession`, `failPendingOrder` |
| Attempt recovery | `lib/payments/checkout-attempt-recovery.ts`: `processCheckoutAttemptRecoveryBatch` |
| Ticket fulfilment and expiry | `lib/payments/checkout-reconciliation.ts`: `reconcileCompletedCheckoutSession`, `reconcileExpiredCheckoutSession` |
| Holds, lock options | `lib/tickets/reservations.ts`; stock `lib/events/inventory.ts`: `lockEventInventory`, `readEventInventory`, `sellableQuantity` |
| Stale-order expiry | `lib/orders/stale-orders.ts`: `processStaleOrderCleanupBatch`, `expireStaleCommerceOrders` |
| Settlement and reconciliation sweep (PAY-024) | `lib/payments/checkout-settlement.ts`: `settleCheckoutSession`, `sweepPendingCheckouts`, `mayExpireAfterStripeCheck` |
| Commerce checkout, binding, webhook | `lib/commerce/checkout.ts`, `lib/commerce/binding.ts`, `lib/commerce/reconciliation.ts`, `lib/commerce/families.ts`, `lib/commerce/orders.ts` |
| Unpaid order state and buyer cancel | `lib/purchases/pending-checkout.ts`, `lib/purchases/pending-checkout-http.ts` |
| Display status | `lib/purchases/projection.ts`: `ticketOrderProjection`, `buyerPurchaseBadge` |
| Order history | `lib/payments/order-lifecycle.ts`: `lockOrder`, `appendOrderLifecycleEvent`; `lib/payments/order-lifecycle-history.ts` |
| Workers | `scripts/process-checkout-attempts.ts`, `scripts/process-stale-orders.ts`, `scripts/process-compensation-refunds.ts` |
| Tests | `tests/integration/webhook-reconciliation.test.ts`, `tests/integration/checkout-attempts.test.ts`, `tests/integration/checkout-attempt-recovery.test.ts`, `tests/integration/checkout-reservations.test.ts`, `tests/integration/inventory-locks.test.ts`, `tests/integration/free-tickets.test.ts`, `tests/integration/pending-checkout.test.ts`, `tests/integration/commerce-checkout.test.ts`, `tests/integration/payment-lifecycle.test.ts`, `tests/integration/purchase-snapshots.test.ts`, `tests/integration/checkout-reconciliation-sweep.test.ts` |

## States

**`Order.status`** (`OrderStatus`, shared with `CommerceOrder.status`):

| Status | Set by | Meaning |
| --- | --- | --- |
| `pending` | paid checkout | Unpaid; holds stock; may have a bound Session |
| `paid` | fulfilment, or a free order at creation | Fulfilled (`paidAt`, `fulfilledAt`). With `paymentKind = free` nothing was charged |
| `failed` | a definite Stripe refusal (`failureReason = stripe_error`); a paid Session the order can't match (`webhook_mismatch`); compensation (`requiresCompensationReview`, reason below) | Not fulfilled |
| `expired` | stale-order job, `checkout.session.expired`, buyer cancel | Unpaid and closed; `failureReason` is null |

Facts that sit beside the status: `requiresCompensationReview` (charged, not honoured), `refundStatus`, `disputeStatus`, `externalRefundedAmount` and `externalRefundReviewedAt`, `cancelledAt` (free only), `isManuallyRefunded` ([[Payment Lifecycle Refunds and Disputes]]). A refund or dispute never changes `status`.

**`Ticket.validity`** (`TicketValidity`), with `validityReason` and `validityChangedAt`:

| Validity | Reasons | Set by |
| --- | --- | --- |
| `active` | none | issuance; a staff restore after a won dispute |
| `refund_review` | `disputed` | a dispute opening |
| `void` | `refunded`, `refunded_outside`, `dispute_lost`, `cancelled` | a confirmed refund, a full outside refund or a staff "refunded outside Thunderstrux" mark, a lost dispute, a free cancellation |

Voiding keeps `checkedInAt` and never restores stock. Only `active` tickets appear in the wallet, the ticket email and the door list.

**`TicketReservation.status`** (`ReservationStatus`), one per paid ticket order:

| Status | Set by |
| --- | --- |
| `active` | checkout; counts against stock while `expiresAt` is in the future |
| `confirmed` | fulfilment |
| `released` | checkout failure, a fulfilment mismatch, compensation that releases the hold |
| `expired` | stale-order job, `checkout.session.expired`, buyer cancel, a payment that arrived after the hold lapsed |

**`CheckoutAttempt.state`** (`CheckoutAttemptState`), one per checkout of any family (`CheckoutFamily`), unique per actor, family, operation and client key:

| State | Meaning |
| --- | --- |
| `created` | Order and hold committed; Stripe not yet answered. `reconcileDueAt` is 2 minutes out (`attemptReconcileDelayMs`) |
| `provider_uncertain` | Stripe's answer was lost, or the Session couldn't be bound. Due for recovery |
| `provider_attached` | Session bound (`stripeSessionId`, `stripeSessionUrl`) |
| `failed` | Order failed, or the order had closed when its Session arrived (the Session is still recorded) |

The buyer sees `checkoutAttemptStatus`: `completed` when the order is paid, `failed` when the attempt or order failed or expired, `ready` with the URL when attached, otherwise `processing`. `lastOutcome` records why (for example `session_create_unknown`, `order_not_pending_at_attach`, `replay_window_passed`). Free attempts have no `reconcileDueAt`, so recovery never picks them up.

## Purchase snapshots

Checkout writes what was bought, and later edits never change it: `paymentKind` (`stripe` or `free`, required), `purchasedTicketTypeName`, `sellerName`, `sellerStripeAccountId`, `currency`, `feeAmount`, `feePolicyVersion`, `snapshotVersion` (`PURCHASE_SNAPSHOT_VERSION`), the buyer snapshot fields with `buyerIdentityCapturedAt` and `buyerIdentityProvenance` (`purchase`, `verified_guest` for guests, or `current_account_at_capture` when account closure filled in an older order), and for a member price `membershipGrantId` with `membershipEntitlementVersion`. These are the values the Session charges.

- Tickets are numbered by unique `(orderId, issueSequence)`, so a second issuance for an order fails instead of adding tickets.
- Legacy rows keep unknown values null. Readers show today's ticket name plus "(historical label unavailable)" (`purchasedTicketTypeLabel`) and never write it back. Migration `20261015010000_ticket_purchase_snapshots` backfilled only known facts.
- Free orders are stored `paid`, so **money queries filter `paymentKind`, never status alone**. Their order page says nothing was charged and hides refund and Stripe Session controls.
- Account closure keeps orders, tickets, attendance and history; a new signup never inherits them ([[Authentication and Dashboard Access]]).

## Ticket checkout

`createEventCheckout` takes one buyer: a verified member, or a guest's live checkout session (actor kind `guest`, actor id the session's grant). Its conditions and refusal codes: [[Stripe Payments and Connect#Required conditions for checkout]].

1. A known `(actor, idempotencyKey)` replays its attempt; the same key with another selection (`checkoutRequestHash` of event, ticket type, quantity, expected price) is 409 `idempotency_conflict`. A same-key request that won the race is found again after the buyer lock or a unique violation.
2. In one transaction (`runReservationTransaction`): lock the buyer, then `lockEventInventory`, then decide visibility, status, sale state, price (member price via an active `member_prices` grant), stock and Stripe readiness under those locks.
3. **Free price:** the buyer's `active` free tickets on the event plus this order stay within `maxTicketsPerOrder`, else 409 `free_limit_reached` with the number left as `value` (SEC-030), so one account can't claim a free event. Then `issueFreeOrder` writes a `paid` free order (`paidAt = fulfilledAt`, unit price, total and fee 0, no seller account), decrements stock once, numbers the tickets, appends `order_created` and `free_fulfilled`, creates the attempt and queues the automatic ticket email. No hold, no fee, no Stripe call; the answer is `fulfilled`.
4. **Paid price:** the SEC-005 hold cap is checked (its 409 `purchase_in_progress` names the buyer's own open order as the detail `id`, so the page links to it), then a `pending` order with its snapshots, an `active` hold, `order_created` and a `created` attempt are committed.
5. Outside the transaction: store the Session request on the attempt, then create the Session. Bind it with `attachStripeSession` (`stripe_session_attached`) and answer `redirect`.

A definite Stripe refusal fails the order, its attempt and the hold (`failPendingOrder`, `order_failed`). An uncertain error, or a Session that can't be bound, leaves the attempt `provider_uncertain` and answers 202 with the attempt id.

**Binding** converges: if the order already holds this Session (a webhook bound it first), the attempt is marked attached. If the order is no longer pending or holds another Session, the attempt fails but keeps the Session, so a payment on it still reaches compensation through the webhook, or alerts as PAY-010.

## Holds

| | Tickets | Memberships and merchandise |
| --- | --- | --- |
| Row | `TicketReservation` | the family's own holds, plus `CommerceOrder.expiresAt` |
| Ends | the hold (`Event.checkoutHoldMinutes`, 5 to 59, default 20) + `lateWebhookGraceMs` (5 min): `getReservationExpiry` | `CommerceOrder.expiresAt` = 20 min (`commerceHoldMinutes`); `heldByVariant` counts it to `lateWebhookGraceMs` past, as tickets do (PAY-020) |
| Expired by | stale-order job, expiry webhook, buyer cancel | the same |

- PAY-009, as Humanitix: the Session lives the hold or Stripe's minimum 30 minutes, the longer, + 60 s (`checkoutSessionExpiresAt`); the stale-order job closes it when the hold ends. The grace keeps seats only while Stripe can't be asked (DEF-033). Its `custom_text` names the hold's end; order pages count down (`HoldCountdown`).
- Stock: `sellableQuantity` = max(0, min(type remaining − that type's live holds, capacity − (tickets not void + all live holds))); the capacity term applies only when `Event.capacity` is set. `TicketType.quantity` is remaining stock and drops only at fulfilment.
- A lapsed hold stops counting at once, whether or not its order has expired yet. Checkout never expires other buyers' holds (DEF-032).
- One buyer's live paid holds on an event stay within `maxTicketsPerOrder` (10): members by account, guests by identity (SEC-005). Free tickets have the same cap on the tickets the buyer holds (SEC-030).

## Fulfilment

`reconcileCompletedCheckoutSession` runs from the signed webhook or the development success fallback, always through `reconcileCompletedCheckoutSessionWithSideEffects`, which passes the payment's destination ([[Stripe Payments and Connect#Webhooks]]). In order:

1. Find the order by `metadata.orderId` and by `stripeSessionId`. Two different orders: ignored, alert `payment_reconciliation_ambiguous_order`. None: ignored.
2. Order bound to a different Session: ignored (`session_mismatch`); if that Session is paid, alert `ticket_webhook_identity_mismatch` and a person refunds it in Stripe (PAY-010).
3. Lock the event and ticket type, then the order.
4. Already `paid`: no change (a ticket count that differs from `quantity` is logged for review).
5. Under compensation review: stays in review if manually refunded, if its compensation job has left `review_required`, or if no live hold remains; otherwise fulfilment is retried as a recovery.
6. Session complete but not paid yet: a delayed payment method still processing (checkout is card-only, so not today). The order and hold wait for `checkout.session.async_payment_succeeded` (applied as completed) or `_failed` (applied as expired) (PAY-030).
7. Paid, then each failure goes to compensation with its reason:

| Check | Reason |
| --- | --- |
| The order had expired | `expired_order_paid_after_payment` |
| Metadata missing (`orderId`, `eventId`, `organisationId`, `ticketTypeId`, positive `quantity`) | `missing_required_metadata_after_payment` |
| Session id, amount, currency `aud`, metadata against the order (organisation = the event's owner), or destination against `sellerStripeAccountId` (orders without a snapshot skip it) | `webhook_mismatch` |
| The order had failed ordinarily | `paid_session_received_after_order_failed` |
| A refund made in Stripe (`externalRefundedAmount`) or a dispute (`disputeStatus`) reached the order before this webhook | `refunded_or_disputed_before_fulfilment` |
| The society cancelled the event before the payment was confirmed (EVT-004) | `event_cancelled_before_fulfilment` |
| Hold lapsed while still pending, and the event sells (`saleState` open, not over) with room (`sellableQuantity`) | tickets issued: the hold is re-taken under the event lock, as a late merchandise payment is (PAY-031) |
| Hold expired or lapsed without room / missing | `reservation_expired_after_payment` / `reservation_missing_after_payment` |
| Hold quantity differs | `reservation_quantity_mismatch_after_payment` |
| Member-price membership revoked (read `FOR SHARE`) | `member_price_membership_revoked` |
| Event capacity below occupancy | `capacity_exceeded_after_payment` |
| Hold can't be confirmed / stock can't be decremented | `reservation_confirm_failed_after_payment` / `inventory_unavailable_after_payment` |

8. Success, in one transaction: order `paid` with `paidAt` and `fulfilledAt`, review cleared, hold `confirmed`, `TicketType.quantity` decremented, tickets `1..quantity` created with `organisationId` from the event, `payment_fulfilled` (or `compensation_recovered`, which also moves the compensation job `review_required` → `recovered`), and the automatic ticket email queued. A failed email insert rolls the whole fulfilment back.

**Compensation** (`markCompensationRequired`): the order becomes `failed` with `requiresCompensationReview`, keeps or sets `paidAt`, clears `fulfilledAt`, and writes `fulfilmentFailedAt` and `fulfilmentFailureReason` once. The first time it also creates the `CompensationRefundJob` from `compensationRefundModeSnapshot`, writes the audit row, queues the buyer's `payment-review/{orderId}` notice, appends `compensation_required` (and `compensation_refund_queued` when automatic), and after commit alerts `paid_but_unfulfilled_compensation_required`. A replay changes nothing. What happens next: [[Payment Lifecycle Refunds and Disputes]].

## Expiry and buyer cancel

| Path | Tickets | Commerce |
| --- | --- | --- |
| Stale-order job | An active hold past its hold's end (`expiresAt` − grace): Stripe closes an open page, then hold and order `expired` (no Session: at `expiresAt`); a pending order whose hold already expired; a pending order with no hold older than `stalePreCheckoutOrderMinutes` (30) | Pending Stripe orders past `expiresAt` → `expired` (`hold_expired`), holds released |

Either stale-order path asks Stripe about an order's Session before expiring it ([[#Reconciliation sweep (PAY-024)]]).
| `checkout.session.expired` | A `pending` order → `expired`, hold `expired`; paid, failed and expired orders unchanged; an order bound to another Session ignored | `failPendingCommerceOrder` (`checkout_expired`) |
| Buyer cancel | `reconcileExpiredCheckoutSession` with source `checkout` | `failPendingCommerceOrder` (`buyer_cancelled`) as `expired` |
| Event cancellation | After the cancellation commits, Stripe expires each open Session and `reconcileExpiredCheckoutSession` runs with source `staff_action` ([[Event Lifecycle#Cancelling]]) | Not event-owned |

The stale job locks each candidate and re-checks it before expiring; candidate discovery happens outside the transaction. `pnpm stale-orders:process -- --dry-run` counts without writing; `--limit=` takes 1 to 1000 (default 100).

**Buyer routes:**

| Route | Rule |
| --- | --- |
| `POST /api/purchases/tickets/[orderId]/cancel`, `POST /api/commerce/orders/[orderId]/cancel` | Trusted origin; the member who bought it, or a guest session that may open it (with the guest CSRF header); anyone else 404. Rate limit `checkout_create` per order. Retrieves the Session and expires it at Stripe if open. 200 `{ status: "cancelled" }`, or `{ status: "paid" }` if Stripe was paid meanwhile; 409 `not_pending` or `no_session` |
| `GET /api/purchases/tickets/[orderId]/status` | The buyer or a guest who may open it; else 404. `{ status }` from `ticketOrderProjection`, `no-store` |
| `GET /api/payments/checkout/attempts/[attemptId]` | The attempt's own actor; else 404. `checkoutAttemptStatus`, `no-store` |

`pendingCheckoutState` asks Stripe each time an unpaid order's page loads: `waiting` (Session open and held; offers the same payment page and Cancel order), `confirming` (Stripe has the payment, the webhook is due), or `ended`. Without Stripe's answer the hold decides and no payment page is offered. An unpaid order of a cancelled event is `ended` unless Stripe already has its payment. Lists show unpaid orders as Waiting for payment without asking Stripe. `cancelledByBuyer` tells a buyer's cancel apart from a lapsed hold by the `order_expired` source `checkout`.

## Reconciliation sweep (PAY-024)

The signed webhook is the main path; the sweep makes sure a lost one never strands a paid buyer. Both reach the same idempotent fulfilment through `settleCheckoutSession` (`lib/payments/checkout-settlement.ts`), Stripe's fulfil-checkout pattern: it routes a Session to the ticket reconciler or, by its `family` metadata, to the commerce one, and either may run any number of times, in any order, even at once.

- **Early check** (`sweepPendingCheckouts`, start of every `stale-orders` run): pending Stripe orders of every family with a bound Session, created over 2 minutes ago (`sweepFirstCheckAfterMs`) and not asked about in the last 2 minutes (`sweepRecheckEveryMs`, paced by `stripeCheckedAt`), least recently asked first, in pages of 25 per family until none are due or 45 seconds pass (`sweepRunBudgetMs`). Every look is stamped, failed ones too (PAY-029). The Session is read from Stripe: `complete` and paid is applied as completed, complete but unpaid is left as processing unless its payment failed (applied as expired) (PAY-030), `expired` is applied as expired, `open` is left, except that a ticket order's page is closed first when its event was cancelled (PAY-032).
- **Before expiry** (`mayExpireAfterStripeCheck`, inside `processStaleOrderCleanupBatch` and `expireStaleCommerceOrders`): an order with a Session is asked about first. Paid: fulfilled, not expired. Still open past its hold: the page is closed at Stripe (`checkout.sessions.expire`), then the order expires through the expired-Session path. Stripe has no such Session: it expires. Stripe can't be asked, the look failed here (a bug or database error: `checkout.sweep.settle_failed`, alert `checkout_settlement_failed`), or a delayed payment is processing: it stays pending with its hold and is counted in `stripeDeferred`; Stripe being unreachable alerts `checkout_reconciliation_unavailable`. A worker without a Stripe key expires as before outside production but never expires a Stripe order in production.
- **Alert:** every paid Session the sweep applies to a pending order raises `stripe_webhook_missed` (family, order, Session, outcome, minutes since checkout). In production that means webhooks are broken; see [[Production Operations]].
- **History:** sweep entries use source `reconciliation_sweep`; a late webhook afterwards finds the order already paid and changes nothing.
- **Pages** never confirm anything: order pages poll their status every 3 seconds for a minute, then every 15 seconds for ten more minutes under "Still confirming", and refresh when it changes (`components/purchases/payment-status-poller.tsx`).

## Checkout attempt recovery

The `checkout-recovery` worker (`processCheckoutAttemptRecoveryBatch`, tickets and commerce) claims due `created` or `provider_uncertain` attempts in `reconcileDueAt` order. It locks the order, then the attempt, and pushes `reconcileDueAt` out by `attemptRecoveryLeaseMs` (2 min) as a lease. It replays the stored request with the same key:

| Outcome | What happens |
| --- | --- |
| `attached` | Stripe returned the original Session; it is bound (source `checkout_recovery`) |
| `order_closed` | The order closed first; the Session is kept on the failed attempt and a payment on it goes to compensation |
| `provider_refused` | A definite refusal, or a Session without a URL: the order fails and its hold is released. A request Stripe never saw is refused because its stored expiry is too close |
| `provider_never_called` | No stored request: checkout stopped before Stripe, so the order fails without a call |
| `retry_scheduled` | Unknown again: hold kept, retried in `attemptRetryDelayMs` (2 min) |
| `replay_window_passed` | Older than `attemptReplayWindowMs` (24 h, Stripe's idempotency window): the attempt fails, alert `checkout_attempt_recovery_abandoned`; the order stays pending until the stale job expires it |

## Memberships and merchandise orders

`CommerceOrder` (`CommerceKind` `membership` or `merchandise`) with `CommerceOrderLine`s. Families plug in through `commerceFamilies` in `lib/commerce/families.ts` (both are registered): a selection schema, whether guests may buy (merchandise only), and `quote`, `lock`, `fulfil`, `release` hooks that run inside the caller's transaction. Lock order: buyer, then the family's resources (membership: member then society; merchandise: variants by ascending id), then the order.

- **Checkout** (`POST /api/payments/checkout/membership`, `/merchandise`): same replay and 409 rules as tickets (`commerceRequestHash`). The family quotes under its locks; a total other than `expectedTotal` is 409 `quote_changed`. A free total is created, fulfilled and `free_fulfilled` in one transaction. A paid total needs a ready society, commits the order (`expiresAt` 30 min, fee snapshot) and its attempt, then creates the Session outside and binds it (`attachCommerceSession`). A definite refusal fails the order; an unknown answer leaves the attempt `provider_uncertain` and answers processing.
- **Webhook** (`reconcileCommerceCheckoutSession`): the order is found by its Session or by `commerceOrderId`. An unknown family, two different matches, a family or society that disagrees, or another bound Session is ignored with `commerce_webhook_identity_mismatch`; a ticket order's Session carrying `family` alerts too. Under the locks, a paid Session is checked for amount, currency and destination, then the family fulfils it (`payment_fulfilled`). A mismatch (`amount_mismatch`, `currency_mismatch`, `destination_mismatch`, `paid_after_order_closed`, `refunded_or_disputed_before_fulfilment`) or a family that can't honour it becomes compensation: `failed` with `requiresCompensationReview` and `reviewReason`, holds released, `compensation_required`, the buyer's `payment-review/{id}` notice, an automatic full refund ([[Payment Lifecycle Refunds and Disputes]]) and alert `paid_but_unfulfilled_compensation_required`. A completed unpaid Session fails the order (`session_not_paid`).
- **History:** `CommerceLifecycleEvent` with `CommerceLifecycleEventType`: `order_created`, `stripe_session_attached`, `payment_fulfilled`, `free_fulfilled`, `order_failed`, `order_expired`, `compensation_required`, `free_cancelled`, `refund_requested`, `refund_pending`, `refunded`, `refund_failed`, `pickup_ready`, `pickup_collected`, `return_recorded`, `dispute_opened`, `dispute_closed`, `dispute_funds_recovered`, `external_refund_recorded`, `external_refund_reviewed`. Sources are `OrderLifecycleSource`.

## Order history

`OrderLifecycleEvent`, append-only, unique `(orderId, sequence)`. `appendOrderLifecycleEvent` is called with the order locked (or created in the same transaction), inside the business transaction. It stores the type, source, optional staff actor, `stripeEventId`, `stripeSessionId`, `emailOutboxId`, reason, before and after order and hold statuses, and an allowlisted `facts` object (`OrderLifecycleFacts`). Never raw webhook bodies, checkout payloads, email addresses, credentials, tokens or card data.

| Group | `OrderLifecycleEventType` values |
| --- | --- |
| Checkout and fulfilment | `order_created`, `stripe_session_attached`, `order_failed`, `order_expired`, `payment_fulfilled`, `free_fulfilled` |
| Compensation | `compensation_required`, `compensation_recovered`, `compensation_refund_queued`, `compensation_refund_started`, `compensation_refund_pending`, `compensation_refunded`, `compensation_refund_failed`, `manual_refund_marked` |
| Refunds | `refund_requested`, `refund_pending`, `refunded`, `refund_failed`, `external_refund_recorded`, `external_refund_reviewed` |
| Disputes | `dispute_opened`, `dispute_closed`, `dispute_resolved`, `dispute_funds_recovered` |
| Free cancellation | `free_cancelled` |
| Ticket email | `email_enqueued` (also an operator requeue), `email_retry_scheduled`, `email_provider_accepted`, `email_delivery_exhausted` |
| Legacy | `legacy_baseline` |

Sources (`OrderLifecycleSource`): `checkout`, `stripe_webhook`, `reconciliation_sweep` (PAY-024), `stale_cleanup`, `staff_action`, `email_worker`, `refund_worker`, `checkout_recovery`, `legacy`, `buyer_action` (a buyer releasing a free registration), and `development_fallback` (history only: the retired development success-page fallback).

- An order with no history gets `legacy_baseline` (source `legacy`) before its first new event, and the timeline warns that earlier history is incomplete.
- Duplicate deliveries and idempotent replays append nothing. Worker claims and leases are not history.
- **Operator view:** order detail shows the timeline newest first, `orderLifecyclePageSize` (25) a page, older and newer by sequence (`parseOrderLifecycleCursor`). It is tenant-scoped by the event's owner and labelled by `orderLifecycleLabel`. Staff events show the actor's name, system events their source. The timeline is diagnosis, not provider truth.

## Display status

`ticketOrderProjection` (`lib/purchases/projection.ts`) gives one status for ticket and commerce orders; the first match wins:

| Status | When |
| --- | --- |
| `cancelled` | `cancelledAt` set (a free order cancelled by staff) |
| `disputed` | `disputeStatus` `open` or `lost` |
| `refunded` | `refundStatus = refunded` |
| `refund-processing` | `refundStatus = processing` |
| `refunded-outside` / `refunded` | `isManuallyRefunded` (staff mark, or a confirmed compensation refund): the first on a `paid` order |
| `disputed` | `disputeStatus = won`, until staff restore the tickets |
| `review` | `requiresCompensationReview`, or an outside partial refund not yet reviewed |
| `processing` | `pending` |
| `paid` / `free` | `paid`, by `paymentKind` |
| `failed` / `expired` | the order status |

`buyerPurchaseBadge` words it for buyers: failed and expired "Didn't complete", processing "Waiting for payment", cancelled "Cancelled by the society", review "Payment issue" or "Partly refunded", a lost dispute "Refunded by your bank", a staff mark Refunded.

## Transaction rules

- Checkout, free registration, commerce checkout and ticket fulfilment run at READ COMMITTED with `maxWait` 10 s (`lockedPurchaseTransactionOptions`, DEF-032), retrying write conflicts up to `maxReservationTransactionAttempts` (3). Every decision is made after the row locks, so each statement sees what the buyer before committed. SERIALIZABLE took its snapshot before the lock wait and refused everyone queued behind another buyer. `tests/integration/inventory-locks.test.ts` sends 30 buyers at 20 tickets.
- Lock order: buyer (`User` or `GuestIdentity`), then `Event`, then its `TicketType`s (`lockEventInventory`), then `Order`. Commerce: buyer, family resources, then `CommerceOrder`.
- Staff paths lock with `lockOrder(tx, orderId, organisationId)`, which joins the event, so a client id never locks another society's order. The event's `organisationId` is the owner, never `Order.organisationId` ([[Database and Multi Tenancy#Tenant boundary]]).
- Workers find candidates outside the transaction and re-check each under its lock.

## Workers

Each runs under `lib/ops/worker.ts` (one run at a time, pausable, timeout, `worker.failed` and alert `worker_failed`) every minute ([[Production Operations#Workers and schedules]]).

| Worker | Command | Does |
| --- | --- | --- |
| `checkout-recovery` | `pnpm checkout-attempts:process` (`--limit=` 1 to 100, default 25) | Attempt recovery for every family; on error also alerts `checkout_attempt_recovery_failed` |
| `stale-orders` | `pnpm stale-orders:process` | Ticket order expiry (log `stale_orders.batch.processed`, metric `stale_orders_expired_total`; failure `stale_orders.batch.failed` and alert `stale_order_worker_failed`), commerce expiry (skipped on `--dry-run`), deleting expired staff MFA grants |
| `refunds` | `pnpm compensation-refunds:process` (`--limit=` 1 to 100, default 25) | Compensation refunds, order refunds, dispute reversals ([[Payment Lifecycle Refunds and Disputes]]), then payouts ([[Stripe Payments and Connect]]) |
| `email-outbox` | `pnpm email:outbox:process` | Ticket emails ([[Email Delivery Implementation]]) |

## Traps

- Fulfil only from the signed webhook path; the success page never marks an order paid.
- Don't sum money by `status = paid`: free orders are `paid` too.
- Don't authorise or scope from `Order.organisationId`; use `Event.organisationId`.
- A new transition needs a history event in the same transaction, and a label in `orderLifecycleLabel`.
- A new display state needs a place in `ticketOrderProjection`'s precedence and a buyer wording.
- Don't take locks out of order (buyer, event, ticket type, order), or concurrent checkouts deadlock.
- Expiry must re-check under the order lock: a webhook may have paid the order since the candidate was read.

## Failure and recovery

- **A paid buyer has no tickets:** look for `paid_but_unfulfilled_compensation_required`; the order reads Payment review and follows its compensation mode.
- **A checkout stuck processing:** the attempt is `provider_uncertain`; the recovery worker settles it within minutes, or alerts after 24 hours.
- **A paid Session the order isn't bound to** (`ticket_webhook_identity_mismatch`): refund it in Stripe; nothing was issued.
- **Rollback across `20260921010000_formal_payment_lifecycle`:** keep the history table, and drain email workers first, because older workers ignore `processingToken` fencing.

## Related

[[Payment Lifecycle Refunds and Disputes]] · [[Stripe Payments and Connect]] · [[Email Delivery Implementation]] · [[Memberships and Merchandise]] · [[Database and Multi Tenancy]] · [[Ticket Check-in Implementation]] · [[Glossary]]
