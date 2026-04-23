# Stripe Payments and Connect

## Payment Design Principles

- Use Stripe Checkout hosted pages
- Do not trust frontend success redirects
- Fulfil only from webhooks
- Keep local order records for reconciliation
- Keep ticket issuance atomic with inventory reduction
- Route payments to connected accounts using one Connect pattern

## Checkout Flow

Files:

- `app/api/payments/checkout/event/route.ts`
- `lib/validators/payments.ts`
- `lib/stripe/fees.ts`
- `lib/stripe/connect.ts`

Flow:

```text
Public page sends eventId, ticketTypeId, quantity
  -> checkout API validates body with Zod
  -> API fetches published event
  -> API verifies ticket type belongs to event
  -> API derives organisationId from event
  -> API verifies organisation Stripe readiness
  -> API calculates total amount
  -> API calculates platform fee
  -> API creates Stripe Checkout Session
  -> API creates local pending Order
  -> API returns Checkout URL
```

The frontend never sends trusted organisation data for checkout.

## Stripe Connect Destination Charge Pattern

Checkout uses destination charges.

Stripe Checkout Session includes:

```ts
payment_intent_data: {
  application_fee_amount,
  on_behalf_of: organisation.stripeAccountId,
  transfer_data: {
    destination: organisation.stripeAccountId
  }
}
```

Important:

- The Checkout Session is created on the platform account.
- The code does not pass a separate `stripeAccount` request option.
- This avoids mixing Connect patterns.

## Platform Fee

File:

- `lib/stripe/fees.ts`

Current fee:

- 10 percent of `totalAmount`
- Rounded to integer cents
- Capped so it cannot exceed `totalAmount`

## Local Order Creation

After creating the Checkout Session, the API creates an `Order` with:

- `organisationId`
- `eventId`
- `ticketTypeId`
- `quantity`
- `unitPrice`
- `totalAmount`
- `stripeSessionId`
- `status = pending`

This data is later used for webhook reconciliation.

## Payment Webhook

File:

- `app/api/payments/webhook/route.ts`

Handles:

- `checkout.session.completed`

Webhook responsibilities:

- Verify Stripe webhook signature
- Find the local order by `stripeSessionId`
- Exit idempotently if already paid
- Verify the order is pending
- Verify session amount matches order total
- Verify currency
- Verify metadata matches local order fields
- Use local order quantity as source of truth
- Check remaining ticket inventory
- Reduce inventory
- Create one `Ticket` row per purchased ticket
- Mark order paid

Frontend success page does not mark orders as paid.

## Inventory Control

Inventory is reduced in the webhook transaction.

This protects against:

- User closing checkout early
- Fake success redirects
- Frontend tampering
- Duplicate webhook delivery
- Concurrent purchases overselling the same ticket type

## Stripe Connect Onboarding

Files:

- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/webhook/route.ts`
- `lib/stripe/connect.ts`
- `components/settings/stripe-connect-settings.tsx`

Flow:

```text
Dashboard settings page
  -> user clicks Connect Stripe Account
  -> POST /api/stripe/connect/onboard
  -> API checks authenticated membership and role
  -> API creates Express account
  -> API stores stripeAccountId
  -> API returns Stripe onboarding URL
```

Only these organisation roles can start onboarding:

- `org_owner`
- `finance_manager`

## Stripe Readiness

Helper:

- `isOrganisationStripeReady(organisation)`

Returns true only when:

- `stripeAccountId` exists
- `stripeChargesEnabled === true`

Checkout requires readiness before creating a payment session.

## Connect Status Persistence

Status endpoint and Connect webhook persist:

- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `stripeAccountStatus`

This means checkout can use local readiness flags instead of calling Stripe on every request.
