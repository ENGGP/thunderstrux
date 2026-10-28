---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[Production Operations]]", "[[Payment Lifecycle Refunds and Disputes]]", "[[Stripe Payments and Connect]]", "[[Troubleshooting]]"]
sources: [lib/ops/alerts.ts, lib/ops/logger.ts, lib/ops/metrics.ts, lib/ops/monitor.ts, scripts/mail-capture.mjs]
---

# Production Operations Alerts

**Owns:** structured logs, metrics, alert delivery, the operations monitor and its queue thresholds, and every alert with its operator action.
**Read when:** adding an alert, metric or log event, or answering an alert.
**Not here:** workers, schedules and the runner ([[Production Operations]]); refund, dispute and compensation states ([[Payment Lifecycle Refunds and Disputes]]); symptoms to fixes ([[Troubleshooting]]).

**Logs** (`lib/ops/logger.ts`): one JSON line per event on stdout/stderr: `level`, `event`, `timestamp`, `service: "thunderstrux"`, `environment` (`NODE_ENV`), then the context. Keys containing `authorization`, `cookie`, `password`, `token`, `secret`, `apikey`, `api_key`, `rawbody`, `body`, `payload`, `html` are replaced with `[REDACTED]`; errors become `{name, message}`. Logging never throws. There is no metrics backend or dashboard: aggregation is the host's job.

Key log events: `api.request_failed` (unmapped route error: `operation`, `method`, `errorName`), `stripe.webhook.received` (with `apiVersion`), `stripe.webhook.signature_failed`, `stripe.webhook.configuration_error` (webhook 503), `stripe.webhook.mode_mismatch`, `stripe.webhook.version_mismatch`, `stripe.webhook.reconciliation_failed`, `stripe.webhook.ignored`, `stripe.webhook.compensation_replay_mismatch`, `checkout.sweep.*`, `trusted_origin.rejected`, `rate_limit.rejected`, `rate_limit.backend_unavailable`, the `worker.*` and `schedule.*` events above, `ops.alert` (every alert), `ops.alert.delivery_failed`, `ops.metric` (every metric).

**Metrics** (`emitMetric` writes an `ops.metric` log line with `metricName`, `metricValue`, `tags`): `worker.run`, `worker.duration_ms`, `worker.seconds_since_success`, `queue.backlog`, `queue.oldest_age_seconds`, `queue.stuck`, `checkout_attempts_recovered_total`, `checkout_session_create_failures_total`, `free_registrations_total`, `email_outbox_jobs_sent_total`, `email_outbox_jobs_failed_total`, `stale_orders_expired_total`, `checkout_sweep_settled_total`, `stripe_webhook_signature_failures_total`.

**Alert delivery** (`emitOperationalAlert`): always an `ops.alert` error log. With `ALERT_WEBHOOK_URL` set (hosted: `ALERT_WEBHOOK_URL_FILE`, a required secret for app, migration and every worker) it is also POSTed as JSON `{event, environment, timestamp, dedupeKey, details}`, redacted like logs, 3 s timeout, best effort: a failing receiver logs `ops.alert.delivery_failed` and never fails the caller. `dedupeKey` is the payload's own (monitor and worker alerts set `<alert>:<queue|worker>`) or the alert name. `stripe_webhook_signature_failure` reaches the receiver at most once per 5 minutes per process, with `details.suppressed` counting those held back; every one is still logged (SEC-020). Point it at a receiver that groups by `dedupeKey`. Locally `scripts/mail-capture.mjs` receives alerts (`POST /alerts`, `GET /alerts`).

**Monitor** (`runOperationsMonitor`, every minute): per queue it emits `queue.backlog`, `queue.oldest_age_seconds`, `queue.stuck`; per job (not itself) `worker.seconds_since_success`. It also alerts `purchase_dispute_evidence_due` for each unanswered dispute due within 72 hours (`readDisputesDue`, `DISPUTE_DUE_WITHIN_SECONDS`), keyed per dispute and repeated every 6 hours (`DISPUTE_ALERT_REPEAT_SECONDS`). A firing alert repeats every 30 minutes (`ALERT_REPEAT_SECONDS`); one that clears and returns alerts at once. State lives in the `monitor` lease row's `alertState`. If the monitor itself stops nothing alerts: the hosted uptime check must also watch for missing `worker.seconds_since_success` or a missed heartbeat (OPS-002).

