# Stripe Payments and Connect

## Design Principles

- Use Stripe Checkout hosted pages
- Do not fulfil from frontend redirects in production
- Fulfil production payments only from Stripe webhooks
- Keep a local `Order` row before redirecting to Stripe
- Create a temporary ticket reservation before redirecting to Stripe
- Reconcile amount, currency, and metadata before marking paid
- Reduce inventory and issue tickets atomically
- Mark paid-but-unfulfilled sessions for compensation review instead of silently treating them as ordinary failed checkouts
- Send ticket delivery email only after successful webhook fulfilment and ticket issuance

## Stripe Files

Core files:

- `app/api/payments/checkout/event/route.ts`
- `app/api/payments/webhook/route.ts`
- `app/api/public/events/[eventId]/route.ts`
- `app/tickets/page.tsx`
- `app/(dashboard)/dashboard/orders/page.tsx`
- `app/(dashboard)/dashboard/events/[eventId]/page.tsx`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/continue/route.ts`
- `app/api/stripe/connect/disconnect/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/webhook/route.ts`
- `lib/stripe/index.ts`
- `lib/stripe/connect.ts`
- `lib/stripe/fees.ts`
- `lib/payments/checkout-fulfilment-orchestrator.ts`
- `lib/payments/checkout-reconciliation.ts`
- `lib/email/ticket-delivery.ts`
- `lib/orders/stale-orders.ts`
- `lib/tickets/reservations.ts`
- `lib/events/event-analytics.ts`
- `components/settings/stripe-connect-settings.tsx`
- `components/events/public-ticket-purchase.tsx`

## Checkout Flow

```text
Public event page
  -> user selects ticket type + quantity
  -> POST /api/payments/checkout/event
  -> API validates auth, event, ticketType, quantity, amount, Stripe readiness
  -> serializable transaction creates local pending Order and active TicketReservation
  -> Stripe Checkout Session created with expires_at matching reservation expiry
  -> Checkout Session metadata includes orderId, eventId, organisationId, ticketTypeId, and quantity
  -> local Order is updated with stripeSessionId
  -> browser redirected to Stripe
  -> Stripe redirects back to /success?session_id={CHECKOUT_SESSION_ID}
```

Current implementation details:

- Currency is `aud`
- Payment flow uses destination charges
- Checkout is restricted to card payments so `checkout.session.completed` can require `payment_status = paid`
- Success URL includes `{CHECKOUT_SESSION_ID}` so non-production can run the dev-only reconciliation fallback when local webhook forwarding is missing
- Platform fee is calculated by `calculatePlatformFee(totalAmount)`
- Reservation window is 30 minutes because Stripe Checkout `expires_at` must be at least 30 minutes after session creation
- `TicketType.quantity` remains remaining inventory; reservations are subtracted from it during checkout availability checks

## Ticket Reservations

`TicketReservation` is a soft hold linked one-to-one with an `Order`.

Statuses:

- `active`: counts against checkout availability until `expiresAt`
- `confirmed`: paid webhook completed and tickets were issued
- `released`: checkout failed before a normal expiry path
- `expired`: local hold expired before payment completed

Availability:

```text
availableNow = TicketType.quantity - activeReservedQuantity
```

Checkout creates a reservation only after these preconditions pass:

- authenticated member account
- published event
- ticket type belongs to the event
- positive amount
- organisation Stripe account present and charges-enabled

If Stripe session creation fails after a reservation is created, the order is marked `failed` and the reservation is released.

## Required Conditions For Checkout

Checkout currently requires:

- authenticated member account
- published event
- ticket type that belongs to the event
- requested quantity within remaining inventory
- organisation Stripe account id present
- organisation charges enabled
- Stripe secret key configured

## Why `Stripe not connected` Happens

The checkout API returns this when:

- `stripeAccountId` is missing, or
- the connected account is not considered ready for charges

Current readiness helper:

```ts
isOrganisationStripeReady({
  stripeAccountId,
  stripeChargesEnabled
})
```

This means local failures are often caused by:

- onboarding never started
- Stripe platform profile/setup is incomplete
- onboarding incomplete
- Stripe keys missing
- Connect webhook/status refresh not updating local flags yet

## Stripe Connect Lifecycle

Stripe Connect management requires an `organisation` account that owns the organisation through `Organisation.accountUserId`.

Member accounts cannot manage Stripe Connect.

Thunderstrux uses strict internal lifecycle states:

```ts
type StripeConnectState =
  | "NOT_CONNECTED"
  | "PLATFORM_NOT_READY"
  | "CONNECTED_INCOMPLETE"
  | "RESTRICTED"
  | "READY"
  | "ERROR";
