---
status: living
last-reviewed: 2026-10-09
owner: engineering
related: ["[[Project Handover]]", "[[Database and Multi Tenancy]]"]
sources: [scripts/operations.mjs, docker-compose.hosted.yml, scripts/run-operations-tests.mjs]
---

# Production Operations

## Current Status

P2.17 repository-side operations are implemented and locally rehearsed. The repository provides local Docker validation, optional manual GitHub workflows, liveness/readiness endpoints, non-root production containers, a single migration job, guarded deployment, PostgreSQL backup/restore, and compatibility-gated application rollback.

The hardened repository contract is `docker-compose.hosted.yml`. It consumes a prebuilt immutable `APP_IMAGE`, external PostgreSQL and Redis URLs, and file-backed secrets; it contains no database, Redis, source bind mount, or image build. The application, migration, and workers run non-root with a read-only root filesystem, dropped capabilities, no-new-privileges, bounded PIDs, explicit CPU/memory limits, and reviewed writable `tmpfs` paths. Validate a deployment environment with `pnpm docker:hosted:check -- --env-file <path>` before rollout.

This is not evidence of a live production deployment. Hosting, external health monitoring and alert delivery, off-machine encrypted backups, recovery objectives, and the platform scheduler remain deployment-time work.

## Health

- `GET /api/health` is liveness only and preserves the public `{status: "ok", service: "thunderstrux"}` contract.
- `GET /api/health/ready` returns `200` only when the release's required migration is completed and not rolled back, an application-table query succeeds, MFA/legacy-access configuration is valid, and Redis responds when rate limiting is enabled, and the notification encryption key is valid. It returns a public-safe `503` otherwise and is never cached.
- The image healthcheck calls readiness on `PORT`, defaulting to `3000`. An unhealthy container is a signal; Docker Compose does not automatically replace it.

## Deployment

The `pnpm ops:*` commands below are the existing single-host and recovery-rehearsal path. They use the base Compose stack with its PostgreSQL/Redis services and local backup tooling. They do not deploy `docker-compose.hosted.yml`. A managed hosted rollout must implement the same migration, backup, readiness, writer-shutdown, and compatibility-gated rollback order through provider-specific jobs after the hosted activation gates are verified.

Use a unique immutable release name and an explicit environment file:

```powershell
pnpm ops:deploy -- --project p217-thunderstrux --env-file .env.production --url http://127.0.0.1:3000 --release <git-sha>
```

The runner acquires a target lock, builds one image, identifies any current app, stops writers, creates a pre-migration backup, runs `prisma migrate deploy` once, starts the candidate, and performs read-only smoke checks. It records image IDs and migration checksums under ignored, access-restricted `tmp/operations/<project>/` state. Ordinary app restarts never run migrations.

Pause the platform schedules before deployment. Resume them only after readiness succeeds. Compose exposes the same bounded jobs through the `workers` profile, while a hosted scheduler should invoke the corresponding service every minute with overlap prevention, timeout, alerts, and backlog monitoring:

```text
every minute: node scripts/process-email-outbox.mjs
every minute: node scripts/process-stale-orders.mjs
every minute: node scripts/process-compensation-refunds.mjs
every minute: node scripts/process-notifications.mjs
```

A backup failure occurs before migrations and allows the unchanged release to restart. Once migration begins, a failure leaves writers stopped for inspection. Never use `prisma migrate reset` or automatically mark a failed migration resolved.

## Rollback

Code rollback does not restore the database. It requires a reviewed JSON declaration containing `candidateImageId`, the running `previousImageId`, the exact `migrationDigest`, and `reviewed: true`. Use `--compatibility-file <path>` only after the previous image has been tested against the upgraded database. Missing or mismatched evidence disables automatic rollback.

The runner restores the previous unique image reference and its protected environment snapshot once. A shared database or Redis outage must be repaired instead of causing repeated image rollback.

## Backup And Restore

Create a custom-format PostgreSQL backup:

```powershell
pnpm ops:backup -- --project p217-thunderstrux --env-file .env.production
```

