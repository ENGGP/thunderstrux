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

The hardened repository contract is `docker-compose.hosted.yml`. It consumes a prebuilt immutable release pair: `APP_IMAGE` (web) for the app and `OPS_IMAGE` for migration and every worker (see Release images). It also takes external PostgreSQL and Redis URLs and file-backed secrets; it contains no database, Redis, source bind mount, or image build. The application, migration, and workers run non-root with a read-only root filesystem, dropped capabilities, no-new-privileges, bounded PIDs, explicit CPU/memory limits, and reviewed writable `tmpfs` paths. Validate a deployment environment with `pnpm docker:hosted:check -- --env-file <path>` before rollout.

This is not evidence of a live production deployment. Since T42 the repository provides the per-minute worker schedule, overlap prevention, pause, timeouts, backlog monitoring and an alert webhook (see Workers, schedules and alerts). Hosting, choosing the alert receiver, external uptime monitoring, off-machine encrypted backups and recovery objectives remain deployment-time work.

Packages 1–3 are locally qualified and Package 4 is in progress; local development carries every migration, each applied after a verified dump. [[Project Handover]] owns the dated activations. Hosted activation still requires independent security/migration review and provider acceptance. T07/T08 add asset metadata and profile references: apply the full 34-migration chain, retain the additive fields on code rollback and preserve image bytes.

Hosted assets additionally require `docker-compose.assets.hosted.yml`, a configured S3-compatible bucket/endpoint/region/path style and server-only access/secret file mounts. The PostgreSQL `ops:backup` command below does not back up object bytes. Pair it with a coordinated object backup and integrity check, pause uploads/maintenance during recovery, restore metadata and objects together, and keep unfamiliar bucket objects. [[Society Profiles and Assets]] owns quotas, reference checks and bounded dry-run/integrity/object inspection. Scheduling maintenance and off-machine byte recovery remain hosted gates.

## Release images

Since T43a every release is two images built from one revision by `docker/Dockerfile`:

- **`web`** is Next's standalone server (`output: "standalone"`): the traced server files, static assets and the dependencies they need, including the Prisma engine and sharp. It runs `node server.js` with the readiness healthcheck. It can't migrate or run workers.
- **`ops`** holds production dependencies (the Prisma CLI is one), `lib`, `scripts`, `prisma` and `config`. Migrations, every worker, seeds, the integrity audit, restore verification and asset tools run from it. It has no healthcheck and serves nothing.
- **`development`** is unchanged: the full dependency tree for `docker-compose.dev.yml`.

Neither release image carries pnpm or Corepack. Neither has the app's origin built in (T44d): the server reads `NEXT_PUBLIC_APP_URL` at run time through `lib/app-url.ts`, so the published image serves whichever domain `config.env` names. Both run as `node` through the same entrypoint and secret-file loader.

**Budgets.** Uncompressed, summed over layers (`docker history`):
- web at most 600 MiB (387 MiB on 23 Oct 2026);
- ops at most 1 GiB (939 MiB);
- the single image this replaced was 1,190 MiB.

Raise a budget only with a measured reason and an owner recorded here; don't delete code the images need.

**Release manifest.** `node scripts/release-pair.mjs --web <image> --ops <image> [--out file]` records:
- the full git revision;
- each image's immutable id and size;
- the required migration;
- the migration chain digest.

It refuses a pair over budget, the same image twice, or one without a revision or chain. `pnpm ops:deploy` builds the pair (`thunderstrux-app:<release>` and `thunderstrux-ops:<release>`) and checks the manifest before any writer stops. It runs the migration from the ops image and records the manifest (`pair`, `opsImageId`, `opsImageRef`) in `current-release.json`. Rollback restores the previous web image as before.

**Publication (T43c).** `.github/workflows/release.yml` runs on every merge to `main`:
1. Build the pair once.
2. Check the budgets.
3. Scan both images with Trivy. Fixable high or critical findings stop the run, as in the dependency workflow.
4. Record SPDX SBOMs.
5. Push the same images, never rebuilt, to `ghcr.io/enggp/thunderstrux` and `ghcr.io/enggp/thunderstrux-ops`, tagged `sha-<revision>`.
6. Attach signed GitHub build-provenance and SBOM attestations to each digest.
7. Upload `release-<revision>`: the release manifest, with registry digests (`release.json`), and the SBOMs, kept 90 days.

