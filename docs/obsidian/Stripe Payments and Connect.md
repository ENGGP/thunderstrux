# Stripe Payments and Connect

## Design Principles

- Use Stripe Checkout hosted pages
- Do not fulfil from frontend redirects
- Fulfil only from Stripe webhooks
- Keep a local `Order` row before redirecting to Stripe
- Reconcile amount, currency, and metadata before marking paid
- Reduce inventory and issue tickets atomically

## Stripe Files

Core files:

- `app/api/payments/checkout/event/route.ts`
- `app/api/payments/webhook/route.ts`
- `app/tickets/page.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/orders/page.tsx`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/webhook/route.ts`
- `lib/stripe/index.ts`
- `lib/stripe/connect.ts`
- `lib/stripe/fees.ts`
- `components/settings/stripe-connect-settings.tsx`
- `components/events/public-ticket-purchase.tsx`

## Checkout Flow

```text
Public event page
  -> user selects ticket type + quantity
  -> POST /api/payments/checkout/event
  -> API validates auth, event, ticketType, quantity, inventory, Stripe readiness
  -> local pending Order created
  -> Stripe Checkout Session created
  -> Checkout Session metadata includes orderId, eventId, organisationId, ticketTypeId, and quantity
  -> local Order is updated with stripeSessionId
  -> browser redirected to Stripe
```

Current implementation details:

- Currency is `aud`
- Payment flow uses destination charges
- Checkout is restricted to card payments so `checkout.session.completed` can require `payment_status = paid`
- Platform fee is calculated by `calculatePlatformFee(totalAmount)`

## Required Conditions For Checkout

Checkout currently requires:

- authenticated user
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
- onboarding incomplete
- Stripe keys missing
- Connect webhook/status refresh not updating local flags yet

## Stripe Connect Onboarding

Allowed roles:

- `org_owner`
- `finance_manager`

Flow:

```text
Settings page
  -> resolve organisation by slug
  -> GET /api/stripe/connect/status?organisationId=...
  -> user clicks Connect Stripe Account
  -> POST /api/stripe/connect/onboard
  -> API creates Express account if none exists
  -> API stores stripeAccountId and onboarding_pending status
  -> API returns account onboarding link
  -> user completes onboarding on Stripe
```

## Stripe Connect Status

`GET /api/stripe/connect/status`

Behavior:

- verifies org membership
- loads organisation from Prisma
- if no connected account, returns `connected: false`
- if account exists, retrieves live account state from Stripe
- persists `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, `stripeAccountStatus`

This endpoint is both a status reader and a local state synchronizer.

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
- local order exists by `stripeSessionId`
- Stripe metadata `orderId` resolves the local order
- local order is still `pending`
- session amount matches local total
- currency matches expected `aud`
- Stripe metadata matches local order
- metadata quantity matches local order quantity
- enough inventory still exists

On success:

- order marked `paid`
- `paidAt` timestamp stored
- ticket type inventory decremented
- one `Ticket` row created per purchased ticket

On reconciliation failure:

- order marked `failed`
- `failedAt` timestamp stored
- `failureReason` stored for organiser debugging

Expired Checkout sessions:

- The webhook resolves the local order with `metadata.orderId` first.
- If `metadata.orderId` is missing or stale, it falls back to `stripeSessionId`.
- If the order is still `pending`, it is marked `failed`.
- If the order is already `paid`, the webhook logs the idempotency path and does nothing.
- If the order is already `failed`, the webhook logs the idempotency path and does nothing.
- No inventory is restored because Thunderstrux does not reserve inventory at checkout creation time. Inventory is decremented only after `checkout.session.completed` passes reconciliation.

## Stale Pending Orders

The app marks only pre-Checkout stale orders as failed:

- `status = pending`
- `stripeSessionId = null`
- older than 30 minutes

Design choice:

- These rows represent checkout creation that did not reach Stripe.
- Pending orders that already have a `stripeSessionId` are not expired by the local timer because a real Stripe Checkout Session may still complete and must be resolved by webhook delivery.
- Cleanup runs opportunistically when starting checkout, viewing `/tickets`, or viewing organiser orders.

Transaction:

- Prisma transaction isolation level is `Serializable`

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

Forward Connect webhooks in a second terminal if testing onboarding account updates:

```bash
stripe listen --forward-to localhost:3000/api/stripe/connect/webhook
```

Set the printed secret as:

```text
STRIPE_CONNECT_WEBHOOK_SECRET=
```

Minimum end-to-end local test:

1. Sign in as `user1@example.com`.
2. Complete or simulate Stripe Connect readiness for `Engineering Society`.
3. Visit a published event detail page.
4. Buy a ticket through Stripe Checkout.
5. Confirm `/tickets` shows a paid order and ticket IDs.
6. Confirm `/dashboard/engineering-society/orders` shows the order.
7. Confirm ticket type inventory decreased.

Important: the real end-to-end test must start from the app checkout button. Generic `stripe trigger` events verify webhook plumbing, but they do not prove local order reconciliation because they usually do not contain this app's real `orderId`, `eventId`, `ticketTypeId`, and `quantity` metadata.

Webhook plumbing smoke tests:

```bash
stripe trigger checkout.session.completed
stripe trigger checkout.session.expired
```

Expected app logs for a real paid checkout:

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
5. Confirm the matching local order becomes `failed`.
6. Confirm `failedAt` is set.
7. Confirm `failureReason` is `Stripe Checkout Session expired before payment`.
8. Confirm ticket inventory is unchanged.

Expected app logs for an expired checkout:

- `Stripe checkout expired webhook received`
- `Stripe checkout expired order matched`
- `Stripe checkout expired order marked failed`

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
- restart the Next.js container after changing `.env`
- do not use a Dashboard endpoint secret for local CLI forwarding unless using that exact registered endpoint flow

Useful debug commands:

```bash
docker compose logs -f app
docker compose exec app pnpm build
```
