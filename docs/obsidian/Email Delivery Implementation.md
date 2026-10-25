---
status: living
last-reviewed: 2026-10-25
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Production Operations]]"]
sources: [lib/email/ticket-email-outbox.ts, lib/email/notification-outbox.ts, lib/events/event-changes.ts, lib/memberships/reminders.ts, lib/payments/compensation-notices.ts, scripts/process-notifications.mjs]
---

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
- `scripts/process-email-outbox.mjs`

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

T04b email-change intents bind the new recipient and email-change template to the token while retaining the original account email/version fence. Requests alert the old inbox; confirmed changes atomically notify old and new inboxes. Cancelled/expired/superseded links cannot redeem even if an already in-flight provider request arrives. No old-inbox approval or email-based reassignment of historical records occurs.

T16a guest links use the `guest_access` template and carry `guestAccessGrantId`. Before sending, the worker cancels the job as `obsolete_token` if the grant is consumed, revoked or expired, if the recipient is no longer the identity's email, or if a `guest/` job has lost its grant. A newer request for the same address cancels the older link's queued email as `superseded`; redemption cancels it as `consumed`.

T16b adds `guest_order_link` (Find your purchase, one email per purchase); the worker checks that its template matches the grant's purpose. A guest's merchandise receipt is also a `guest_order_link` job (event key `merchandise-receipt/{orderId}`, no tenant) carrying a purchase grant for that order, queued in the fulfilment transaction; a member's receipt stays a society `business_notice`. A guest order's ticket email (`EmailOutbox`, recipient the buyer snapshot) also carries an "Open your order" link minted on each send attempt; only its digest is stored, so the email worker needs `NEXT_PUBLIC_APP_URL` but no secret. Because a retry carries a new link, a guest email's provider idempotency key adds the attempt number, so a lost provider response can mean a second email with another valid link.

## Closed Account Contacts