A second job pulls both digests on a fresh runner and checks they match the manifest's image ids and revision. It verifies both attestations with `gh attestation verify` and smoke-tests the images. Pull requests that change the images run the build, budget, scan and SBOM steps without publishing.

To deploy a release, download its manifest and run the T43b command:

```bash
gh run download --repo ENGGP/thunderstrux --name release-<revision>
gh attestation verify oci://<web ref@sha256> --repo ENGGP/thunderstrux
```

Then deploy with `--manifest release.json` (Pilot host below). Both packages are public, like the repository: a host pulls them by digest with no registry login. The images hold no secrets. The first publication was run 39887918318 on `9788d6d`, 23 Oct 2026.

## Pilot host

Chosen 23 Oct 2026 (T43b): one **DigitalOcean Droplet in Sydney (syd1)** runs the release pair with Docker Compose. These managed services sit in the same region:
- **PostgreSQL 16:** daily backups and point-in-time recovery;
- **Valkey:** Redis-compatible, for rate limiting;
- **Spaces:** S3-compatible storage for society assets.

Data stays in Australia, the database is managed, and the hosted Compose contract runs unchanged. Nothing has been bought yet; H01 does that.

**Expected cost:** about USD 55–60 a month (check current prices before buying):

| Item | Plan | Cost a month |
| --- | --- | --- |
| Droplet | 2 vCPU / 4 GiB | $24 |
| Managed PostgreSQL | 1 GiB | $15 |
| Managed Valkey | 1 GiB | $15 |
| Spaces | — | $5 |
| Domain | — | not included |

