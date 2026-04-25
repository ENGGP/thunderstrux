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

Forward Checkout webhooks:

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
```

Set the printed secret as:

```text
STRIPE_WEBHOOK_SECRET=
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

1. Sign in as `user1@example.com`.
2. Complete or simulate Stripe Connect readiness for `Engineering Society`.
3. Visit a published event detail page.
4. Buy a ticket through Stripe Checkout.
5. Confirm `/tickets` shows a paid order and ticket IDs.
6. Confirm `/dashboard/engineering-society/orders` shows the order.
7. Confirm ticket type inventory decreased.