```

Mapping:

- `NOT_CONNECTED`: no `stripeAccountId`.
- `PLATFORM_NOT_READY`: Stripe platform profile/setup is incomplete and Express account creation is blocked before a connected account exists.
- `CONNECTED_INCOMPLETE`: `details_submitted = false`.
- `RESTRICTED`: details submitted but `charges_enabled = false`.
- `READY`: `charges_enabled = true`.
- `ERROR`: Stripe API failure or account mismatch.

Important:

- `Connected` means an account exists.
- `READY` means ticket payments can be accepted.
- `PLATFORM_NOT_READY` means the platform account cannot create Express accounts yet. It is not a connected-account state.
- Checkout only cares about payment readiness, not whether an account merely exists.

## Stripe Connect Service Layer

File:

```text
lib/stripe/connect.ts
```

Responsibilities:

- `createExpressAccount(orgId)`: resolves organisation server-side, creates Stripe Express account if needed, stores `stripeAccountId`, and sets `stripeAccountStatus`. If Stripe rejects account creation because platform setup is incomplete, stores `PLATFORM_NOT_READY` and throws `StripeConnectPlatformNotReadyError`.
- `createOnboardingLink(accountId, orgSlug)`: creates a Stripe-hosted onboarding link with valid `/dashboard/settings` return and refresh URLs.
- `getAccountStatus(accountId)`: retrieves the live Stripe account, maps it to a lifecycle state, and persists local readiness flags.
- `disconnectAccount(orgId)`: clears the local Stripe fields. It does not delete the Stripe account in Stripe.
- `notConnectedStatus()`: returns the canonical no-account status payload.
- `platformNotReadyStatus()`: returns the canonical platform setup block payload.
- `markAccountStatusError(...)`: stores `ERROR` when status refresh cannot retrieve the account.

The service layer does not decide whether the current user is allowed to perform an action. API routes perform auth and role checks before calling service functions.

## Stripe Connect Onboarding Flow

Flow:

```text
Settings page
  -> resolve current organisation account
  -> GET /api/stripe/connect/status?organisationId=...
  -> UI renders one of NOT_CONNECTED / PLATFORM_NOT_READY / CONNECTED_INCOMPLETE / RESTRICTED / READY / ERROR
  -> user clicks Connect Stripe Account, Continue onboarding, or Fix account
  -> POST /api/stripe/connect/onboard
  -> or POST /api/stripe/connect/continue
  -> API creates or reuses Express account
  -> API stores stripeAccountId and lifecycle status
  -> API returns account onboarding link
  -> user completes onboarding on Stripe
  -> user returns to settings
  -> GET /api/stripe/connect/status refreshes local readiness flags
```

If Stripe platform setup is incomplete:

```text
Settings page
  -> POST /api/stripe/connect/onboard
  -> stripe.accounts.create({ type: "express" }) fails
  -> service maps known platform setup errors to PLATFORM_NOT_READY
  -> API returns 409 with actionUrl
  -> UI shows Open Stripe Platform Settings and Retry after completion
