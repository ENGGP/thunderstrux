---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Authentication and Dashboard Access]]", "[[Production Operations]]", "[[Memberships and Merchandise]]"]
sources: [lib/email/ticket-delivery.ts, lib/email/ticket-email-outbox.ts, lib/email/notification-outbox.ts, lib/email/notification-crypto.ts, lib/email/templates.ts, scripts/process-email-outbox.ts, scripts/process-notifications.ts, lib/events/event-changes.ts, lib/memberships/reminders.ts, lib/payments/compensation-notices.ts]
---

# Email Delivery Implementation

**Owns:** every email Thunderstrux sends: the ticket email and its `EmailOutbox`, general notifications and their `NotificationOutbox`, payload encryption, the templates, the notification matrix, the provider and mail capture, buyer contacts after account closure, staff invitation delivery, and failed-job recovery.
**Read when:** adding or changing an email, a notification trigger or key, the email or notification worker, or the provider setup.
**Not here:** when fulfilment, refunds or cancellations happen ([[Payment Lifecycle]], [[Payment Lifecycle Refunds and Disputes]]); token, guest-link and invitation rules ([[Authentication and Dashboard Access]]); scheduling and alert routing ([[Production Operations#Workers and schedules]]); env var details ([[Environment Variables]]).

## Code

| Concern | Where |
| --- | --- |
| Ticket email content and the provider call | `lib/email/ticket-delivery.ts`: `renderTicketEmail`, `sendTicketDeliveryEmailToProvider`, `sendWithResend` |
| Ticket outbox: enqueue, claim, send, requeue | `lib/email/ticket-email-outbox.ts` |
| Notifications: enqueue, claim, send, failed list, requeue | `lib/email/notification-outbox.ts` |
| Payload encryption | `lib/email/notification-crypto.ts` |
| Templates and payload schema | `lib/email/templates.ts`: `notificationTemplateSchema`, `renderNotification` |
| Ticket resend refusals | `lib/orders/order-detail.ts`: `enqueueOrganisationOrderTicketEmail` |
| Workers | `scripts/process-email-outbox.ts`, `scripts/process-notifications.ts` |
| Notification producers | `lib/events/event-changes.ts`, `lib/memberships/reminders.ts`, `lib/payments/compensation-notices.ts`, and the services in the matrix below |
| Failed notifications UI | `components/settings/failed-notifications.tsx` on `/dashboard/notifications` |
| Mail capture for isolated runs | `scripts/mail-capture.mjs` |
| Tests | `tests/integration/email-outbox.test.ts`, `tests/integration/notification-outbox.test.ts`, `tests/integration/notification-matrix.test.ts`, `tests/e2e/notifications.spec.ts` |

## Ticket email

One email per ticket order with every `active` ticket. Text and HTML, no attachments, no QR codes.

- **Sent:** queued in the fulfilment transaction of a paid order, or with a free registration ([[Payment Lifecycle#Fulfilment]]). A failed insert rolls the fulfilment back, so a paid order never commits without its job. Provider I/O happens only in the worker.
- **Content:** subject `Your tickets for <event>` (line breaks folded to a space). Body: greeting by the buyer's display or full name, event title, organiser (`sellerName` snapshot), date, location, ticket type (purchased name, or today's name plus "(historical label unavailable)"), quantity, unit price ("Free" at 0), total, order id, the active ticket ids, and a note that no QR scan is needed. Event date and place are read live.
- **Dates** are formatted in `Australia/Brisbane`, not the society's zone (DEF-047).
- **Wording:** every email says "Your payment is confirmed", including free registrations (DEF-050).
- **Guest orders** (a guest identity, no member) add an "Open your order" link: single use, 24 hours, minted on each send attempt (`purchaseLinkForEmail`). Only its digest is stored, so the worker needs `NEXT_PUBLIC_APP_URL` but no secret. Because each attempt carries a new link, the provider key adds the attempt number, and a lost provider answer can mean a second email with another valid link.
- **Recipient:** the order's buyer capture, else the live account (`retainedBuyerIdentity`). No recipient fails the job.
- **Manual resend:** `POST /api/orders/[orderId]/resend`, permission `orders:email_resend`, rate limit `order_resend` per order. The order must belong to the society and be visible; 400 unless it is `paid`, not disputed and not cancelled. It queues a new `manual` job each time, even after a successful send. It does not check `refundStatus`, so a refunded order's buyer can be told their void tickets "are ready" (DEF-050). It answers `{ queued: true }` and appends `email_enqueued` with audit `order.ticket_email_queued`.

## Ticket email outbox

`EmailOutbox`, one row per send intent, `mode` `automatic` or `manual` (`EmailOutboxMode`).

| `EmailOutboxStatus` | Meaning |
| --- | --- |
| `pending` | Due at `nextAttemptAt` |
| `processing` | Claimed (`processingStartedAt`, a fresh `processingToken`) |
| `sent` | Provider accepted it (`providerMessageId`, `deliveredToProviderAt`, `sentAt`) |
| `failed` | Attempts exhausted; never claimed again without a requeue |

- **One automatic job per order:** the insert is `ON CONFLICT DO NOTHING` on the partial unique index `EmailOutbox_automatic_order_unique`, so a replayed webhook queues nothing.
- **Worker** (`processTicketEmailOutboxBatch`, `pnpm email:outbox:process`, worker `email-outbox`): claims due `pending` jobs and `processing` jobs older than the processing timeout, `FOR UPDATE SKIP LOCKED`, in `nextAttemptAt` order. An automatic job for an order already marked sent is closed as sent without sending.
- **Send:** provider key `ticket-email/{EmailOutbox.id}` (plus `/attempt` for guest orders).
- **Success:** job `sent`, then `Order.ticketEmailSentAt` (automatic) or `ticketEmailResentAt` (manual), clears `ticketEmailLastError`, appends `email_provider_accepted`, metric `email_outbox_jobs_sent_total`.
- **Failure:** `attempts + 1`. Below the maximum the job goes back to `pending` after an escalating delay: 1 min, 5 min, 15 min, 1 h, then 6 h (`backoffSeconds`). It records `lastError` and `Order.ticketEmailLastError`, appends `email_retry_scheduled` (or `email_delivery_exhausted` at the maximum, status `failed`), logs `email_outbox.job.failed` and emits metric `email_outbox_jobs_failed_total`. Exhaustion also alerts `email_outbox_retry_exhausted`.
- **Fencing:** every finalising write requires the claim's `processingToken`, so a timed-out worker can't overwrite a newer claim. A failed local finalisation leaves the lease to be reclaimed and resent with the same key; it never proves the provider didn't send.
- Email failure never rolls back payment, stock, the hold or tickets.
- **Tuning** (positive integers, else the default): `EMAIL_OUTBOX_BATCH_SIZE` (25), `EMAIL_OUTBOX_MAX_ATTEMPTS` (5), `EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS` (600).
- Each batch logs `email_outbox.batch.processed` with `claimed`, `sent`, `retried`, `failed`, `skipped`.

## Notifications

`NotificationOutbox` carries every other email. `enqueueNotification(tx, …)` runs inside the business transaction; the worker calls the provider after commit.

- **Unique intent:** `(eventKey, recipient, templateVersion)`. A repeat insert does nothing, so each key below is sent at most once per recipient.
- **Privacy:** `business_notice` jobs are `business` and must name a society; every other template is `security` and must not. Security jobs never show to societies and have no tenant requeue.
- **Frozen content:** subject, text, HTML and sender (`EMAIL_FROM`) are rendered once at enqueue and encrypted with AES-256-GCM (`encryptNotification`). The key is `NOTIFICATION_ENCRYPTION_KEY`, 32 bytes in base64; the job id is the authenticated data, and decryption requires the full 16-byte tag. Readiness (`lib/ops/readiness.ts`) and every token-issuing path refuse a missing or invalid key. Hosted services read it through `NOTIFICATION_ENCRYPTION_KEY_FILE`.
- **Links** (`payload.link`) must be on the configured app origin, `https` (or `http` on localhost), without credentials.
- **Statuses** (a string with a database check): `pending`, `processing`, `sent`, `failed`, `cancelled`.
- **Claim:** due `pending` and `processing` older than 10 minutes, `FOR UPDATE SKIP LOCKED`, 25 a batch, with a rotating `processingToken`.
- **Before sending** the worker cancels a job (`lastError` in brackets) when:
  - a staff invite is no longer current: version, recipient, expiry, accepted or revoked, issuer authority, or an owner invite from a non-owner (`obsolete_invite`);
  - an `auth/` job has lost its token, or the token is consumed, invalidated, expired, for a disabled user, on an old `authVersion` or email, for another recipient or template, or a verification of an already verified email (`obsolete_token`);
  - a guest job has lost its grant, or the grant is consumed, revoked or expired, has the wrong purpose for the template, or no longer matches the identity's email (`obsolete_token`);
  - `expiresAt` has passed (`expired`).

  Producers also cancel superseded or consumed intents themselves (`superseded`, `consumed`). A provider call already in flight can't be recalled; its token still fails to redeem.
- **Send:** provider key `notification/{id}`. Failure retries after 1 min, 5 min, 15 min, 1 h or 6 h. It becomes `failed` at 5 attempts (`provider_unavailable`), or 23 hours after the first attempt (`provider_review_required`), because Resend keys last 24 hours and a later resend could duplicate. An unreadable payload fails at once (`invalid_payload`). Every move to `failed` alerts `notification_outbox_retry_exhausted` with the job id, template, privacy and reason, never the recipient or message.
- Provider acceptance (`acceptedAt`) is not inbox delivery.

## Templates

`notificationTemplateSchema` in `lib/email/templates.ts`. A `business_notice` may set its own `subject` (up to 200 characters, line breaks folded to a space so one organiser title can't fail a fan-out, SEC-003); the others have fixed subjects.

| Template | Sent for |
| --- | --- |
| `verify_account` | Signup and resend of email verification |
| `reset_password` | Password reset request (30-minute link) |
| `password_changed` | Password reset or change notice |
| `email_change_requested` | Email change: the link to the new address, and a notice to the old one |
| `email_changed` | Confirmed email change, to old and new addresses |
| `account_closed` | Account closure notice, to the former address |
| `staff_invite` | Staff invitation (versioned) |
| `business_notice` | Every society notice: receipts, refunds, cancellations, pickups, event changes, membership notices, payment review |
| `guest_access` | Guest email confirmation (30-minute link) |
| `guest_order_link` | Find your purchase, and a guest's merchandise receipt (24-hour link) |

## Notification worker

`pnpm notifications:process` (worker `notifications`), every run in order. A failed queueing step logs and sets a failing exit code, but sending still runs.

1. **Event changes** (`fanOutEventChanges`): at most 5 pages of 100 holders. An edit to an event's start, end or location while it has active tickets records an `EventChange` in the edit's transaction. After `eventChangeDelayMs` (5 minutes), the worker emails every paid, fulfilled order with an active ticket, page by page after the change's cursor; each page's emails and cursor commit together, so a stopped run resumes. A newer edit replaces a change nobody has been emailed about and keeps its original "was"; changing it back sends nothing; a started change always finishes. Times use the society's zone. Members' copies link to My tickets, guests' have no link. Failure log: `notification_outbox.event_changes.failed`.
2. **Membership notices** (`queueMembershipNotices`, at most 100): the renewal reminder 7 days before a membership ends (`renewalLeadMs`), if the member held it then, still wants reminders and has no later membership there; it names the society's next plan on sale. The expiry notice goes within a week after it ends, unless revoked or followed by a later membership; it states the last day in the society's zone. Neither extends a term. Failure log: `notification_outbox.membership_notices.failed`.
3. **Token cleanup** (`cleanUpExpiredTokens`, `lib/security/token-cleanup.ts`): deletes auth tokens, guest grants and staff MFA grants 30 days after they expire, 500 of each per run (log `security.tokens.cleaned`, failure `security.tokens.cleanup_failed`).
4. **Send** one batch (`notification_outbox.batch.processed` with `claimed`, `sent`, `retried`, `failed`, `skipped`, `cancelled`).

**Preferences:** one switch, Membership renewal reminders, on by default (`User.renewalReminders`, `PATCH /api/me/notification-preferences`). Receipts, refunds, cancellations, pickups, event changes, expiry and security mail have no switch, and there is no marketing mail.

## Notification matrix

| Trigger | Key | Template | Test |
| --- | --- | --- | --- |
| Signup, verification resend | `auth/{tokenId}` | `verify_account` | `tests/integration/account-verification.test.ts` |
| Password reset request | `auth/{tokenId}` | `reset_password` | `tests/integration/password-recovery.test.ts` |
| Password reset or change | `account-security/{eventId}` | `password_changed` | `tests/integration/password-recovery.test.ts` |
| Email change request | `auth/{tokenId}` (new address), `account-security/{eventId}` (old) | `email_change_requested` | `tests/integration/email-change.test.ts` |
| Email change confirmed | `account-security/{eventId}` | `email_changed` | `tests/integration/email-change.test.ts` |
| Account closed | `account-security/{eventId}` | `account_closed` | `tests/integration/account-closure.test.ts` |
| Staff invite, resend | `staff-invite/{inviteId}/{version}` | `staff_invite` | `tests/integration/staff-invites.test.ts` |
| Guest email confirmation | `guest/{grantId}` | `guest_access` | `tests/integration/guest-access.test.ts` |
| Find your purchase (one per paid order) | `guest/{grantId}` | `guest_order_link` | `tests/integration/guest-checkout.test.ts` |
| Paid or free ticket fulfilment | `EmailOutbox` automatic, one per order | ticket email | `tests/integration/email-outbox.test.ts`, `tests/integration/free-tickets.test.ts` |
| Manual ticket resend | `EmailOutbox` manual | ticket email | `tests/integration/orders-api.test.ts` |
| Membership fulfilment | `membership-receipt/{grantId}` | `business_notice` | `tests/integration/membership-grants.test.ts` |
| Membership renewal reminder, expiry | `membership-renewal/{grantId}`, `membership-expired/{grantId}` | `business_notice` | `tests/integration/notification-matrix.test.ts` |
| Membership revoked or cancelled | `membership-ended/{grantId}` | `business_notice` | `tests/integration/membership-revocation.test.ts` |
| Merchandise fulfilment | `merchandise-receipt/{orderId}` | `business_notice` (member); `guest_order_link` with a purchase grant (guest, no society) | `tests/integration/merchandise-sale.test.ts` |
| Pickup ready, collected | `merchandise-ready/{orderId}`, `merchandise-collected/{orderId}` | `business_notice` | `tests/integration/merchandise-pickups.test.ts` |
| Free merchandise order cancelled | `merchandise-cancelled/{orderId}` | `business_notice` | `tests/integration/merchandise-after-sale.test.ts` |
| Confirmed refund (ticket or commerce) | `refund/{requestId}` | `business_notice` | `tests/integration/order-refunds.test.ts`, `tests/integration/membership-refunds.test.ts` |
| Compensation refund confirmed (ticket) | `compensation-refund/{jobId}` | `business_notice` | `tests/integration/compensation-refunds.test.ts` |
| Free ticket registration cancelled | `cancellation/{orderId}` | `business_notice` | `tests/integration/free-cancellation.test.ts` |
| Payment review (ticket or commerce) | `payment-review/{orderId}` | `business_notice` | `tests/integration/webhook-reconciliation.test.ts`, `tests/integration/commerce-checkout.test.ts` |
| Material event change | `event-change/{eventId}/{version}/{orderId}` | `business_notice` | `tests/integration/notification-matrix.test.ts`, `tests/e2e/event-builder.spec.ts` |

- **Payment review** tells the buyer they have no tickets or items yet and what happens next: an automatic full refund, or the society's review. It carries no provider detail.
- The ticket email, event changes and refunds go to the order's buyer capture, so a later account email change doesn't redirect them.

## Providers

- **Resend** over HTTP (`sendWithResend`): `POST https://api.resend.com/emails` with `RESEND_API_KEY`, `EMAIL_FROM` (frozen per notification), the `Idempotency-Key` header and a 15-second timeout. A missing key or sender throws `TicketEmailConfigurationError`. Non-2xx fails with the status and body; the stored error is cut to 500 characters.
- **Mail capture:** isolated Docker runs set `THUNDERSTRUX_MAIL_CAPTURE_URL` to `http://mail-capture:8025/emails` (`scripts/mail-capture.mjs`, no published port, no disk). Only **notifications** go there, and only when `E2E_RUN_ID` is a `baseline-`, `browser-` or `staging-` run id; any other combination throws. Ticket emails always call Resend.
- **Capture-only key:** those runs use `RESEND_API_KEY=re_capture_only`, so ticket emails fail and retry there; staging sends ticket emails through Resend's test sink with a real test key ([[E2E and Staging Payments]]).
- Captured mail proves the queued intent and its text, not provider acceptance or inbox delivery.

## Buyer contacts and closed accounts

- Emails about an order go to its buyer capture (`buyerEmailSnapshot` and names), else the live account (`retainedBuyerIdentity`). Orders since purchase snapshots are captured at purchase.
- Closure captures the current email and name onto orders that have none (`buyerIdentityProvenance = current_account_at_capture`), then anonymises the account to a `closed.invalid` address, which is never a delivery address.
- Closure notices go to the former inbox. The account's auth tokens are deleted, so their queued emails cancel at send time (`obsolete_token`); old security intents stay as private records.
- Rolling back to workers that read only `User.email` needs ticket delivery and contact flows paused first, or they would send to anonymised addresses.

## Staff invitations

`staff_invite` is a private security notification, never listed or requeued by a society. The job links `staffInviteId` and `staffInviteVersion`; each issue of an invite has its own key. The raw token exists only in the encrypted payload, never in responses, audit or logs. The worker re-checks the invite before sending (see Notifications). Resend, revoke, acceptance, a verified-address email change, and issuer or recipient closure cancel obsolete queued or claimed messages. A delivered obsolete link still fails at acceptance.

## Failed jobs

| Route | Rule |
| --- | --- |
| `GET /api/notifications?cursor=` | `orders:email_resend`; the society's failed `business` jobs, 25 a page, newest first, `nextCursor` (shared timestamp cursor); a bad cursor is 400; `no-store` |
| `POST /api/notifications/[jobId]/requeue` | Trusted origin, `orders:email_resend`, rate limit `order_resend`, `reason` 8 to 500; 404 for another society's or a security job; 409 unless failed, not accepted, not expired and within 23 hours of its first attempt. Resets it to `pending`, audit `notification.requeued` |
| `POST /api/orders/[orderId]/email-jobs/[jobId]/requeue` | Trusted origin, `orders:email_resend`, rate limit `order_resend`, `reason` 8 to 500; 409 unless the job is `failed` and never accepted, the order is `paid`, and an automatic job's order isn't already marked sent. Resets attempts, audit `email_outbox.requeued`, `email_enqueued` with reason `operator_requeue` |

Both requeue routes read the body with raw `request.json()` (SEC-028). `/dashboard/notifications` (Email delivery) shows the failed list.

## Traps

- Queue emails inside the business transaction; never call the provider inside one.
- A new notification needs a stable, unique `eventKey` per recipient, or retries and replays send twice.
- Don't put secrets or provider responses in `lastError`, logs or alerts; notification errors are generic so notice text never leaves the process.
- A `business_notice` needs a society; anything else must not have one.
- The ticket email ignores the society's time zone (DEF-047) and calls free orders paid (DEF-050).

## Failure and recovery

- **`email_outbox_retry_exhausted` or `notification_outbox_retry_exhausted`:** fix the provider or environment, check the provider's idempotency record (a failed finalisation doesn't prove nothing was sent), then requeue. Past 23 hours a notification can't be requeued; the owning service must issue a new intent.
- **Backlog:** the operations monitor watches queue age ([[Production Operations#Logs, metrics and alerts]]). Without the scheduled worker, orders are still fulfilled but buyers get no email.
- **Lost notification key:** encrypted jobs can't be read (`invalid_payload`). Back the key up with database backups; an app rollback keeps the table and key and pauses the worker.
- **Rollback past `20261108010000_event_changes_and_preferences`:** older code records no `EventChange`, so its edits email nobody; an older worker ignores pending changes, which the new worker sends when it returns (late, not lost).
- **Ticket outbox checks:**

  ```sql
  SELECT count(*) FROM "EmailOutbox" WHERE "status" = 'pending' AND "nextAttemptAt" <= now();
  SELECT "id", "orderId", "mode", "attempts", "lastError" FROM "EmailOutbox" WHERE "status" = 'failed' ORDER BY "updatedAt" DESC;
  SELECT "id", "orderId" FROM "EmailOutbox" WHERE "status" = 'processing' AND "processingStartedAt" < now() - interval '10 minutes';
  ```

## Related

[[Payment Lifecycle]] · [[Payment Lifecycle Refunds and Disputes]] · [[Authentication and Dashboard Access]] · [[Memberships and Merchandise]] · [[Production Operations]] · [[E2E and Staging Payments]]