**On the Droplet** (all versioned in `deploy/droplet/`):
- **`cloud-init.yml`:** first-boot setup.
  - Ubuntu 24.04 LTS and Docker Engine with the Compose plugin.
  - A `deploy` user with uid 1000 (the containers' user); SSH keys only, root login off.
  - ufw allowing only SSH, 80 and 443.
  - Automatic security updates without automatic reboots, and Docker log rotation.
  - The `/opt/thunderstrux`, `/etc/thunderstrux/secrets` and `/var/lib/thunderstrux/backups` folders.
- **`docker-compose.droplet.yml`:** applied over `docker-compose.hosted.yml`, `docker-compose.assets.hosted.yml` and `docker-compose.schedules.yml`.
  - **Caddy** is the only public service: automatic Let's Encrypt HTTPS, a 6 MB request limit and compression.
  - It sets `X-Thunderstrux-Client-IP` from the connection on every request, and the app trusts only that header for rate limiting (SEC-002). Incoming `X-Forwarded-For` is dropped.
  - **Secrets:** each one is a file in `/etc/thunderstrux/secrets`, owned by uid 1000 with mode 0400, because plain Compose can't read Swarm's external secrets.
  - **Backups:** a `backup` tool (PostgreSQL 16 client) writes a checked `pg_dump` before every migration.
- **`Caddyfile`** and **`config.env.example`:** the non-secret settings, which become `/opt/thunderstrux/config.env`.

**Deploying** (from a laptop or CI, over SSH as `deploy`):

```bash
node scripts/release-pair.mjs --web <web ref@sha256> --ops <ops ref@sha256> --out release.json
pnpm ops:droplet -- deploy --host deploy@<droplet-ip> --manifest release.json --smoke-url https://<domain>
pnpm ops:droplet -- status --host deploy@<droplet-ip>
pnpm ops:droplet -- rollback --host deploy@<droplet-ip> --compatibility-file rollback.json --smoke-url https://<domain>
```

A deploy always runs in this order:
1. Validate the manifest (registry digests only).
2. Upload the release's Compose bundle to `/opt/thunderstrux/releases/<name>`.
3. Pull both images by digest.
4. Check the merged config against the hosted contract.
5. Stop the workers.
6. Back up the database.
7. Migrate once from the ops image.
8. Start the new web release and wait for its healthcheck.
9. Start Caddy, then the workers on the new ops image.
10. Check readiness through HTTPS.
11. Record `current` and `previous`.

If the web release never becomes ready after migrating, the deploy stops the app and leaves writers stopped for inspection, as the single-host runner does.

**Rollback** switches the web image and the workers back to the previous release. It needs a reviewed declaration (`candidateImageId`, `previousImageId`, `migrationDigest`, `reviewed: true`) saying the older code was tested against the current schema; without one it refuses.

**Rehearsal.** `pnpm ops:droplet:rehearse` runs the real commands with `--local`: this machine stands in for the Droplet, and throwaway containers stand in for the managed PostgreSQL (a `_test` database) and Valkey. It:
- deploys a release through Caddy's HTTPS and checks the step order, the backup, every container's image and the scheduled monitor;
- upgrades to a second release;
- shows rollback refused without a declaration, then accepted with one;
- shows a release that can't become ready (Valkey down) leaving the app and workers stopped and the recorded release unchanged.

It removes every container, volume, network, image and folder it made.

**H01 checklist** (once the pilot is approved and paid for):
1. **Domain:** choose it, and set an A record for it to a DigitalOcean reserved IP.
2. **Databases** in syd1:
   - PostgreSQL 16, 1 GiB, a database `thunderstrux` with its own user, TLS required (`sslmode=require` in the URL);
   - Valkey, 1 GiB;
   - for both, add only the Droplet as a trusted source.
3. **Spaces:** create a syd1 bucket and an access key limited to it.
4. **Droplet:** Ubuntu 24.04, 2 vCPU / 4 GiB, in syd1 and on the databases' VPC. Use `cloud-init.yml` with the deploy key, then assign the reserved IP.
5. **Config:** write `/opt/thunderstrux/config.env` from `config.env.example`.
6. **Secrets:** write each secret file in `/etc/thunderstrux/secrets`, then `chown 1000:1000` and `chmod 0400` them.
   - Back up `MFA_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY` and `AUTH_SECRET` separately; see the Recovery runbook.
   - The alert webhook goes to the chosen receiver (OPS-002).
7. **Deploy:** take `release.json` from the release workflow's artifact for the chosen `main` commit (T43c), check it with `gh attestation verify`, then run the first deploy with `--smoke-url`. The packages are public, so the Droplet needs no registry login.
8. **Stripe and Resend:** create the two Stripe webhook endpoints at the new URL as described in Stripe webhook endpoints and keys below, and point the Resend domain at it.

**Rebuilding a lost Droplet.** No data lives on it, so:
1. Create a new one from `cloud-init.yml`.
2. Restore `config.env` and the secret files from their backups.
3. Deploy the recorded `current` release's manifest.
4. Move the reserved IP to it.

The pre-migration dumps on the old Droplet are lost with it; DigitalOcean's own backups remain.

**Restoring the database** uses DigitalOcean's point-in-time restore into a new cluster. Follow the Recovery runbook (pause workers, verify, reconcile) before pointing `database_url` at it.

**Docker and ufw.** Ports published by Docker bypass ufw; only Caddy publishes any.

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
every minute: node scripts/process-compensation-refunds.mjs   # also resolves ordinary refunds (T18a) and takes back lost disputes (PAY-004)
every minute: node scripts/process-checkout-attempts.mjs   # ticket and commerce attempts (T21)
every minute: node scripts/process-notifications.mjs   # also fans out event changes and queues membership reminders (T30), and deletes tokens 30 days past expiry, 500 a run (T39)
every minute: node scripts/process-operations-monitor.mjs   # queue backlog, oldest age, stuck items and stale jobs (T42)
```

## Stripe webhook endpoints and keys

Create both endpoints in Stripe Workbench (live mode for production, test mode for staging), as **snapshot** endpoints with API version **`2026-03-25.dahlia`**, the version the app pins (`lib/stripe/index.ts`). An endpoint left on the account's default version sends events shaped for another version. An endpoint's version can't be changed later: moving the app to a new version means creating new endpoints and retiring the old ones.

| Endpoint | Listens to | Events | Secret |
| --- | --- | --- | --- |
| `https://<app>/api/payments/webhook` | Your account | `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` | `STRIPE_WEBHOOK_SECRET` |
| `https://<app>/api/stripe/connect/webhook` | Connected accounts | `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Subscribe only these events. After creating them, check the endpoint list shows the pinned version, then send a test event to each and confirm HTTP 200 in Workbench's Event deliveries.

**Key.** Use a restricted key (`rk_live_…`) rather than the secret key, with only what the app calls: Checkout Sessions (write: create, retrieve, list, expire), PaymentIntents and Charges (read), Refunds (write), Disputes (read), and Connect accounts, account links and login links (write). Create it in test mode first and run the staging campaign with it: a `403` in Workbench's request logs names a missing permission. Keep it in the `stripe_secret_key` secret file; roll it when someone with access leaves.

**Optional.** The proxy may also accept webhook requests only from [Stripe's published IP addresses](https://docs.stripe.com/ips); signature checks stay the real protection.

**Disputes.** On destination charges the platform answers every dispute in Stripe's Dashboard, before the evidence due date that `purchase_dispute_opened` reports. The dispute amount and Stripe's dispute fee come out of the platform's balance. Once a dispute is lost the refunds worker takes the amount back from the society's transfer (PAY-004, see [[Payment Lifecycle]]); the dispute fee stays with the platform.

## Workers, schedules and alerts

Since T42 every scheduled command runs under one contract (`lib/ops/worker.ts`):

- **One run at a time.** Each job has a row in `WorkerLease`: email-outbox, notifications, stale-orders, refunds, checkout-recovery and monitor. A run takes that row's lease. A second run while the lease is held exits at once (`worker.skipped_running`), on any host. The lease lasts the timeout plus 30 seconds, so the next run reclaims a crashed run's lease (`worker.lease_reclaimed`). Item-level leases inside each queue still requeue the items a lost run had claimed.
- **Pause.** Use `pnpm ops:workers -- pause <job|all> --reason="..."` and `resume <job|all>`. A paused job's runs exit without doing work (`worker.paused`). Pausing doesn't stop a run in progress: before a restore, check that `pnpm ops:workers -- status` shows nothing `running`. The pause lives in the database. A backup taken before the pause doesn't carry it, so `pnpm ops:restore` pauses every worker in each restored copy itself (T44c).
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
| `queue_backlog_high` dispute reversals | a lost dispute hasn't been taken back from the society within an hour of closing | Check the refunds job and the transfer's reversals in Stripe. Never reverse by hand while one is uncertain. |
| `dispute_reversal_unresolved` | a lost dispute can't be taken back (no transfer, another account, nothing left, Stripe refused) or is still unknown after six tries | Look at the dispute's charge and transfer in Stripe's Dashboard and reverse or write it off by hand; record what was done on the order. |
| `queue_backlog_high` ticket holds | an expired hold is still active 10 minutes later | Check the stale-orders job; the held stock stays unavailable until it runs. |
| `queue_backlog_high` commerce checkouts | a pending commerce checkout is 30 minutes past its expiry | Check the stale-orders job. |
| `queue_processing_stuck` | an item has been processing for over 15 minutes | Lease recovery should requeue it; if it doesn't, inspect the item before requeueing. |

## Recovery runbook

1. **Stop writes.** Stop the app (or put the platform into maintenance) and run `pnpm ops:workers -- pause all --reason="Recovery <date>"`. Wait until `status` shows no job running. Stopping the scheduled services also stops them.
2. **Restore separately.** Restore into a new `_restore_test` database (see Backup And Restore below) with no Stripe or Resend credentials, so nothing restored can charge, refund or email. Restore verification runs the integrity audit (T41), then the restore pauses every worker in the copy (T44c).
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

Restore verifies metadata ownership, checksum, archive completion, grants through application credentials, migration history, representative domain reads and, since T41, the integrity audit with no unexplained violations.

**Fencing (T44c).** A verified copy then has every worker paused in it, with a reason naming the archive. The copy can hold refunds, emails or checkouts the old database already sent to a provider without hearing back. Nothing runs until someone reconciles the providers and runs `pnpm ops:workers -- resume all` against it.

On resume, each job checks the provider before acting:
- the refund worker looks for its own refund at Stripe first, and otherwise creates one under the request's fixed idempotency key;
- checkout recovery replays the same Stripe key;
- outbox jobs send with their own provider keys.

`recovery-fencing.test.ts` proves no second refund results. A copy that can't be fenced (for example, one restored from a schema older than worker leases) is quarantined like a failed one. Failed targets remain quarantined and are never promoted.

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