```

Control buttons:

- `Connect Stripe Account`: shown for `NOT_CONNECTED`.
- `Open Stripe Platform Settings` and `Retry after completion`: shown for `PLATFORM_NOT_READY`.
- `Continue onboarding`: shown for `CONNECTED_INCOMPLETE`.
- `Fix account`: shown for `RESTRICTED`.
- `Retry status check`: shown for `ERROR`.
- `Open in Stripe dashboard`: shown when an account id is available.
- `Disconnect Stripe account`: shown when connected and also for `PLATFORM_NOT_READY` to clear the local blocked state.

Stripe connected-account dashboard link format:

```text
https://dashboard.stripe.com/test/connect/accounts/{accountId}
https://dashboard.stripe.com/connect/accounts/{accountId}
```

The code chooses test vs live from `STRIPE_SECRET_KEY`.

Platform profile link:

```text
https://dashboard.stripe.com/settings/connect/platform-profile
```

Disconnect is local-only. It clears Thunderstrux organisation Stripe fields but does not delete the Stripe connected account. After disconnect, clicking `Connect Stripe Account` creates a new account unless the old `acct_...` value is restored manually.

Manual reconnect to a previously disconnected account:

```sql
UPDATE "Organisation"
SET
  "stripeAccountId" = 'acct_old_account_id',
  "stripeAccountStatus" = 'CONNECTED_INCOMPLETE',
  "stripeChargesEnabled" = false,
  "stripePayoutsEnabled" = false,
  "stripeDetailsSubmitted" = false
WHERE slug = 'engineering-society';
```

Then open `/dashboard/settings` and click `Refresh status`.

## Stripe Connect Status

`GET /api/stripe/connect/status`

Behavior:

- verifies organisation account ownership
- loads organisation from Prisma
- if no connected account and no stored platform setup block, returns `state: NOT_CONNECTED`
- if no connected account and `stripeAccountStatus = PLATFORM_NOT_READY`, returns `state: PLATFORM_NOT_READY`
- if account exists, retrieves live account state from Stripe
- persists `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, `stripeAccountStatus`
- returns requirements fields from Stripe where available:
  - `currently_due`
  - `eventually_due`
  - `disabled_reason`

This endpoint is both a status reader and a local state synchronizer.

## Stripe Connect API Routes

`POST /api/stripe/connect/onboard`

- Creates or reuses an Express account.
- Returns a Stripe-hosted onboarding URL.
- If platform setup is incomplete, returns `409` with `state`, `message`, `actionRequired`, and `actionUrl`.

`POST /api/stripe/connect/continue`

- Requires an existing `stripeAccountId`.
- Returns a fresh Stripe-hosted onboarding URL.

`POST /api/stripe/connect/disconnect`

- Clears the local Stripe account fields.
- Returns canonical `NOT_CONNECTED` status.

`GET /api/stripe/connect/status?organisationId=...`

- Retrieves Stripe account status and maps it to the lifecycle state.

All Stripe Connect mutation routes require an organisation account that owns the target organisation.

## Stripe Connect Webhook

`POST /api/stripe/connect/webhook`

Handled event:

- `account.updated`

Responsibility:

- verify Stripe signature
- persist connected account status flags back to the organisation

## Payment Webhook

`POST /api/payments/webhook`

Handled event:

- `checkout.session.completed`
- `checkout.session.expired`

Reconciliation checks:

- Stripe signature valid
- raw request body is read with `request.text()`
- local order exists by `stripeSessionId`
- Stripe metadata `orderId` resolves the local order
- local order is still `pending`
- matching active, non-expired reservation exists
- session amount matches local total
- currency matches expected `aud`
- Stripe metadata matches local order
- metadata quantity matches local order quantity
- enough inventory still exists

On success:

- order marked `paid`
- `paidAt` timestamp stored
- ticket type inventory decremented
- reservation marked `confirmed`
- one `Ticket` row created per purchased ticket
- automatic ticket delivery email job enqueued inside the same database transaction as fulfilment
- automatic outbox worker success stores `Order.ticketEmailSentAt`
- worker failure stores `Order.ticketEmailLastError` and does not roll back fulfilment

On paid reconciliation failure before tickets are issued:

- order is stored as `status = failed`
- `requiresCompensationReview = true`
- `paidAt` is set or preserved because Stripe confirmed payment
- `fulfilmentFailedAt` and `fulfilmentFailureReason` are write-once diagnostics
- tickets are not issued
- automatic ticket email is not sent
- active reservations are released only for unsafe/unrecoverable mismatch paths; confirmed/released/expired reservations are not restored

If a later webhook retry naturally succeeds while an active unexpired reservation still exists:

- `requiresCompensationReview` is cleared
- `fulfilmentFailedAt` and `fulfilmentFailureReason` are preserved as historical diagnostics
- normal successful fulfilment continues: paid order, confirmed reservation, inventory decrement, tickets, and transactional automatic email enqueue

