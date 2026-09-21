# Payment Lifecycle

P3.19 adds an append-only business-event journal around the existing `Order`, `TicketReservation`, `Ticket`, refund, and `EmailOutbox` fields. Existing status enums and API response contracts remain authoritative for current state; `OrderLifecycleEvent` explains how that state was reached.

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

Sensitive mutations reload state while holding database row locks and use conditional updates. Payment fulfilment locks inventory before the order and its reservation/outbox writes. Candidate discovery for stale cleanup happens outside the mutation transaction; every candidate is revalidated after its order lock is acquired.

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
- Implementation revision: `138c982`. Merge requires green latest-head PR checks and maintainer review; local evidence does not replace CI.
- See [[E2E and Staging Payments]] for the real Stripe acceptance procedure required after payment-path changes.

Related: [[Stripe Payments and Connect]], [[Email Delivery Implementation]], [[Database and Multi Tenancy]], [[Production Operations]].
