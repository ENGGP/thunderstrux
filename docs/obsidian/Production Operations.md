---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Project Handover]]", "[[Database and Multi Tenancy]]"]
sources: [scripts/operations.mjs, docker-compose.hosted.yml, scripts/run-operations-tests.mjs]
---

# Production Operations

## Current Status

Repository-side operations (originally task P2.17) are implemented and locally rehearsed. The repository provides local Docker validation, optional manual GitHub workflows, liveness/readiness endpoints, non-root production containers, a single migration job, guarded deployment, PostgreSQL backup/restore, and compatibility-gated application rollback.

The hardened repository contract is `docker-compose.hosted.yml`. It consumes a prebuilt immutable `APP_IMAGE`, external PostgreSQL and Redis URLs, and file-backed secrets; it contains no database, Redis, source bind mount, or image build. The application, migration, and workers run non-root with a read-only root filesystem, dropped capabilities, no-new-privileges, bounded PIDs, explicit CPU/memory limits, and reviewed writable `tmpfs` paths. Validate a deployment environment with `pnpm docker:hosted:check -- --env-file <path>` before rollout.

This is not evidence of a live production deployment. Since T42 the repository provides the per-minute worker schedule, overlap prevention, pause, timeouts, backlog monitoring and an alert webhook (see Workers, schedules and alerts). Hosting, choosing the alert receiver, external uptime monitoring, off-machine encrypted backups and recovery objectives remain deployment-time work.

Packages 1–3 are locally qualified and Package 4 is in progress; local development carries every migration, each applied after a verified dump. [[Project Handover]] owns the dated activations. Hosted activation still requires independent security/migration review and provider acceptance. T07/T08 add asset metadata and profile references: apply the full 34-migration chain, retain the additive fields on code rollback and preserve image bytes.

Hosted assets additionally require `docker-compose.assets.hosted.yml`, a configured S3-compatible bucket/endpoint/region/path style and server-only access/secret file mounts. The PostgreSQL `ops:backup` command below does not back up object bytes. Pair it with a coordinated object backup and integrity check, pause uploads/maintenance during recovery, restore metadata and objects together, and keep unfamiliar bucket objects. [[Society Profiles and Assets]] owns quotas, reference checks and bounded dry-run/integrity/object inspection. Scheduling maintenance and off-machine byte recovery remain hosted gates.

## Health

- `GET /api/health` is liveness only and preserves the public `{status: "ok", service: "thunderstrux"}` contract.
- `GET /api/health/ready` returns `200` only when the release's required migration is completed and not rolled back, an application-table query succeeds, MFA/legacy-access configuration is valid, and Redis responds when rate limiting is enabled, and the notification encryption key is valid. It returns a public-safe `503` otherwise and is never cached.
- The image healthcheck calls readiness on `PORT`, defaulting to `3000`. An unhealthy container is a signal; Docker Compose does not automatically replace it.

## Deployment

The `pnpm ops:*` commands below are the existing single-host and recovery-rehearsal path. They use the base Compose stack with its PostgreSQL/Redis services and local backup tooling. They do not deploy `docker-compose.hosted.yml`. A managed hosted rollout must implement the same migration, backup, readiness, writer-shutdown, and compatibility-gated rollback order through provider-specific jobs after the hosted activation gates are verified.

Use a unique immutable release name and an explicit environment file:

```powershell
pnpm ops:deploy -- --project ops-thunderstrux --env-file .env.production --url http://127.0.0.1:3000 --release <git-sha>
```

The runner acquires a target lock, builds one image, identifies any current app, stops writers, creates a pre-migration backup, runs `prisma migrate deploy` once, starts the candidate, and performs read-only smoke checks. It records image IDs and migration checksums under ignored, access-restricted `tmp/operations/<project>/` state. Ordinary app restarts never run migrations.

Pause the workers before deployment (`pnpm ops:workers -- pause all --reason=...`) and resume them only after readiness succeeds. Compose exposes the bounded jobs through the `workers` profile; run them every minute with `docker-compose.schedules.yml` or a platform scheduler. Each command enforces its own lease, pause and timeout (see Workers, schedules and alerts):