On ordinary non-paid reconciliation failure:

- order is marked `failed`
- `failedAt` timestamp is stored
- `failureReason` is stored for organiser debugging

Expired Checkout sessions:

- The webhook resolves the local order with `metadata.orderId` first.
- If `metadata.orderId` is missing or stale, it falls back to `stripeSessionId`.
- If the order is still `pending`, it is marked `expired`.
- Any active reservation for the order is marked `expired`.
- If the order is already `paid`, the webhook logs the idempotency path and does nothing.
- If the order is already `failed`, the webhook logs the idempotency path and does nothing.
- If the order is already `expired`, the webhook logs the idempotency path and does nothing.

Completed Checkout sessions with missing or expired local reservations:

- if Stripe confirms payment, the order becomes compensation-required failed state
- if Stripe did not confirm payment, normal expiry leaves the order `expired`
- tickets are not issued
- inventory is not decremented

Unhandled signed event types:

- return `200`
- log that the event was ignored
- do not attempt reconciliation

## Checkout Reconciliation Helper

Shared helper:

```text
lib/payments/checkout-reconciliation.ts
```

Responsibilities:

- Validate paid Checkout Session metadata, amount, currency, order status, and reservation state.
- Mark orders paid.
- Confirm reservations.
- Decrement remaining ticket inventory.
- Create ticket rows.
- Return a typed reconciliation result for the caller.
- Preserve idempotency for duplicate completed events.
- Preserve already-paid duplicate webhook behavior.
- Return `compensation_required` for paid-but-unfulfilled orders.

Side-effect orchestrator:

```text
lib/payments/checkout-fulfilment-orchestrator.ts
```

Responsibilities:

- Call the reconciliation helper.
- Preserve the shared call shape for webhook and non-production success fallback.
- Do not perform provider I/O.

Callers:

- `POST /api/payments/webhook` for production webhook fulfilment.
- `/success?session_id=...` only when `NODE_ENV !== "production"` as a local-dev fallback.

The dev fallback exists because Stripe redirects the browser to `/success` even when local webhook forwarding is not running. It does not replace webhook fulfilment in production.

## Ticket Delivery Email

Files:

```text
lib/email/ticket-delivery.ts
lib/email/ticket-email-outbox.ts
app/api/orders/[orderId]/resend/route.ts
scripts/process-email-outbox.ts
```

Provider:

- Uses a Resend-compatible HTTP API through `fetch`.
- No npm provider package is currently required.
- Runtime env values:
  - `RESEND_API_KEY`
  - `EMAIL_FROM`

Automatic delivery:

- Is enqueued inside successful paid checkout reconciliation after ticket issuance and before transaction commit.
- Uses a raw partial unique index so duplicate webhook delivery cannot enqueue duplicate automatic jobs for the same order.
- Provider I/O is performed by `pnpm email:outbox:process`, which processes one bounded batch and exits.
- Provider calls use `Idempotency-Key: ticket-email/{EmailOutbox.id}`.
- Worker success stores provider metadata on `EmailOutbox.providerMessageId` and `EmailOutbox.deliveredToProviderAt` when available.
- On worker success, sets `ticketEmailSentAt` and clears `ticketEmailLastError`.
- Email failure is non-blocking and must not roll back payment, inventory, reservation confirmation, or ticket issuance.

Manual resend:

- Route: `POST /api/orders/[orderId]/resend`.
- Organisation account and finance access required.
- Order must belong to the current organisation and have `status = paid`.
- Queues a repeatable manual outbox job even when `ticketEmailSentAt` is already set.
- Worker success sets `ticketEmailResentAt` and clears `ticketEmailLastError`.
- Worker failure sets `ticketEmailLastError`.

Current MVP email content:

- event name
- ticket type
- quantity
- order total
- issued ticket ids

Not included:

- attachments
- QR codes
- queues
- notification preferences
- full template system

## Stale Pending Orders

The app expires old active reservations and their pending orders through an idempotent server-side cleanup helper.

- active reservation with `expiresAt` in the past becomes `expired`
- matching pending order becomes `expired`
- pending order with an already-expired linked reservation becomes `expired`
- pending order with no reservation becomes `expired` only when older than 30 minutes
- normal expiry does not set `failureReason`

