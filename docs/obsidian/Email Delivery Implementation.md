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

Production should schedule this command every 1 minute through the deployment
platform scheduler, cron, or an equivalent one-shot job runner. If the worker is
not scheduled, paid orders can still be fulfilled and ticket rows can still be
issued, but buyers may not receive ticket delivery email.

Expected success output:

```json
{"level":"info","event":"email_outbox.batch.processed","claimed":1,"sent":1,"retried":0,"failed":0,"skipped":0}
{"level":"info","event":"email_outbox.worker.completed","claimed":1,"sent":1,"retried":0,"failed":0,"skipped":0}
```

Worker behavior:

- Claims due `pending` jobs and stale `processing` jobs.
- Assigns a new `processingToken` on every claim or reclaim; completion and failure writes require that token so stale workers cannot overwrite a newer claim.
- Does not claim terminal `failed` jobs.
- Marks jobs `processing` during the batch.
- Retries with fixed backoff until `EMAIL_OUTBOX_MAX_ATTEMPTS`.
- Marks exhausted jobs `failed` for future explicit operator handling.
- Sends provider email with `Idempotency-Key: ticket-email/{EmailOutbox.id}`.
- Stores `providerMessageId` and `deliveredToProviderAt` after provider success and successful DB update.
- Updates `Order.ticketEmailSentAt` only after automatic provider success.
- Updates `Order.ticketEmailResentAt` only after manual provider success.
- Appends business lifecycle events for enqueue, retry, provider acceptance, and terminal exhaustion. Claim/reclaim leases are not lifecycle events.

When deploying the processing-token migration, stop and drain old workers before starting workers from the new release. Older workers do not enforce token fencing. See [[Payment Lifecycle]].

Operational checks:

```sql
-- Pending due jobs
SELECT count(*)
FROM "EmailOutbox"
WHERE "status" = 'pending'
  AND "nextAttemptAt" <= now();

-- Terminal failed jobs
SELECT "id", "orderId", "mode", "attempts", "lastError", "updatedAt"
FROM "EmailOutbox"
WHERE "status" = 'failed'
ORDER BY "updatedAt" DESC;

-- Stale processing jobs older than the default processing timeout
SELECT "id", "orderId", "mode", "processingStartedAt"
FROM "EmailOutbox"
WHERE "status" = 'processing'
  AND "processingStartedAt" < now() - interval '10 minutes';
```

When failed jobs exist, operators should fix the provider or environment issue,
identify affected paid orders from `orderId`, and contact buyers manually if
needed. An authenticated staff member with email-resend permission can requeue
a terminal failed job through `POST /api/orders/<order-id>/email-jobs/<job-id>/requeue`
with a review reason and the normal trusted-origin/session CSRF headers. The
operation is audited and appends an order lifecycle event. Check the provider's
idempotency record first: a failed local finalization does not prove that the
provider never accepted the email. See [[Production Readiness Verification 2026-09-22]].

Operational events:

- `email_outbox.batch.processed`: emitted after each bounded worker batch.
- `email_outbox.job.failed`: emitted when a job fails and is either retried or marked terminal failed.
- `email_outbox_retry_exhausted`: alert emitted when a job becomes terminal failed.
- `email_outbox_jobs_sent_total`: console/log-derived metric emitted for provider success.
- `email_outbox_jobs_failed_total`: console/log-derived metric emitted for provider failure.

These metrics are log-derived only for MVP. Production must route the JSON logs to an external log aggregator and alert on any `email_outbox_retry_exhausted`.

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

Ticket delivery has no attachments or QR codes. General notifications use the separate versioned system below.

## General Notification Foundation (T02)

`NotificationOutbox` is independent of ticket `EmailOutbox`. Application transactions insert unique event/recipient/template-version intents using `enqueueNotification`; provider I/O occurs after commit. Payloads (including raw security links) are AES-256-GCM encrypted with a separate 32-byte base64 `NOTIFICATION_ENCRYPTION_KEY`, authenticated to the job ID. Sender/rendered HTML/text are frozen at enqueue. Security jobs have no tenant and are never returned to organisation operators. Escaped templates reject foreign links. No raw provider responses or tokens enter notification diagnostics.

Run `pnpm notifications:process` once per minute using `notification-worker`. Batches are bounded to 25; claims use SKIP LOCKED and rotating ten-minute leases. Five attempts use bounded backoff. Expired jobs cancel; T03 cancels superseded token intents and workers independently suppress invalid/consumed/disabled/expired/wrong-version/email tokens. Provider acceptance is recorded separately from inbox delivery. Retry uses `notification/<job-id>` and the immutable payload; after 23 hours from first attempt, uncertain delivery requires provider review instead of automatic resend (Resend keys last 24 hours). Retry exhaustion emits `notification_outbox_retry_exhausted`. Monitor failed/stale/due counts and oldest due age; any exhaustion or a backlog older than five minutes needs investigation.

`/dashboard/notifications` and GET `/api/notifications` show up to 25 failed business jobs to live `orders:email_resend` staff. POST `/api/notifications/<job-id>/requeue` requires origin/CSRF, rate limit, an 8 to 500 character review reason and live tenant authority; it writes an audit. Security/foreign jobs are concealed. Same-key requeue outside the safe provider window is refused; verify provider truth and let the owning service issue a new intent. Account-security jobs have no tenant requeue interface.

Rollout: back up the notification key independently, deploy the additive migration once before app/worker rollout, and inject the key through `NOTIFICATION_ENCRYPTION_KEY_FILE` on hosted services. Readiness rejects a missing/invalid key. Retain the key with encrypted database backups; restore verification includes notification records. Application rollback retains the table/key and pauses the new worker; older code cannot produce/process these jobs. Hosted scheduling, domain/inbox delivery and alert receipt remain external activation evidence. Docker capture is confined to isolated p216 runs and never publishes a port.

T04a adds 30-minute reset links and atomic password-change security notices. Token jobs verify template/purpose, recipient/account, current email/version, expiry and disabled state before delivery. Reset/change cancels pending or claimed obsolete intents; a provider send already in flight may still arrive, but its token cannot redeem after commit. Security events and notice intent commit with the password/version change, so enqueue failure rolls the whole mutation back.