| Queue (`queueThresholds`) | Counts | Alerts when oldest exceeds |
| --- | --- | --- |
| `email_outbox`, `notification_outbox` | pending since created; processing > 15 min is stuck | 15 min |
| `checkout_attempts` | `provider_uncertain` attempts | 30 min |
| `compensation_refunds` | `auto_queued`/`refund_pending`; `auto_processing` > 15 min stuck | 60 min |
| `order_refunds` | `pending`/`uncertain` refund requests | 60 min |
| `dispute_reversals` | `pending`/`uncertain` reversals, aged from dispute close | 60 min |
| `ticket_holds` | active reservations past `expiresAt` | 10 min |
| `commerce_checkouts` | pending commerce orders past `expiresAt` | 30 min |

Every alert (`OperationalAlertName`). The engineering on-call owns all of them; refund and dispute alerts also go to whoever handles society support.

| Alert | Raised when (where) | Operator action |
| --- | --- | --- |
| `worker_failed` | a run throws (`runWorker`) | Read the run's logs; a provider outage clears on a later run. If it repeats: pause the job, fix, resume. |
| `worker_timed_out` | a run passes `WORKER_TIMEOUT_SECONDS` | As above; look for a slow provider or an oversized batch. |
| `worker_stale` | a job not paused hasn't succeeded for 10 min (`WORKER_STALE_AFTER_SECONDS`) | Check its schedule is running (`pnpm ops:workers -- status`, service logs). |
| `queue_backlog_high` | a queue's oldest item passes its threshold (`details.queue`) | email/notifications: check Resend and the retry-exhausted alerts. checkout attempts: check checkout-recovery and Stripe. compensation/order refunds: check the refunds job and Stripe; never refund by hand while one is uncertain (it may go twice). dispute reversals: check the transfer's reversals in Stripe; never reverse by hand while uncertain. ticket holds/commerce checkouts: check the stale-orders job (held stock stays unavailable). |
| `queue_processing_stuck` | an item processing over 15 min | Lease recovery should requeue it; if not, inspect the item before requeueing. |
| `paid_but_unfulfilled_compensation_required` | a paid ticket or commerce Session couldn't be fulfilled and a compensation job was created (`lib/payments/checkout-reconciliation.ts`, `lib/commerce/reconciliation.ts`) | `automatic_full`: confirm the refunds worker refunds it. `manual_review`: a finance manager decides on the order. Either way confirm the buyer was told. |
| `email_outbox_retry_exhausted` | a ticket email job failed for the last time | Check Resend; the order's Email delivery lets staff requeue it. |
| `notification_outbox_retry_exhausted` | a notification moved to failed (job, template, privacy, reason only) | Check Resend and the reason; society jobs show on Email delivery for requeue. |
| `checkout_session_creation_failure` | ticket checkout couldn't start a Session (`provider_uncertain`, `missing_redirect_url`, `session_attach_failed`, `stripe_configuration_error`, `stripe_error`) or a commerce create was uncertain | Uncertain ones are replayed by checkout-recovery. A spike or configuration reason: check the Stripe key and Stripe status. |
| `payment_reconciliation_ambiguous_order` | a Session id and its metadata name different ticket orders; nothing applied | Find both orders and the payment in Stripe; settle by hand. |
| `stripe_webhook_signature_failure` | a payments or Connect webhook has no or a bad signature (cooled, SEC-020) | Occasional: noise. Sustained after a deploy: the signing secret doesn't match its endpoint. |
| `stripe_webhook_mode_mismatch` | a test-mode event reached a live key or the reverse; ignored | An endpoint or key from the wrong mode; fix the Workbench endpoint. |
| `stripe_webhook_version_mismatch` | an event's `api_version` isn't the pin; still handled | Replace the endpoint on the pinned version, move its secret, retire the old one. |
| `stale_order_worker_failed` | the stale ticket-order batch threw (also `worker_failed`) | As `worker_failed` for `stale-orders`. |
| `stripe_webhook_missed` | the sweep confirmed a paid checkout no webhook delivered (PAY-024) | Buyer served; find why the webhook failed under Stripe's Event deliveries. |
| `checkout_reconciliation_unavailable` | the sweep couldn't ask Stripe; those orders stay pending | Check Stripe and the worker's key; retried each minute. |
| `checkout_attempt_recovery_failed` | the recovery batch threw (also `worker_failed`) | As `worker_failed`; check Stripe reachability. |
| `checkout_attempt_recovery_abandoned` | an uncertain attempt passed the 24 h replay window (`attemptReplayWindowMs`) and was closed | Look in Stripe for a Session under it; if paid, the webhook still fulfils; otherwise nothing to do. |
| `refund_failed` | a refund Thunderstrux sent (worker, event cancellation, fraud warning, commerce compensation, or a staff refund Stripe failed later) ended failed, or with `reason: returned_by_bank` came back from the buyer's bank after succeeding (PAY-025, PAY-026) | Failed: the tickets are valid again; refund from the order page, or in Stripe (Reverse transfer and Refund application fee ticked). Returned: the money is in Thunderstrux's balance and the society's share was already taken back; repay the buyer another way (they were emailed). |
| `order_refund_unresolved` | a refund request is still unknown after 6 checks; re-alerts hourly while the worker keeps asking Stripe hourly | Find the refund in Stripe's Dashboard; a `refund.*` webhook can still settle it. Don't refund by hand while it may exist. |
| `purchase_dispute_opened` | a dispute opened on a ticket or commerce order (`evidenceDueBy`) | Review the staged draft in Stripe's Dashboard and submit it before the due date ([[Payment Lifecycle Refunds and Disputes]]). |
| `early_fraud_warning` | a card issuer flagged a payment (`outcome`: `refund_queued`, or why not, or `unmatched`) | `refund_queued`: check the refund lands. Otherwise decide in Stripe: refund, or keep it and expect a dispute. |
| `dispute_evidence_not_staged` | Stripe refused or couldn't take a new dispute's draft answer (`lib/payments/dispute-evidence.ts`) | Check the key has Disputes write; answer the dispute by hand from the staff order page. |
| `purchase_dispute_evidence_due` | an unanswered dispute is due within 72 hours (monitor, per dispute) | Submit the answer in Stripe's Dashboard now; it stops once Stripe's status moves. |
| `purchase_dispute_unmatched` | a dispute doesn't match its order's charge, currency or amount | Investigate the charge in Stripe; nothing was recorded. |
| `compensation_refund_needs_review` | a compensation refund went to `review_required` or `refund_failed`, or (`reason: returned_by_bank`) came back after succeeding (PAY-026) | Refund in Stripe's Dashboard with Reverse transfer and Refund application fee ticked, then confirm the refund id on the order page; for a returned refund, repay the buyer another way. |
| `outside_refund_not_reversed` | a refund made in Stripe's Dashboard didn't take the money back from the society (`unreversed`; PAY-027). Its share stays held | Reverse the transfer by that amount in Stripe (Connect, Transfers) and refund the application fee; the next payout run sees it and releases the hold. |
| `dispute_reversal_unresolved` | a lost dispute can't be taken back (no transfer, another account, nothing left, Stripe refused) or is unknown after 6 tries; the latter re-alerts hourly while the worker keeps looking it up | Reverse or write it off by hand in Stripe; record it on the order. |
| `society_payout_unexpected` | a payout the worker didn't make: an Instant Payout from the Express Dashboard, or Stripe's schedule (`method`, `automatic`; PAY-028). The account was put back on manual payouts | Check Connect's Express settings still block schedule changes and Instant Payouts. If held money left, watch the society's balance: refunds and disputes now debit its bank. |
| `society_payout_failed` | a society's bank refused a payout | The society sees a warning on Payments and fixes bank details in Stripe; the money waits for the next payout. Help if it repeats. |
| `society_charges_paused` | Stripe paused a society's card payments (`disabledReason`; `lib/stripe/connect.ts`) | Its Stripe managers were emailed. If it sells soon or stays paused, help them send what Stripe asks for. |
| `event_cancelled_after_release` | a cancelled event's refunds include sales older than 80 days, already released for payout (`amount`, `orders`; PAY-022) | Watch the society's balance in Stripe: what it no longer holds is debited from its bank. If debits fail, Stripe pauses its payouts and holds a reserve on the platform; contact the society. |
| `commerce_webhook_identity_mismatch` | a commerce Session's family, society or order doesn't match, or a commerce Session arrived without a family | Nothing was fulfilled. Find the payment in Stripe; refund a stray charge there. |
| `ticket_webhook_identity_mismatch` | a paid Session isn't the one bound to its ticket order (PAY-010) | Nothing was issued. If the order was paid on its own Session, refund the stray payment in Stripe; no order records it. |
| `db_migration_failed`, `app_healthcheck_failed` | declared but never raised (DEBT-001) | Watch migration exit codes and deploy logs, and an external uptime check on `/api/health/ready`, instead. |

## Traps

- An alert path must never throw into payment code: `emitOperationalAlert` swallows its own errors. Keep it that way.
- A new alert name must be added to `OperationalAlertName` and to the table above (`pnpm docs:check` enforces it).

## Related

[[Production Operations]] · [[Production Operations Hosting]] · [[Payment Lifecycle Refunds and Disputes]] · [[Stripe Payments and Connect]] · [[Troubleshooting]] · [[Pre-hosting Candidate]]