Design choice:

- Reservation expiry is the source of truth for abandoned checkout cleanup.
- Stripe/session creation failures still mark orders `failed` and release reservations.
- No background worker exists; cleanup runs from normal server-side app paths.

Current cleanup paths:

- starting checkout in `POST /api/payments/checkout/event`
- ticket-type reservation cleanup inside the checkout transaction
- buyer `/tickets`
- member `/dashboard`
- organisation `/dashboard`
- organiser orders through `/api/orders` and `/dashboard/orders`
- organiser event analytics through `/dashboard/events/[eventId]`

Public event reads are read-only and do not run stale pending order cleanup. Checkout remains authoritative for expiring stale reservations before new reservations are created.

Safety rules:

- Paid orders are never changed by stale cleanup.
- Failed orders are never changed by stale cleanup.
- Confirmed reservations are never changed by stale cleanup.
- Cleanup uses batched updates and is safe to run repeatedly.
- Normal organiser and member product views hide pending orders.
- `/dashboard/orders?includeSystem=true` exposes pending orders for debugging.
- Expired orders do not count in analytics because analytics queries include only `status = paid`.
- Expired reservations do not reduce availability because availability counts only active reservations with `expiresAt` in the future.

Transaction:

- Prisma transaction isolation level is `Serializable`

## Smoke Tests

`scripts/smoke-test.mjs` covers:

- organisation/member auth and dashboard access
- event create/edit and ticket editing
- member denial from management APIs
- Stripe-not-ready checkout creates no reservation
- active reservation reduces availability
- expired reservation settles the order as `expired`
- pending order with expired reservation becomes `expired`
- legacy pending order without reservation becomes `expired` after 30 minutes
- fresh reservationless pending order remains internal
- pending orders are hidden from default organiser orders and member tickets
- expired orders do not count as analytics revenue
- expired reservations do not reduce public checkout availability
- paid orders with confirmed reservations are preserved by cleanup
- failed orders are preserved by cleanup
- stale cleanup is idempotent
- reservation expiry window is exactly 30 minutes
- order `unitPrice` and `totalAmount` history remains unchanged
- organisation public event route redirects to organiser event view
- member access to organiser event view redirects away
- organisation accounts cannot create checkout sessions

## Integration Test Coverage

Payment-related integration suites run without live Stripe CLI delivery.

Current coverage:

- checkout creates pending `Order` plus active `TicketReservation`
- Stripe-not-ready checkout does not create a reservation
- member-only checkout and organisation-account checkout denial
- active reservations reduce availability
- expired reservations do not reduce availability
- completed Checkout reconciliation marks the order paid, confirms the reservation, creates tickets, and decrements inventory
- duplicate completed reconciliation is idempotent
- automatic ticket email is enqueued after successful fulfilment
- email outbox worker success/failure updates delivery tracking without rolling back fulfilment
- manual resend queues paid organiser-owned orders for worker delivery
- invalid metadata, amount, or currency does not mark an order paid
- paid-but-unfulfilled sessions become compensation-required failed orders
- duplicate compensation webhooks do not issue tickets, send email, or overwrite write-once diagnostics
- successful natural retry clears `requiresCompensationReview` and preserves diagnostics
- already-paid orders with ticket mismatches are logged but not mutated into compensation review
- compensation-required orders do not surface as valid member tickets
- reservation-backed pending orders and legacy reservationless pending orders expire through stale cleanup
- paid and failed orders are preserved by stale cleanup

The webhook integration tests call `lib/payments/checkout-reconciliation.ts` with mocked `Stripe.Checkout.Session` objects. They verify local reconciliation behavior, not Stripe CLI forwarding or raw webhook signature plumbing.

## Local Testing Limits

