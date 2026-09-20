# Production Operations

## Current Status

P2.17 repository-side operations are implemented and locally rehearsed. The repository provides deterministic CI, an operations validation workflow, liveness/readiness endpoints, non-root production containers, a single migration job, guarded deployment, PostgreSQL backup/restore, and compatibility-gated application rollback.

This is not evidence of a live production deployment. Hosting, external health monitoring and alert delivery, off-machine encrypted backups, recovery objectives, and the platform scheduler remain deployment-time work.

## Health

- `GET /api/health` is liveness only and preserves the public `{status: "ok", service: "thunderstrux"}` contract.
- `GET /api/health/ready` returns `200` only when an application-table query succeeds and Redis responds when rate limiting is enabled. It returns a public-safe `503` otherwise and is never cached.
- The image healthcheck calls readiness on `PORT`, defaulting to `3000`. An unhealthy container is a signal; Docker Compose does not automatically replace it.

## Deployment

Use a unique immutable release name and an explicit environment file:

```powershell
pnpm ops:deploy -- --project p217-thunderstrux --env-file .env.production --url http://127.0.0.1:3000 --release <git-sha>
```

The runner acquires a target lock, builds one image, identifies any current app, stops writers, creates a pre-migration backup, runs `prisma migrate deploy` once, starts the candidate, and performs read-only smoke checks. It records image IDs and migration checksums under ignored, access-restricted `tmp/operations/<project>/` state. Ordinary app restarts never run migrations.

Pause the platform schedules before deployment. Resume them only after readiness succeeds:

```text
every minute: node scripts/process-email-outbox.mjs
every minute: node scripts/process-stale-orders.mjs
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

For disaster recovery, stop app writers and workers, restore into a new database, verify without Stripe/Resend credentials, reconcile Stripe payments and webhook delivery, inspect email-outbox eligibility, switch the application deliberately, and then resume workers. A database restore cannot reverse external charges or email sends.

## Validation

`pnpm ops:test` runs guard tests and a disposable Docker rehearsal. It verifies non-root execution, migration blocking, database/Redis health failures, custom-format backup, corrupt-archive quarantine, restored domain records, explicit rollback compatibility, and resource ownership cleanup. The GitHub `operations-tests` job runs the same rehearsal without production credentials.