Ticket delivery resolves an immutable Order buyer capture before the live User relation. Orders created since T10 are captured at purchase, so a later profile or email change does not redirect their receipts. The ticket email names the purchased ticket type and seller from the order snapshot (legacy orders show today's ticket name with "(historical label unavailable)") and lists only active tickets; the event date and place stay live. Closure captures current-account email/name only for orders without a capture; provenance and date are retained, without claiming legacy purchase-time identity. Closure notices use the former inbox and the private general notification outbox. Token jobs are cancelled and token rows removed; old security intents remain private retained records. Rollback to workers that only read User.email requires pausing ticket delivery/contact flows to avoid sending to anonymised closed.invalid addresses. Docker capture/row restore is not real inbox delivery or recovered-key decryption evidence.

## Staff invitation delivery

`staff_invite` is a private security notification, encrypted with the notification key and excluded from business notification listing/recovery. The outbox links `staffInviteId` and `staffInviteVersion`; each issuance version has an immutable event key. Raw tokens exist only in the encrypted payload and synthetic test decryption helpers, never API responses, audit or logs. Before sending, the worker checks the live version, recipient, expiry, accepted/revoked state and verified non-disabled issuer with owner/admin authority (owner for owner grants). Resend/revoke, acceptance, verified-address email change and issuer/recipient closure cancel obsolete queued/claimed messages. A provider call already in flight cannot be recalled; any delivered obsolete link still fails acceptance. Reliable worker scheduling and real inbox/provider qualification remain activation gates.

## Email completion (T30)

`scripts/process-notifications.mjs` now does three things each run, in order: fans out due event changes (at most five pages of 100 holders), queues due membership reminders and expiry notices (at most 100), then sends one bounded batch. A failed queueing step is logged (`notification_outbox.event_changes.failed`, `notification_outbox.membership_notices.failed`) and retried next run; it never blocks sending. The schedule is unchanged: every minute.

- **Material event changes.** An edit that changes an event's start, end or location while it has active tickets records an `EventChange` in the edit's own transaction (old and new values, the new event version). After a five-minute pause the worker emails every paid, fulfilled order with an active ticket, in order id pages after the change's `cursor`; the page's emails and the cursor commit together, so a stopped run resumes and a replayed page queues nothing (key `event-change/{eventId}/{version}/{orderId}`, one per purchase and recipient). The recipient is the order's buyer capture, so a later account email change does not redirect it. A newer edit replaces a change nobody has been emailed about yet and keeps its original "was"; changing it back sends nothing; a change the worker has started always finishes. Members' copies link to My tickets; a guest's copy has no link. Only valid holders are emailed: refunded, void, pending and unrelated people never are. The edit page's published-event notice tells organisers.
- **Renewal reminder (optional).** Seven days before a membership ends, if the member held it then, still wants reminders and has no later membership with that society. Key `membership-renewal/{grantId}`, so the minute-by-minute catch-up sends it once and never extends a term. It names the society's next plan on sale, if any, and links to My memberships.
- **Expiry notice.** Once a membership has ended (within the past week), unless it was revoked (that sent its own notice) or a later membership follows. Key `membership-expired/{grantId}`. The message states the actual last day in the society's zone, whenever the worker runs.
- **Payment review.** When a ticket or commerce order first goes to payment review (paid but not honoured), the buyer is told no tickets or items are theirs yet and what happens next (an automatic full refund, or the society's review). Key `payment-review/{orderId}`; no provider detail.
- **Compensation refund.** When Stripe confirms a ticket order's compensation refund (worker poll, webhook or a verified staff confirmation), the buyer gets the amount. Key `compensation-refund/{jobId}`.
- **Exhausted jobs.** Every move of a notification job to `failed` (provider unavailable after five attempts, past the safe retry window, or an unreadable payload) emits `notification_outbox_retry_exhausted` with the job id, template, privacy and reason, never the recipient or message. Society jobs then show on Email delivery for requeue; account-security jobs stay operator-only.
- **Subjects.** A society notice may carry its own subject (`Change to <event>`, `Your <plan> membership ends soon`); line breaks in organiser text fold to a space, so one society's event title can't fail a shared fan-out (SEC-003), and other templates keep their fixed subjects. The ticket email folds its subject the same way.
- **Preferences.** Account settings › Notifications (members) has one switch, Membership renewal reminders, on by default (`User.renewalReminders`, `PATCH /api/me/notification-preferences`). Receipts, refunds, cancellations, pickups, event changes, expiry and security mail have no switch. There is no engagement or marketing mail to switch.

### Notification matrix (readiness plan §5)

Each row has a test where its owning service is tested; T30 added the rows marked new.

| Trigger | Key | Test |
| --- | --- | --- |
| Signup/verification resend | `auth/{tokenId}` | `account-verification.test.ts`, `notification-outbox.test.ts` |
| Password reset request | `auth/{tokenId}` | `password-recovery.test.ts` |
| Password/security change | `account-security/{eventId}` | `password-recovery.test.ts`, `email-change.test.ts`, `account-closure.test.ts` |
| Staff invite/resend | `staff-invite/{inviteId}/{version}` | `staff-invites.test.ts` |
| Paid/free ticket fulfilment | `EmailOutbox` automatic per order | `email-outbox.test.ts`, `free-tickets.test.ts`, `webhook-reconciliation.test.ts` |
| Manual ticket resend | `EmailOutbox` manual job | `email-outbox.test.ts`, `orders-api.test.ts` |
| Paid/free membership fulfilment | `membership-receipt/{grantId}` | `membership-grants.test.ts` |
| Membership nearing expiry (new) | `membership-renewal/{grantId}` | `notification-matrix.test.ts` |
| Membership expiry (new) / revocation | `membership-expired/{grantId}`, `membership-ended/{grantId}` | `notification-matrix.test.ts`, `membership-revocation.test.ts` |
| Merchandise fulfilment | `merchandise-receipt/{orderId}` | `merchandise-sale.test.ts` |
| Ready/collected merchandise | `merchandise-{ready,collected}/{orderId}` | `merchandise-pickups.test.ts` |
| Confirmed refund | `refund/{requestId}`, `compensation-refund/{jobId}` (new) | `order-refunds.test.ts`, `membership-refunds.test.ts`, `merchandise-after-sale.test.ts`, `compensation-refunds.test.ts` |
| Free purchase cancelled | `cancellation/{orderId}`, `membership-ended/{grantId}` | `free-cancellation.test.ts`, `membership-revocation.test.ts`, `merchandise-after-sale.test.ts` |
| Paid-but-unfulfilled (new buyer notice) | `payment-review/{orderId}` plus `paid_but_unfulfilled_compensation_required` | `webhook-reconciliation.test.ts`, `commerce-checkout.test.ts` |
| Material event schedule/location change (new) | `event-change/{eventId}/{version}/{orderId}` | `notification-matrix.test.ts`, browser `event-builder.spec.ts` |
| Exhausted job | `notification_outbox_retry_exhausted`, `email_outbox_retry_exhausted` | `notification-outbox.test.ts`, `email-outbox.test.ts` |

Evidence boundary: integration tests prove the queued intent and its text; the browser campaign proves a change email reaches Docker mail capture with its subject. Neither is provider acceptance or inbox delivery (H03).

Rollout: the additive migration (`event_changes_and_preferences`) runs before the app and worker. Edits made by older app code record no change, so nobody is emailed for them; that is the only gap. Rolling the app back leaves the table and column unused; an older worker ignores pending changes, which the new worker sends when it returns (after the pause, so late rather than lost).