Full payment flow requires:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`
- webhook forwarding to the local app
- a test connected account that becomes charges-enabled

Without those:

- public discovery still works
- dashboard still works
- Stripe onboarding and payment completion will not complete end-to-end

## Local Stripe CLI Flow

Use Stripe test mode keys in `.env`.

Authenticate the CLI:

```bash
stripe login
```

Forward Checkout webhooks:

```bash
stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/payments/webhook
```

Set the printed secret as:

```text
STRIPE_WEBHOOK_SECRET=
```

The `STRIPE_WEBHOOK_SECRET` must be the `whsec_...` printed by this exact `stripe listen` process. A Dashboard webhook secret and a Stripe CLI forwarding secret are different.

After changing `.env`, recreate the app container. `docker compose restart app` does not reload env values:

```bash
docker compose up -d --force-recreate app
```

Verify the loaded prefix without printing the full secret:

```bash
docker compose exec app node -e "const s=process.env.STRIPE_WEBHOOK_SECRET; console.log(s ? s.slice(0,12)+'... len='+s.length : 'missing')"
```

Forward Connect webhooks in a second terminal if testing onboarding account updates:

```bash
stripe listen --forward-to localhost:3000/api/stripe/connect/webhook
```

Set the printed secret as:

```text
STRIPE_CONNECT_WEBHOOK_SECRET=
```

Minimum end-to-end local test:

1. Sign in as `engineering.org@example.com`.
2. Complete or simulate Stripe Connect readiness for `Engineering Society`.
3. Visit a published event detail page.
4. Buy a ticket through Stripe Checkout.
5. Confirm `/tickets` shows a paid order and ticket IDs.
6. Confirm `/dashboard/orders` shows the order.
7. Confirm ticket type inventory decreased.

Important: the real end-to-end test must start from the app checkout button. Generic `stripe trigger` events verify webhook plumbing, but they do not prove local order reconciliation because they usually do not contain this app's real `orderId`, `eventId`, `ticketTypeId`, and `quantity` metadata.

Webhook plumbing smoke tests:

```bash
stripe trigger checkout.session.completed
stripe trigger checkout.session.expired
```

Expected app logs for a real paid checkout:

- `Stripe checkout webhook signature verified`
- `Stripe checkout webhook received`
- `Stripe checkout order matched`
- `Stripe checkout reconciliation validation passed`
- `Stripe checkout inventory updated`
- `Stripe checkout tickets created`

Expired-session local test:

1. Start forwarding:

```bash
stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/payments/webhook
```

2. Create a real Checkout Session by starting checkout in the app.
3. Let the Checkout Session expire in Stripe test mode, or expire it from Stripe tooling/Dashboard where available.
4. Confirm the forwarded event type is `checkout.session.expired`.
5. Confirm the matching local order becomes `expired`.
6. Confirm normal expiry does not set `failureReason`.
7. Confirm the reservation becomes `expired`.
8. Confirm ticket inventory is unchanged.

Expected app logs for an expired checkout:

- `Stripe checkout expired webhook received`
- `Stripe checkout expired order matched`
- `Stripe checkout expired order marked expired`

Generic CLI trigger:

```bash
stripe trigger checkout.session.expired
```

The generic trigger verifies endpoint/signature plumbing, but it usually will not match a local order unless the payload metadata is customised to include a real local `orderId`.

Duplicate delivery test:

```bash
stripe events resend evt_... --webhook-endpoint=we_...
```

Use a real event id from the Stripe Dashboard or CLI output and the webhook endpoint id from Stripe Workbench. This tests duplicate delivery of the same Stripe event. Triggering `checkout.session.completed` twice creates separate test events and is not a duplicate-delivery test.

For a local-only CLI listener without a registered webhook endpoint, duplicate handling can still be validated at code level by replaying the same signed payload or by using a registered test webhook endpoint with Stripe Dashboard resend. The expected result is:

- order remains `paid`
- ticket count remains equal to `Order.quantity`
- ticket type inventory is decremented once only
- app logs show the paid/idempotent path rather than creating more tickets

Runtime debugging:

```bash
stripe logs tail
docker compose logs -f app
```

If webhook signature verification fails:

- confirm `STRIPE_WEBHOOK_SECRET` starts with `whsec_`
- confirm it came from the active `stripe listen` process
- recreate the app container after changing `.env`
- do not use a Dashboard endpoint secret for local CLI forwarding unless using that exact registered endpoint flow
- compare the container environment secret prefix with the Stripe CLI `whsec_...` prefix using the safe command above

Useful debug commands:

```bash
docker compose logs -f app
docker compose build app
```