```text
every minute: node scripts/process-email-outbox.mjs
every minute: node scripts/process-stale-orders.mjs   # also expires stale commerce orders (T21)
every minute: node scripts/process-compensation-refunds.mjs   # also resolves ordinary refunds (T18a)
every minute: node scripts/process-checkout-attempts.mjs   # ticket and commerce attempts (T21)
every minute: node scripts/process-notifications.mjs   # also fans out event changes and queues membership reminders (T30), and deletes tokens 30 days past expiry, 500 a run (T39)
every minute: node scripts/process-operations-monitor.mjs   # queue backlog, oldest age, stuck items and stale jobs (T42)
```

## Workers, schedules and alerts

Since T42 every scheduled command runs under one contract (`lib/ops/worker.ts`):

- **One run at a time.** Each job has a row in `WorkerLease`: email-outbox, notifications, stale-orders, refunds, checkout-recovery and monitor. A run takes that row's lease. A second run while the lease is held exits at once (`worker.skipped_running`), on any host. The lease lasts the timeout plus 30 seconds, so the next run reclaims a crashed run's lease (`worker.lease_reclaimed`). Item-level leases inside each queue still requeue the items a lost run had claimed.
- **Pause.** Use `pnpm ops:workers -- pause <job|all> --reason="..."` and `resume <job|all>`. A paused job's runs exit without doing work (`worker.paused`). Pausing doesn't stop a run in progress: before a restore, check that `pnpm ops:workers -- status` shows nothing `running`. The pause lives in the database, so a restored copy stays paused until someone resumes it.
- **Timeout.** `WORKER_TIMEOUT_SECONDS`, default 300. A run past it is stopped and alerted (`worker_timed_out`), and its process exits.
- **Outcome.** Every run logs `worker.succeeded` or `worker.failed` with its duration and emits the `worker.run` and `worker.duration_ms` metrics. A failure alerts `worker_failed`.
- **Schedule.** `docker compose -f docker-compose.hosted.yml -f docker-compose.schedules.yml --profile workers up -d` runs each worker service in a loop (`scripts/every-minute.mjs`).
  - A run starts a minute after the previous one started, or as soon as it ends if it took longer. It never overlaps itself.
  - Stopping a service lets the current run finish within the 30-second stop grace.
  - Each service keeps only its own secrets.
  - A host with cron or a platform scheduler can run the one-shot services instead; the lease still prevents overlap.
- **Monitor.** `process-operations-monitor.mjs` emits `queue.backlog`, `queue.oldest_age_seconds` and `queue.stuck` for each queue, and `worker.seconds_since_success` for each job. It alerts when a threshold below is crossed. A firing alert repeats every 30 minutes; a cleared one alerts again at once if it comes back.
- **Alert transport.** With `ALERT_WEBHOOK_URL` set, each operational alert is also POSTed as JSON `{event, environment, timestamp, dedupeKey, details}`, redacted like the logs, with a 3-second timeout.
  - Hosted, it comes from `ALERT_WEBHOOK_URL_FILE`, a required secret for the app and every worker.
  - A failing receiver is logged (`ops.alert.delivery_failed`) and never fails the caller.
  - Point it at a receiver that groups alerts by `dedupeKey`.
  - Locally, `scripts/mail-capture.mjs` also receives alerts (`POST /alerts`, `GET /alerts`), and the operations rehearsal checks that they arrive.
- **What the monitor can't see.** If the monitor itself stops, nothing alerts. The hosted uptime check must also watch for missing `worker.seconds_since_success` metrics, or for a missed heartbeat ping (H-series).

**Thresholds and response.** The engineering on-call for the deployment owns the response to every alert. Refund and dispute alerts also go to whoever handles society support.

| Alert | Fires when | First response |
| --- | --- | --- |
| `worker_failed`, `worker_timed_out` | a run fails or runs past `WORKER_TIMEOUT_SECONDS` | Read the run's logs; a provider outage clears on a later run. If it keeps failing: pause the job, fix it, resume. |
| `worker_stale` | a job hasn't succeeded for 10 minutes and isn't paused | Check that its schedule is running (`status`, service logs). |
| `queue_backlog_high` email or notifications | the oldest pending message is over 15 minutes old | Check Resend acceptance and the `email_outbox_retry_exhausted` and `notification_outbox_retry_exhausted` alerts. |
| `queue_backlog_high` checkout attempts | an uncertain Stripe Session is over 30 minutes old | Check the checkout-recovery job and compare with the Stripe dashboard. |
| `queue_backlog_high` compensation or order refunds | a queued or uncertain refund is over an hour old | Check the refunds job and Stripe. Never refund by hand while a refund is uncertain: it may go through twice. |
| `queue_backlog_high` ticket holds | an expired hold is still active 10 minutes later | Check the stale-orders job; the held stock stays unavailable until it runs. |
| `queue_backlog_high` commerce checkouts | a pending commerce checkout is 30 minutes past its expiry | Check the stale-orders job. |
| `queue_processing_stuck` | an item has been processing for over 15 minutes | Lease recovery should requeue it; if it doesn't, inspect the item before requeueing. |

