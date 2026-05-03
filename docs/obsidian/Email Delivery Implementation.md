# Email Delivery Implementation

Read with [[Stripe Payments and Connect]].

## Current Boundary

Ticket delivery email is a post-fulfilment side effect.

Core files:

- `lib/email/ticket-delivery.ts`
- `lib/payments/checkout-fulfilment-orchestrator.ts`
- `lib/payments/checkout-reconciliation.ts`
- `app/api/orders/[orderId]/resend/route.ts`

## Automatic Delivery Flow

```text
Stripe checkout.session.completed
  -> checkout fulfilment orchestrator
  -> checkout reconciliation helper
  -> database transaction marks order paid, confirms reservation, decrements inventory, and creates tickets
  -> reconciliation returns a typed result
  -> orchestrator sends automatic ticket email only for a newly fulfilled order
```

Email sending does not run inside the reconciliation transaction.

## Rules

- Automatic email is attempted only after successful paid fulfilment and ticket issuance.
- Duplicate paid reconciliation does not send automatic email again.
- Email failure records `Order.ticketEmailLastError`.
- Email failure must not roll back payment, inventory, reservation confirmation, or ticket creation.
- Manual resend still calls `sendTicketDeliveryEmail(..., mode="manual")` from the organiser order endpoint.

## Provider

The current provider integration uses the Resend-compatible HTTP API through `fetch`.

Runtime env:

```text
RESEND_API_KEY=
EMAIL_FROM=
```

No queue, attachments, QR codes, notification preferences, or full template system exists in the MVP.
