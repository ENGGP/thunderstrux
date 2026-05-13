# Email Delivery Implementation

Read with [[Stripe Payments and Connect]].

## Current Boundary

Ticket delivery email is a post-fulfilment side effect.

Core files:

- `lib/email/ticket-delivery.ts`
- `lib/email/ticket-email-outbox.ts`
- `lib/payments/checkout-fulfilment-orchestrator.ts`
- `lib/payments/checkout-reconciliation.ts`
- `app/api/orders/[orderId]/resend/route.ts`
- `scripts/process-email-outbox.ts`

## Automatic Delivery Flow

```text
Stripe checkout.session.completed
  -> checkout fulfilment orchestrator
  -> checkout reconciliation helper
  -> database transaction marks order paid, confirms reservation, decrements inventory, creates tickets, and creates the automatic EmailOutbox job
  -> reconciliation returns a typed result
  -> worker command processes due outbox jobs and calls the provider
```

Provider I/O does not run inside the reconciliation transaction or webhook request path.

## Rules

- Automatic email is enqueued inside the same transaction as successful paid fulfilment and ticket issuance.
- Duplicate paid reconciliation does not enqueue duplicate automatic jobs.
- Automatic jobs are unique per order through the raw partial index `EmailOutbox_automatic_order_unique`.
- Manual resend queues a separate manual job each time and is not unique per order.
- Worker email failure records `Order.ticketEmailLastError` and the job `lastError`.
- Email failure must not roll back payment, inventory, reservation confirmation, or ticket creation.
- Automatic outbox insertion failure rolls back paid fulfilment so a newly fulfilled paid order cannot commit without its automatic delivery job.
- Manual resend returns queued semantics from the organiser order endpoint.

## Worker

Run one bounded batch and exit:

```text
pnpm email:outbox:process
```

Worker behavior:

- Claims due `pending` jobs and stale `processing` jobs.
- Does not claim terminal `failed` jobs.
- Marks jobs `processing` during the batch.
- Retries with fixed backoff until `EMAIL_OUTBOX_MAX_ATTEMPTS`.
- Marks exhausted jobs `failed` for future explicit operator handling.
- Sends provider email with `Idempotency-Key: ticket-email/{EmailOutbox.id}`.
- Stores `providerMessageId` and `deliveredToProviderAt` after provider success and successful DB update.
- Updates `Order.ticketEmailSentAt` only after automatic provider success.
- Updates `Order.ticketEmailResentAt` only after manual provider success.

## Provider

The current provider integration uses the Resend-compatible HTTP API through `fetch`.

Runtime env:

```text
RESEND_API_KEY=
EMAIL_FROM=
```

Outbox tuning env:

```text
EMAIL_OUTBOX_BATCH_SIZE=25
EMAIL_OUTBOX_MAX_ATTEMPTS=5
EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS=600
```

No attachments, QR codes, notification preferences, or full template system exists in the MVP.