## Recovery runbook

1. **Stop writes.** Stop the app (or put the platform into maintenance) and run `pnpm ops:workers -- pause all --reason="Recovery <date>"`. Wait until `status` shows no job running. Stopping the scheduled services also stops them, but only the database pause carries over to a restored copy.
2. **Restore separately.** Restore into a new `_restore_test` database (see Backup And Restore below) with no Stripe or Resend credentials, so nothing restored can charge, refund or email. Restore verification runs the integrity audit (T41).
3. **Reconcile before resuming.** Point the restored database at the real credentials, keep the workers paused, and compare it with Stripe:
   - **Paid Sessions after the backup that the database lacks:** replay their webhooks from the Stripe dashboard (fulfilment is idempotent), or let the stale-orders job reconcile the pending orders.
   - **Refunds and disputes after the backup:** replay the `refund.*` and `charge.dispute.*` events.
   - **The outbox:** messages still marked pending may have been sent before the failure. Accept a possible duplicate, or cancel the ones the provider's log shows were delivered.
4. **Resume.** Switch the app to the recovered database, check readiness, then run `pnpm ops:workers -- resume all`. Watch for backlog and stale-job alerts for the next 15 minutes.
5. **Back up these secrets with the database:**
   - `MFA_ENCRYPTION_KEY`, which encrypts staff MFA secrets;
   - `NOTIFICATION_ENCRYPTION_KEY`, which encrypts queued notices;
   - the asset storage keys and bucket;
   - the Stripe account and webhook signing secrets, the provider identity the orders refer to;
   - `AUTH_SECRET` and `ALERT_WEBHOOK_URL`.

   Without its encryption keys, a restored database can't decrypt MFA secrets or pending notices.

A backup failure occurs before migrations and allows the unchanged release to restart. Once migration begins, a failure leaves writers stopped for inspection. Never use `prisma migrate reset` or automatically mark a failed migration resolved.

## Rollback

Code rollback does not restore the database. It requires a reviewed JSON declaration containing `candidateImageId`, the running `previousImageId`, the exact `migrationDigest`, and `reviewed: true`. Use `--compatibility-file <path>` only after the previous image has been tested against the upgraded database. Missing or mismatched evidence disables automatic rollback.

The runner restores the previous unique image reference and its protected environment snapshot once. A shared database or Redis outage must be repaired instead of causing repeated image rollback.

## Backup And Restore

Create a custom-format PostgreSQL backup:

```powershell
pnpm ops:backup -- --project ops-thunderstrux --env-file .env.production
```

Archives and metadata are written atomically under `tmp/operations/<project>/`, include a SHA-256 checksum and migration digest, and retain the latest seven successful backups. Move production backups to encrypted off-machine storage; local archives are not disaster protection.

Restore only into a new database ending in `_restore_test`:

```powershell
pnpm ops:restore -- --project ops-thunderstrux --env-file .env.production --archive <archive.dump> --target-database recovery_restore_test
```

Restore verifies metadata ownership, checksum, archive completion, grants through application credentials, migration history, representative domain reads and, since T41, the integrity audit with no unexplained violations. Failed targets remain quarantined and are never promoted.

Before a release with migrations, rehearse the upgrade on a copy of the data: `node scripts/rehearse-upgrade.mjs <archive.dump>` restores each archive into a throwaway `_test` database, applies the release's migrations, runs the integrity audit and checks no rows were lost, then removes the container. It needs the e2e test image (`thunderstrux-e2e-tests:local`). Investigate any unexplained violation before the migration job runs; a new constraint stops the migration on legacy rows that break it ([[Database and Multi Tenancy]]).

For disaster recovery, follow the Recovery runbook above. A database restore cannot reverse external charges, refunds, transfers, or email sends.

