# Stripe Payments and Connect

## Design Principles

- Use Stripe Checkout hosted pages.
- Do not trust frontend success redirects.
- Fulfil orders only from Stripe webhooks.
- Keep local `Order` records for reconciliation.
- Reduce inventory and issue tickets atomically.
- Resolve organisation context server-side.

## Checkout Flow

Files:

- `app/api/payments/checkout/event/route.ts`
- `components/events/public-ticket-purchase.tsx`
- `lib/stripe/connect.ts`
- `lib/stripe/fees.ts`

Flow:

```text
Public event page submits eventId, ticketTypeId, quantity
  -> API requires authenticated session
  -> API validates published event
  -> API verifies ticket type belongs to event
  -> API resolves organisation from event
  -> API verifies remaining inventory
  -> API verifies Stripe Connect readiness
  -> API creates Stripe Checkout Session
  -> API creates local pending Order
  -> frontend redirects to Stripe Checkout
```

The frontend does not send trusted organisation data.

## Required Conditions For Checkout

Checkout requires:

- Signed-in user.
- Published event.
- Valid ticket type belonging to the event.
- Requested quantity within available inventory.
- Organisation Stripe Connect account ready for charges.
- Stripe environment variables configured.

## Why `Stripe not connected` Happens

The checkout API returns this when the organisation is not Stripe-ready.

Stripe-ready means:

- `stripeAccountId` exists.
- `stripeChargesEnabled === true`.

Common local causes:

- Organisation has not started Connect onboarding.
- Onboarding was started but not completed.
- Stripe webhook/status refresh has not updated local readiness flags.
- Local Stripe keys or webhook secrets are missing.

## Stripe Connect Onboarding

Files:

- `app/(dashboard)/dashboard/[orgSlug]/settings/page.tsx`
- `components/settings/stripe-connect-settings.tsx`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/webhook/route.ts`

Flow:

```text
Settings page
  -> resolves organisation by slug
  -> checks GET /api/stripe/connect/status
  -> user clicks Connect Stripe Account
  -> POST /api/stripe/connect/onboard
  -> API creates Express account
  -> API stores stripeAccountId
  -> API returns onboarding URL
  -> user completes onboarding on Stripe
  -> Connect status endpoint/webhook persists readiness flags
```

Allowed onboarding roles:

- `org_owner`
- `finance_manager`

## Destination Charge Pattern

Checkout uses destination charges:

```ts
payment_intent_data: {
  application_fee_amount,
  on_behalf_of: organisation.stripeAccountId,
  transfer_data: {
    destination: organisation.stripeAccountId
  }
}
```

The Checkout Session is created on the platform account. The code does not pass a separate `stripeAccount` request option.

## Platform Fee

File:

```text
lib/stripe/fees.ts
```

Current fee:

- 10 percent of `totalAmount`.
- Rounded to integer cents.
- Capped so it cannot exceed `totalAmount`.

## Payment Webhook

File:

```text
app/api/payments/webhook/route.ts
```

Handles:

- `checkout.session.completed`

Responsibilities:

- Verify Stripe signature.
- Find local order by `stripeSessionId`.
- Exit idempotently if already paid.
- Verify amount, currency, and metadata.
- Check remaining inventory.
- Reduce inventory.
- Create one `Ticket` row per purchased ticket.
- Mark order paid.

## Local Testing Limitations

Full payment testing requires:

- Stripe test secret key.
- Stripe Checkout webhook secret.
- Stripe Connect webhook secret.
- Webhook forwarding to the local app.
- A test connected account that can become charges-enabled.

Without these, public event discovery still works, but checkout will stop at Stripe readiness or Stripe API calls.

