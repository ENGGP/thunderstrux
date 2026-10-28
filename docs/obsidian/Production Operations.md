---
status: living
last-reviewed: 2026-10-28
owner: engineering
related: ["[[Environment Variables]]", "[[Stripe Payments and Connect]]", "[[Payment Lifecycle]]", "[[Database and Multi Tenancy]]", "[[Pre-hosting Candidate]]", "[[Troubleshooting]]"]
sources: [docker/Dockerfile, docker/entrypoint.sh, docker-compose.hosted.yml, docker-compose.schedules.yml, deploy/droplet/docker-compose.droplet.yml, scripts/droplet.mjs, scripts/operations.mjs, scripts/release-pair.mjs, lib/ops/worker.ts, lib/ops/readiness.ts]
---

# Production Operations

**Owns:** the single-host runner and the public preview, health and readiness, Stripe webhook endpoint setup and keys, workers and schedules, backup, restore, rollback and recovery. Logs, metrics and alerts are in [[Production Operations Alerts]]. Release images, the pilot host (Droplet), the integrity and asset tools and `pnpm ops:test` are in [[Production Operations Hosting]].
**Read when:** deploying or rolling back, adding a worker, alert or metric, changing a Compose file, or answering an alert.
**Not here:** every env var and `_FILE` support ([[Environment Variables]]); webhook handler behaviour ([[Stripe Payments and Connect#Webhooks]]); refund, dispute and compensation states ([[Payment Lifecycle]]); integrity checks and migration policy ([[Database and Multi Tenancy]]); local dev stack ([[Development Workflow]]); symptoms to fixes ([[Troubleshooting]]); release gates ([[Pre-hosting Candidate]]).

## Code

| Concern | Where |
| --- | --- |
| Image pair, publication, Droplet, `pnpm ops:test` | [[Production Operations Hosting]] |
| Secret-file loader for every image | `docker/entrypoint.sh`: for each of `DATABASE_URL`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY`, `RATE_LIMIT_REDIS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ASSET_STORAGE_ACCESS_KEY`, `ASSET_STORAGE_SECRET_KEY`, `ALERT_WEBHOOK_URL` reads `<NAME>_FILE`; both forms set, a relative path, an unreadable or empty file stop startup without printing the value |
| Hosted Compose contract and its check | `docker-compose.hosted.yml` (prebuilt `APP_IMAGE`/`OPS_IMAGE` by digest, external PostgreSQL and Redis, file secrets, non-root, read-only root, `cap_drop: ALL`, no-new-privileges, PID/CPU/memory limits, tmpfs, 30 s stop grace; `migration` in profile `tools`, workers in `workers`), `docker-compose.assets.hosted.yml` (S3 settings and key files for `app`); `scripts/check-hosted-compose.mjs` (`pnpm docker:hosted:check -- --env-file <file>`) using `scripts/container-config.mjs` (`validateHostedConfig`) |
| Single-host runner | `scripts/operations.mjs` (`pnpm ops:deploy`, `ops:backup`, `ops:restore`, `ops:smoke`); guards `scripts/operations-guards.mjs`; Compose `docker-compose.yml` + `docker-compose.hardened.yml` (+ `docker-compose.operations.yml` with `--rehearsal`) |
| Readiness | `lib/ops/readiness.ts`; `GET /api/health`, `GET /api/health/ready` |
| Worker contract, pause and status | `lib/ops/worker.ts` (`runWorker`, `scheduledWorkers`); `scripts/workers.mjs` → `scripts/workers.ts` (`pnpm ops:workers`) |
| Schedule loop | `scripts/every-minute.mjs`; `docker-compose.schedules.yml` |
| Monitor | `lib/ops/monitor.ts` (`queueThresholds`); `scripts/process-operations-monitor.mjs` |
| Logs, metrics, alerts | `lib/ops/logger.ts`, `lib/ops/metrics.ts`, `lib/ops/alerts.ts` |
| Restore fence and verify | `scripts/fence-restored-identity.sql`, `scripts/verify-restored-database.mjs` |
| Upgrade rehearsal | `scripts/rehearse-upgrade.mjs` |
| Operations rehearsal | `scripts/run-operations-tests.mjs`, `scripts/seed-operations-verification.mjs`, `scripts/rehearse-assets.mjs`, `scripts/mail-capture.mjs` |
| Tests | `tests/runner/operations.test.mjs`, `tests/runner/droplet.test.mjs`, `tests/runner/release-pair.test.mjs`, `tests/runner/every-minute.test.mjs`, `tests/runner/container-config.test.mjs`, `tests/integration/worker-contract.test.ts`, `tests/integration/ops-logging.test.ts`, `tests/integration/recovery-fencing.test.ts` |

## Single-host runner

`pnpm ops:deploy` / `ops:backup` / `ops:restore` drive the base stack with its own PostgreSQL and Redis (`docker-compose.yml` + `docker-compose.hardened.yml`). They don't deploy `docker-compose.hosted.yml`. The pre-production preview (`thunderstrux.mistayu.com`, project `ops-preview`, `.env.preview`, loopback 3090 behind a Cloudflare Tunnel) runs this path.

```powershell
pnpm ops:workers -- pause all --reason="Deploy <sha>"
pnpm ops:deploy -- --project ops-thunderstrux --env-file .env.production --url http://127.0.0.1:3000 --release <git-sha>
```

| Flag | Rule |
| --- | --- |
| `--project` | required; `ops-[a-z0-9-]` (`assertOperationsProject`) |
| `--env-file` | required; passed to Compose so it never reads a stray `.env` |
| `--url` | deploy and smoke; HTTP on `localhost`/`127.0.0.1` only |
| `--release` | default `local-<ms>`; `[a-zA-Z0-9._-]{3,80}` |
| `--skip-build` | use already-built `thunderstrux-app:<release>` / `thunderstrux-ops:<release>` |
| `--readiness-attempts` | 1–120, default 60, 1 s apart |
| `--compatibility-file` | enables automatic rollback on a failed candidate |
| `--rehearsal` | adds `docker-compose.operations.yml` |

Deploy: take `tmp/operations/<project>/deploy.lock` → build `app` and `migration` → check the pair (`describeReleasePair`, budgets) → find the running `app` and worker services → stop them all (OPS-007: workers write too) → pre-migration backup → `migration` once → start the candidate → readiness (`/api/health`, `/api/health/ready`, `/` must answer 2xx/3xx) → record `current-release.json` (`candidateImageId`, `imageRef`, `opsImageId`, `opsImageRef`, `pair`, `previousImageId`, `migrationDigest`, `backup`) and `active.env` → recreate the workers it stopped with `docker-compose.schedules.yml` on the release's ops image. A backup failure, or a failed candidate rolled back, restarts the unchanged previous app and workers. Once migration starts, any other failure leaves `app` and the workers stopped ("writers remain stopped"). `pnpm ops:smoke -- --url <loopback>` runs the three read-only checks alone. The deploy restarts only workers that were running; it never starts them the first time.

### Public preview

`https://thunderstrux.mistayu.com` runs this path as project `ops-preview`, with its own database volume, Redis and workers, separate from the dev stack. Preview reachability satisfies no release gate.

1. Create an ignored `.env.preview` from `.env.example`: random `AUTH_SECRET` (32+ characters), `MFA_ENCRYPTION_KEY` and `NOTIFICATION_ENCRYPTION_KEY` (`openssl rand -base64 32`); `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_APP_ORIGINS` = `https://thunderstrux.mistayu.com`; `APP_PORT=3090` (published on `127.0.0.1` only); `MFA_ENFORCEMENT_MODE=enforce`, `LEGACY_ORGANISATION_ACCESS_MODE=deny`, `RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_TRUSTED_PROXY_HEADER=cf-connecting-ip`; Stripe **test** keys and the preview endpoints' test-mode webhook secrets; `RESEND_API_KEY` with `EMAIL_FROM` on a domain verified in the same Resend team; optional `ASSET_STORAGE_*` (without a bucket only image uploads fail); `DATABASE_URL` for the `db` service with `.env.db`'s credentials.
2. Deploy. After the first deploy, start the workers on the images that release recorded; later deploys stop and restart them themselves. Without `APP_IMAGE`/`OPS_IMAGE` Compose would recreate the app from `thunderstrux-app:local`. Run the second command again only if the workers were stopped:

   ```bash
   pnpm ops:deploy -- --project ops-preview --env-file .env.preview --url http://127.0.0.1:3090 --release <git-sha>
   release=tmp/operations/ops-preview/current-release.json
   APP_IMAGE=$(node -p "require('./$release').candidateImageId") OPS_IMAGE=$(node -p "require('./$release').opsImageId") \
     docker compose --env-file .env.preview -p ops-preview -f docker-compose.yml -f docker-compose.hardened.yml -f docker-compose.schedules.yml --profile workers \
     up -d --no-deps email-worker notification-worker stale-order-worker compensation-worker checkout-recovery-worker monitor-worker
   ```

3. Point the Cloudflare Tunnel's public hostname at `http://127.0.0.1:3090` only (never the dev stack's 3080). Send a test event from each Stripe test-mode webhook destination and check for 200.
4. Optional demo content: `node prisma/seed.mjs` in the preview's `migration` service with `SEED_DEMO_PASSWORD` (16+ characters); the seed refuses a public origin without it, and every demo account then uses it ([[Seeding and Data]]).

Staff enrol an authenticator on first sign-in.

## Health and readiness

- `GET /api/health`: liveness only, `{status: "ok", service: "thunderstrux"}`.
- `GET /api/health/ready` (`checkApplicationReadiness`): 200 `{status: "ready"}` only when notification encryption config is valid, legacy-access and staff-MFA config are valid, `SELECT 1 FROM "User"` succeeds and `config/schema-contract.json` `requiredMigration` is finished and not rolled back (2 s budget), and Redis answers `PING` when rate limiting is on. Otherwise 503 `{status: "unavailable"}` with no detail. Always `Cache-Control: no-store`.
- An unhealthy container is a signal only; Compose doesn't replace it.

## Stripe webhook endpoints and keys

Create both in Stripe Workbench (live for production, test for staging) as **snapshot** endpoints on the app's pinned version, `stripeApiVersion` in `lib/stripe/version.ts` (PAY-006). An endpoint left on the account default sends events shaped for another version and raises `stripe_webhook_version_mismatch`. An endpoint's version can't change: a version move means new endpoints, moving the signing secrets, then retiring the old ones. Before deploying a version change, wait until the checkout-recovery queue is empty: a stored Session request replayed under the new version can be refused (recovery then releases the hold).

| Endpoint | Listens to | Events | Secret |
| --- | --- | --- | --- |
| `https://<app>/api/payments/webhook` | your account | `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `radar.early_fraud_warning.created` | `STRIPE_WEBHOOK_SECRET` |
| `https://<app>/api/stripe/connect/webhook` | connected accounts | `account.updated`, `account.external_account.created`, `account.external_account.updated`, `payout.created`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Subscribe only these. Check the endpoint list shows the pinned version, then send a test event to each and confirm HTTP 200 under Event deliveries.

**Key:** a restricted key (`rk_live_…`) with only what the code calls: Checkout Sessions write (create, retrieve, list, expire); PaymentIntents and Charges read; Refunds write; Disputes write (read, and staging each dispute's draft answer); Radar early fraud warnings read; Connect accounts, account links and login links write; Transfers write (reversals; also retrieve and list reversals); on connected accounts Balance read and Payouts write. Prove it in test mode with the staging campaign first: a 403 in Workbench request logs names the missing permission. Store it as the `stripe_secret_key` secret; roll it when someone with access leaves.

**Disputes:** on destination charges the platform answers every dispute, because it is on the platform's account and societies can't see it. The platform operator owns them; an unanswered dispute is lost. Stripe takes the amount and dispute fee from the platform; once lost, the refunds worker reverses the society's transfer by the disputed amount (PAY-004); the dispute fee stays with the platform. How to answer one: [[Payment Lifecycle Refunds and Disputes#Answering a dispute]].
Optionally the edge may accept webhook requests only from Stripe's published IP ranges; signatures stay the real protection.

## Workers and schedules

Six jobs, each a bounded one-shot batch under `runWorker` (`lib/ops/worker.ts`). A `.mjs` file is a jiti loader for the `.ts` beside it.

| Job (`WorkerLease.name`) | Command | Compose service | Does |
| --- | --- | --- | --- |
| `email-outbox` | `scripts/process-email-outbox.mjs` (`pnpm email:outbox:process`) | `email-worker` | sends ticket emails |
| `notifications` | `scripts/process-notifications.mjs` (`pnpm notifications:process`) | `notification-worker` | queues event-change fanout and membership reminders/expiry notices, deletes tokens, guest grants and MFA grants 30 days past expiry (500 each a run, `lib/security/token-cleanup.ts`), then sends one notification batch. A failed queueing or cleanup step is logged and sets exit code 1 but never blocks sending |
| `stale-orders` | `scripts/process-stale-orders.mjs` (`pnpm stale-orders:process`; `--dry-run`, `--limit=1..1000`) | `stale-order-worker` | reconciliation sweep (PAY-024); expires unpaid ticket and commerce orders past their hold, each checked at Stripe first; deletes expired staff MFA grants (500). Needs `STRIPE_SECRET_KEY`, `NOTIFICATION_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL` |
| `refunds` | `scripts/process-compensation-refunds.mjs` (`pnpm compensation-refunds:process`; `--limit=1..100`, default 25) | `compensation-worker` | in order: compensation refunds, ordinary order refunds, lost-dispute transfer reversals (PAY-004), society payouts (each society at most hourly, one payout a UTC day; PAY-005, DEF-034) |
| `checkout-recovery` | `scripts/process-checkout-attempts.mjs` (`pnpm checkout-attempts:process`; `--limit=1..100`) | `checkout-recovery-worker` | replays uncertain Stripe Session creation under the same idempotency key, ticket and commerce |
| `monitor` | `scripts/process-operations-monitor.mjs` | `monitor-worker` | queue and staleness metrics and alerts (Logs, metrics and alerts) |

**Contract:**
- **One run at a time:** a run takes its `WorkerLease` row (lease = timeout + 30 s) or exits at once with `worker.skipped_running`, across hosts. A lapsed lease is taken over with `worker.lease_reclaimed`. Item-level leases inside each queue requeue what a lost run claimed.
- **Pause:** `pnpm ops:workers -- pause <job|all> --reason="..."` (reason required, 200 chars), `resume <job|all>`, `status` (pause state, each job's last success/failure, running, and every queue reading). A paused job's runs log `worker.paused` and do nothing. Pausing doesn't stop a run in progress; wait until `status` shows nothing `running`. The pause lives in the database.
- **Timeout:** `WORKER_TIMEOUT_SECONDS` (integer 10–3600, default 300). Past it the run logs `worker.timed_out`, alerts and the process exits 1.
- **Outcome:** `worker.succeeded` (with the job's result) or `worker.failed`; `worker.run` and `worker.duration_ms` with an `outcome` tag on every run, skipped ones included. Pending alert deliveries are awaited before exit.

**Schedules:** `docker compose -f docker-compose.hosted.yml -f docker-compose.schedules.yml --profile workers up -d` wraps each service's command in `scripts/every-minute.mjs`: a run starts `WORKER_INTERVAL_SECONDS` (default 60, at least 10) after the previous start, or as soon as it ends if longer; never overlaps itself; kills a run that outlives `WORKER_TIMEOUT_SECONDS` + 60 s (`schedule.run_killed`); SIGTERM ends the loop after the current run (30 s stop grace). Logs `schedule.run_finished` and `schedule.stopped`. Each service keeps only its own secrets. A host with cron or a platform scheduler can run the one-shot services instead; the lease still prevents overlap. Stopping these services stops the schedule.

## Logs, metrics and alerts

Logs, metrics, alert delivery, the monitor's queue thresholds and every alert with its operator action are in [[Production Operations Alerts]].

## Backup, restore and rollback

**Backup** (single host): `pnpm ops:backup -- --project <ops-…> --env-file <file>` writes a custom-format `pg_dump` of the bundled `db` to `tmp/operations/<project>/` atomically (`.partial`, then rename), with a JSON record: SHA-256, size, source database, migration digest, current release. Keeps the newest seven; owner-only directory (`icacls` on Windows). Local archives are not disaster protection: move them to encrypted off-machine storage (OPS-003). On the Droplet each deploy's `backup` service writes a checked dump (`pg_restore --list`) to `/var/lib/thunderstrux/backups`, also keeping seven.

**Object bytes are not in either dump.** Hosted assets need a coordinated object backup: pause uploads and `pnpm assets:maintain` during recovery, restore metadata and objects together, keep unfamiliar bucket objects ([[Society Profiles and Assets]]).

**Restore:** `pnpm ops:restore -- --project <ops-…> --env-file <file> --archive <x.dump> --target-database <name>_restore_test`. It checks the archive's metadata belongs to this project and its checksum, refuses an existing target, restores with `--no-owner --no-privileges --exit-on-error`, then from the ops image runs `scripts/verify-restored-database.mjs` (counts, migration history, invitation decryption with the recovered notification key, ownership continuity, the integrity audit with no unexplained violations), applies `scripts/fence-restored-identity.sql` (SEC-023: every `authVersion` advances, `MfaGrant` emptied, unused auth tokens invalidated, guest grants and pending staff invitations revoked), and pauses every worker with a reason naming the archive (DEF-025). Any failure quarantines the target; it is never promoted. On resume, jobs check the provider before acting (refunds look for their own refund first, then use a fixed idempotency key; checkout recovery replays the same key; outboxes send with their own keys), proven by `tests/integration/recovery-fencing.test.ts`.

**Upgrade rehearsal:** before a release with migrations, `node scripts/rehearse-upgrade.mjs <archive.dump> [...]` restores each archive into a throwaway PostgreSQL 16 container as `upgrade_rehearsal_test`, applies this checkout's migrations, runs the integrity audit and checks no rows were lost, then removes the container. It needs a tools image with the repository (`REHEARSAL_TOOLS_IMAGE`, default `thunderstrux-e2e-tests:local` from `scripts/run-e2e.mjs`) and skips archives from a newer `pg_dump`. Investigate any unexplained violation before migrating; a new constraint stops the migration on rows that break it.

**Rollback** never restores the database. Both the runner (`--compatibility-file` on a failed candidate) and `pnpm ops:droplet -- rollback` need a reviewed JSON declaration `{candidateImageId, previousImageId, migrationDigest, reviewed: true}` matching exactly, written only after the older image was tested against the upgraded schema (`assertRollbackCompatibility`). The runner restores the previous image ref with its saved `active.env` once; a shared database or Redis outage is repaired, not rolled back. Migrations are additive, so older code ignores newer columns. Never `prisma migrate reset`, never mark a failed migration resolved automatically. Closure anonymisation and other account changes are not undone by a code rollback, and older builds may not enforce session revocation or the closure fences: pause account mutations, buyer contact and ticket delivery before rolling back across an account-lifecycle migration.

## Traps

- `pnpm ops:restore` restores into a new database and doesn't stop the live stack's workers; stop writes first ([[#Failure and recovery]]).
- `pnpm ops:backup` doesn't cover object storage or the encryption keys. A restore without `NOTIFICATION_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY` can't decrypt pending notices or staff MFA secrets.
- An alert path must never throw into payment code: `emitOperationalAlert` swallows its own errors. Keep it that way.
- A new worker needs a `scheduledWorkers` entry, a hosted service, a schedule service, `workerServices` in `scripts/droplet.mjs`, `validateHostedConfig`'s list and a monitor query if it owns a queue.

## Failure and recovery

Disaster recovery, in order:
1. **Stop writes.** Stop the app (or maintenance mode); `pnpm ops:workers -- pause all --reason="Recovery <date>"`; wait until `status` shows nothing running.
2. **Restore separately** into a new `_restore_test` database with no Stripe or Resend credentials. `ops:restore` verifies, fences identity and pauses workers. For a hosted point-in-time restore, run `scripts/fence-restored-identity.sql` and `pause all` against the new cluster yourself.
3. **Reconcile with providers**, workers still paused: replay paid Sessions newer than the backup from Stripe (fulfilment is idempotent) or let stale-orders reconcile; replay `refund.*` and `charge.dispute.*` events; outbox messages marked pending may already have been sent, so accept a duplicate or cancel those the provider log shows delivered.
4. **Re-apply identity changes** made after the restore point (closures, compromised-password disables, email changes, staff revocations) from the audit log and support records. **Rotate `AUTH_SECRET`** so no pre-failure token is accepted.
5. **Resume:** point the app at the recovered database, check readiness, `pnpm ops:workers -- resume all`; watch backlog and stale alerts for 15 minutes.
6. **Keep with every backup:** `MFA_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY`, the asset storage keys and bucket, the Stripe account and webhook secrets, `AUTH_SECRET` (rotated in a recovery) and `ALERT_WEBHOOK_URL`.

A restore can't undo charges, refunds, transfers or sent email.

## Related

[[Production Operations Hosting]] · [[Production Operations Alerts]] · [[Environment Variables]] · [[Stripe Payments and Connect]] · [[Payment Lifecycle]] · [[Database and Multi Tenancy]] · [[Society Profiles and Assets]] · [[Dependency Automation]] · [[E2E and Staging Payments]] · [[Pre-hosting Candidate]] · [[Troubleshooting]] · [[Engineering Delivery Workflow]]