## Validation

`pnpm ops:test` runs guard tests and a disposable Docker rehearsal. It verifies non-root execution, read-only filesystem behavior, writable temporary paths, dropped capabilities, no-new-privileges, resource limits, file-backed secret loading and conflict rejection, all four bounded workers, migration blocking, database/Redis health failures, custom-format backup, corrupt-archive quarantine, restored domain records, explicit rollback compatibility, and resource ownership cleanup. Since T42 it also rehearses the worker contract against the release image: a paused run, an overlapping run skipped, a crashed run's lease reclaimed, a failing run's alert and the monitor's stale-job alert received once by the local alert receiver. Each rehearsal is a Compose project named `ops-<10 hex>` with an `ops` database user and `ops_app_test` database, and it removes everything it created at the end (that removal is part of what it tests). The GitHub `operations-tests` job runs the same rehearsal without production credentials.

For dependency/container changes, local validation follows [[Engineering Delivery Workflow]]: review affected Compose contracts, lint changed Dockerfiles, build the production target and scan fixable high/critical vulnerabilities when that boundary changes. The optional manual static-validation workflow provides the same checks; it is not a merge requirement. Temporary vulnerability exceptions are prohibited unless they identify the CVE, reason, owner, and expiry in the issue register and workflow configuration.

Digest pinning also retains the base image's installed OS packages. The application Dockerfile explicitly installs `libpcre2-8-0` from Debian's security repository alongside its runtime prerequisites, so rebuilding upgrades the inherited library. The 2026-10-04 scan found CVE-2026-103111 in `10.42-1+deb12u1`; Debian's fixed Bookworm package is `10.42-1+deb12u2`. Verify the installed version and scan the final `runner` image after security package changes; do not bypass the vulnerability gate. See the [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-103111).

Direct environment variables remain supported for development and legacy deployment. Production secret stores should mount files and set matching `_FILE` variables for DATABASE_URL, AUTH_SECRET, MFA_ENCRYPTION_KEY, RATE_LIMIT_REDIS_URL, Stripe credentials, RESEND_API_KEY, NOTIFICATION_ENCRYPTION_KEY, ASSET_STORAGE_ACCESS_KEY and ASSET_STORAGE_SECRET_KEY. Supplying both forms, an unreadable or relative file, or an empty file fails startup without printing the secret.

## Account Closure Release Compatibility

Migration 20261005030000_account_closure adds permanent User closure markers, immutable Order buyer contact captures and integrity constraints. Run the one-shot migration before app/worker rollout. No legacy account is automatically closed and no historical purchase-time identity is invented. A user-initiated closure anonymises login/profile irreversibly through the app while preserving business/audit/security and buyer contacts. Database backups consequently contain retained personal information and require the existing access/encryption/retention controls.

Before rollback to an older app/worker, pause closure/account mutations and buyer contact/ticket email flows: older images do not resolve retained snapshots or fence staff/MFA credential races. Restoring a backup into a disposable _restore_test database verifies records/constraints; restoring old non-disposable data would be a separate explicit recovery decision and must not silently reactivate closed accounts. Independent review before activation remains required. Development and production stacks are not deployed by local qualification.

## Private invitation rollout and recovery

Apply `20261009010000_private_staff_invites` once before rolling out app and notification workers. Preserve and separately back up the notification key: database-only restoration cannot decrypt invitations. The disposable operations rehearsal verifies a version-linked encrypted invitation survives backup/restore and decrypts with the recovered run key, alongside deployment, migration and rollback guards. Additive columns can remain after code rollback, but pause invitation acceptance and delivery before rolling back to code lacking version/role-preservation checks. Existing pre-migration digests remain redeemable only under the new guards; no recovery mail is fabricated. Repository delivery does not activate development or hosted stacks; independent security/migration review and real provider acceptance remain separate gates.

## Handover rollout and rollback

Handover uses the existing schema; apply the Package 2 migration before release as usual. Confirm named incoming staff have verified email and enforced MFA enrollment before retiring committee access. No credentials or Stripe connection move. Code rollback does not restore accountUserId or outgoing access; pause handover/owner mutations before reverting to code lacking the shared ownership guards, and recover authority only through explicit audited management. The disposable recovery rehearsal verifies retired pointer, active incoming owner, revoked outgoing owner and audit continuity survive restore; independent production review remains a release gate.