Archives and metadata are written atomically under `tmp/operations/<project>/`, include a SHA-256 checksum and migration digest, and retain the latest seven successful backups. Move production backups to encrypted off-machine storage; local archives are not disaster protection.

Restore only into a new database ending in `_restore_test`:

```powershell
pnpm ops:restore -- --project p217-thunderstrux --env-file .env.production --archive <archive.dump> --target-database recovery_restore_test
```

Restore verifies metadata ownership, checksum, archive completion, grants through application credentials, migration history, and representative domain reads. Failed targets remain quarantined and are never promoted.

For disaster recovery, stop app writers and workers, restore into a new database, verify without Stripe/Resend credentials, reconcile Stripe payments, refunds and webhook delivery, inspect email-outbox and compensation-refund jobs, switch the application deliberately, and then resume workers. A database restore cannot reverse external charges, refunds, transfers, or email sends.

## Validation

`pnpm ops:test` runs guard tests and a disposable Docker rehearsal. It verifies non-root execution, read-only filesystem behavior, writable temporary paths, dropped capabilities, no-new-privileges, resource limits, file-backed secret loading and conflict rejection, all four bounded workers, migration blocking, database/Redis health failures, custom-format backup, corrupt-archive quarantine, restored domain records, explicit rollback compatibility, and resource ownership cleanup. The GitHub `operations-tests` job runs the same rehearsal without production credentials.

For dependency/container changes, local validation follows [[Engineering Delivery Workflow]]: review affected Compose contracts, lint changed Dockerfiles, build the production target and scan fixable high/critical vulnerabilities when that boundary changes. The optional manual static-validation workflow provides the same checks; it is not a merge requirement. Temporary vulnerability exceptions are prohibited unless they identify the CVE, reason, owner, and expiry in the issue register and workflow configuration.

Digest pinning also retains the base image's installed OS packages. The application Dockerfile explicitly installs `libpcre2-8-0` from Debian's security repository alongside its runtime prerequisites, so rebuilding upgrades the inherited library. The 2026-10-04 scan found CVE-2026-103111 in `10.42-1+deb12u1`; Debian's fixed Bookworm package is `10.42-1+deb12u2`. Verify the installed version and scan the final `runner` image after security package changes; do not bypass the vulnerability gate. See the [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-103111).

Direct environment variables remain supported for development and legacy deployment. Production secret stores should mount files and set the matching `_FILE` variables for `DATABASE_URL`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `RATE_LIMIT_REDIS_URL`, Stripe credentials, and `RESEND_API_KEY` and `NOTIFICATION_ENCRYPTION_KEY`. Supplying both forms, an unreadable or relative file, or an empty file fails startup without printing the secret.

## Account Closure Release Compatibility

Migration 20261005030000_account_closure adds permanent User closure markers, immutable Order buyer contact captures and integrity constraints. Run the one-shot migration before app/worker rollout. No legacy account is automatically closed and no historical purchase-time identity is invented. A user-initiated closure anonymises login/profile irreversibly through the app while preserving business/audit/security and buyer contacts. Database backups consequently contain retained personal information and require the existing access/encryption/retention controls.

Before rollback to an older app/worker, pause closure/account mutations and buyer contact/ticket email flows: older images do not resolve retained snapshots or fence staff/MFA credential races. Restoring a backup into a disposable _restore_test database verifies records/constraints; restoring old non-disposable data would be a separate explicit recovery decision and must not silently reactivate closed accounts. Independent review before activation remains required. Development and production stacks are not deployed by local qualification.

## Private invitation rollout and recovery

Apply `20261009010000_private_staff_invites` once before rolling out app and notification workers. Preserve and separately back up the notification key: database-only restoration cannot decrypt invitations. The disposable operations rehearsal verifies a version-linked encrypted invitation survives backup/restore and decrypts with the recovered run key, alongside deployment, migration and rollback guards. Additive columns can remain after code rollback, but pause invitation acceptance and delivery before rolling back to code lacking version/role-preservation checks. Existing pre-migration digests remain redeemable only under the new guards; no recovery mail is fabricated. Repository delivery does not activate development or hosted stacks; independent security/migration review and real provider acceptance remain separate gates.
