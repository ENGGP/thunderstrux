---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Production Operations]]", "[[Pre-hosting Candidate]]", "[[Dependency Automation]]", "[[Database and Multi Tenancy]]"]
sources: [docker/Dockerfile, scripts/release-pair.mjs, .github/workflows/release.yml, deploy/droplet/docker-compose.droplet.yml, deploy/droplet/Caddyfile, scripts/droplet.mjs, scripts/rehearse-droplet.mjs, scripts/run-operations-tests.mjs]
---

# Production Operations Hosting

**Owns:** the release image pair and its publication, the pilot host (Droplet) and its deploy, rollback and rehearsal, the integrity and asset tools, and the operations rehearsal.
**Read when:** building or publishing images, deploying to the Droplet, running `pnpm ops:test`, or using the integrity and asset commands.
**Not here:** workers, alerts, backup and recovery, the single-host runner and Stripe endpoints ([[Production Operations]]); release gates ([[Pre-hosting Candidate]]); image scanning policy ([[Dependency Automation]]).

## Release images

Every release is two images built from one revision by `docker/Dockerfile`:

| Stage | Contents | Runs | Healthcheck |
| --- | --- | --- | --- |
| `web` | Next's standalone server and static assets (incl. Prisma engine, sharp) | `node server.js` | readiness on `PORT` (default 3000) |
| `ops` | production dependencies (Prisma CLI is one), `lib`, `scripts`, `prisma`, `config`, `auth.ts` | default `prisma migrate deploy`; every worker, seeds, integrity audit, restore verification, asset tools | none; serves nothing |
| `development` | full dependency tree | `docker-compose.dev.yml` only | — |

- Neither release image has pnpm, npm or Corepack. Both run as `node` through `docker/entrypoint.sh`.
- No origin is built in: the server reads `NEXT_PUBLIC_APP_URL` at run time (`lib/app-url.ts`), so one image serves any domain.
- The OS layer refreshes `ca-certificates libpcre2-8-0 openssl perl-base` from Debian's security repository on every build, so a rebuild picks up base-image CVE fixes the digest pin would otherwise keep.
- **Budgets** (`imageBudgets`, uncompressed sum of `docker history` layers): web 600 MiB, ops 1 GiB. Raise one only with a measured reason and an owner recorded here.
- **Manifest:** `node scripts/release-pair.mjs --web <image> --ops <image> [--web-ref <ref@sha256> --ops-ref <ref@sha256>] [--out file]` records the full revision, each image's id and size, `requiredMigration` (from `config/schema-contract.json`) and the migration chain digest. It refuses a pair over budget, one image twice, a missing revision or chain, and published refs in the same repository.

**Publication (SEC-022).** `.github/workflows/release.yml` runs on every push to `main`: build the pair once, check budgets, Trivy-scan both (fixable high/critical fails), record SPDX SBOMs, push the same images to `ghcr.io/enggp/thunderstrux` and `ghcr.io/enggp/thunderstrux-ops` as `sha-<revision>`, attach signed build-provenance and SBOM attestations, and upload artifact `release-<revision>` (`release.json` with registry digests, plus SBOMs; 90 days). A second job pulls both by digest, matches them to the manifest, runs `gh attestation verify` on each and smoke-tests them. Pull requests touching the images, and manual runs off `main`, build, budget, scan and SBOM only, uploading `scan-<revision>`. Only `main` publishes and attests.

Both packages are public; a host pulls by digest without logging in. The images hold no secrets.

To take a release:

```bash
gh run list --workflow release.yml --branch main          # pick the run of that main commit
gh run download <run-id> --repo ENGGP/thunderstrux --name release-<revision>
gh attestation verify oci://<web ref@sha256> --repo ENGGP/thunderstrux --signer-workflow ENGGP/thunderstrux/.github/workflows/release.yml --source-ref refs/heads/main
gh attestation verify oci://<ops ref@sha256> --repo ENGGP/thunderstrux --signer-workflow ENGGP/thunderstrux/.github/workflows/release.yml --source-ref refs/heads/main
```

Select by run id, never by artifact name alone: any workflow run can upload an artifact with that name.

## Pilot host

One DigitalOcean Droplet in Sydney (`syd1`) runs the release pair with Docker Compose, beside managed PostgreSQL 16, managed Valkey (Redis-compatible, for rate limiting) and Spaces (S3-compatible, for society assets) in the same region. Nothing lives on the Droplet that isn't rebuilt from a backup. Not yet bought (H01).

| File (`deploy/droplet/`) | What it sets |
| --- | --- |
| `cloud-init.yml` | Ubuntu 24.04, Docker Engine + Compose plugin; user `deploy` uid 1000, SSH keys only, root login off; ufw allowing only 22, 80 and 443 (TCP and UDP); unattended security updates without reboots; Docker log rotation; `/opt/thunderstrux`, `/etc/thunderstrux/secrets`, `/var/lib/thunderstrux/backups` |
| `deploy/droplet/docker-compose.droplet.yml` | Applied over `docker-compose.hosted.yml`, `docker-compose.assets.hosted.yml`, `docker-compose.schedules.yml`. Adds `caddy` (only service publishing ports), the `backup` tool (`postgres:16` client, `tools` profile), json-file log limits, and turns every external secret into a file in `THUNDERSTRUX_SECRETS_DIR` (plain Compose can't read Swarm secrets) |
| `Caddyfile` | `SITE_ADDRESS` with Let's Encrypt via `ACME_EMAIL`; zstd/gzip; 6 MB request body cap (5 MiB images plus form overhead); `header_up X-Thunderstrux-Client-IP {remote_host}` and drops `X-Forwarded-For`; JSON access log |
| `config.env.example` | The non-secret `/opt/thunderstrux/config.env`: origins, `MFA_ENFORCEMENT_MODE=enforce`, `LEGACY_ORGANISATION_ACCESS_MODE=deny`, rate-limit prefix, `EMAIL_FROM`, Spaces endpoint/bucket/region, CPU/memory/PID limits sized for 2 vCPU / 4 GiB |

- The app trusts only `X-Thunderstrux-Client-IP` for rate limiting (`RATE_LIMIT_TRUSTED_PROXY_HEADER` is forced to it; SEC-002).
- Secrets are files in `/etc/thunderstrux/secrets`, owned by uid 1000, mode 0400.
- Docker-published ports bypass ufw; only Caddy publishes any.

**Commands** (laptop or CI, SSH as `deploy`):

```bash
node scripts/release-pair.mjs --web <web ref@sha256> --ops <ops ref@sha256> --out release.json
pnpm ops:droplet -- deploy   --host deploy@<ip> --manifest release.json --smoke-url https://<domain>
pnpm ops:droplet -- status   --host deploy@<ip>
pnpm ops:droplet -- rollback --host deploy@<ip> --compatibility-file rollback.json --smoke-url https://<domain>
```

Options: `--project` (default `thunderstrux`), `--release` (default first 12 of the revision), `--to` (rollback target, default `previous`), `--readiness-attempts` (default 60, 2 s apart), `--no-pull`, `--extra-compose`, `--insecure-smoke`, and `--local <dir>` in place of `--host` (runs the steps on this machine; the rehearsal uses it). A real host refuses images outside the two `ghcr.io/enggp/…` repositories (`releaseRepositories`, SEC-022) and anything not pinned by digest.

**Deploy order** (`deploySteps`): `validate` → `upload` (the Compose bundle, `release.json`, `images.env` to `/opt/thunderstrux/releases/<name>`) → `pull` → `check-config` (`validateHostedConfig`; only Caddy may publish ports) → `stop-workers` → `backup` → `migrate` → `start-web` → `wait-ready` (container healthcheck) → `start-edge` → `start-workers` → `smoke` (HTTPS readiness through Caddy; only with `--smoke-url`) → `record` (`current`, `previous`). A release already `current` is refused. If the web never becomes healthy after migrating, it stops `app` and leaves writers stopped for inspection.

**Rollback** switches web and workers to `previous` (or `--to`) without touching the schema. It requires a reviewed declaration ([[Production Operations#Backup, restore and rollback]]) matching the running and target web ids and the running release's migration digest.

**Status** prints `current`/`previous`, each service's state and `scripts/workers.mjs status` run in the `migration` container.

**Rehearsal** (`pnpm ops:droplet:rehearse`, run id `droplet-<10 hex>`): this machine stands in for the Droplet, throwaway containers stand in for managed PostgreSQL (a `_test` database) and Valkey. It deploys through Caddy HTTPS and checks step order, the backup, every container's image and the scheduled monitor; upgrades to a second release; shows rollback refused without a declaration and accepted with one; shows a release that can't become ready (Valkey down) leaving app and workers stopped and `current` unchanged. It removes everything it made.

**H01 checklist** (once the pilot is paid for):
1. Domain: A record to a DigitalOcean reserved IP.
2. In `syd1`: PostgreSQL 16 (database `thunderstrux`, its own user, `sslmode=require`), Valkey; each trusts only the Droplet.
3. Spaces bucket in `syd1` with an access key limited to it.
4. Droplet (Ubuntu 24.04, 2 vCPU / 4 GiB, on the databases' VPC) from `cloud-init.yml` with the deploy key; assign the reserved IP.
5. Write `/opt/thunderstrux/config.env` from `config.env.example`.
6. Write each secret file, `chown 1000:1000`, `chmod 0400`. Back up `MFA_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY` and `AUTH_SECRET` separately. Point the alert webhook at the chosen receiver (OPS-002).
7. Take and verify `release.json` (Release images above), then deploy with `--smoke-url`.
8. Create both Stripe webhook endpoints ([[Production Operations#Stripe webhook endpoints and keys]]); point the Resend domain at the host.

**Rebuilding a lost Droplet:** create one from `cloud-init.yml`, restore `config.env` and the secret files, deploy the recorded `current` manifest, move the reserved IP. The Droplet's own pre-migration dumps are lost with it; DigitalOcean's backups remain.

**Restoring the managed database:** DigitalOcean point-in-time restore into a new cluster, then [[Production Operations#Failure and recovery]] (fence, pause, reconcile) before pointing `database_url` at it.

## Integrity and asset tools

| Command | Does |
| --- | --- |
| `pnpm db:integrity:audit` (`scripts/audit-db-integrity.mjs`) | runs `lib/ops/integrity-audit.ts`; prints each check's class, count, sample ids and recommendation; exits 1 on any unexplained violation (explained legacy rows report only). Checks: [[Database and Multi Tenancy]] |
| `pnpm db:organisation-drift:repair` (`scripts/repair-organisation-drift.mjs`) | dry run of `lib/db/organisation-drift.ts` (denormalised organisation ids that disagree with their event); `--apply` repairs, after a verified backup |
| `pnpm assets:maintain` (`scripts/maintain-assets.mjs`) | dry run of `lib/assets/maintenance.ts`; `--apply`, `--integrity` or `--objects` (one at a time), `--cursor <c>` to page |
| `scripts/rehearse-assets.mjs` | operations-rehearsal only: `seed`/`remove`/`restore`/`verify` an asset and its object; refuses any database but an integration `_test` one and any store but the rehearsal's |

## Validation

`pnpm ops:test` = `tests/runner/operations.test.mjs` then `scripts/run-operations-tests.mjs`, a disposable Compose project `ops-<10 hex>` (`ops` user, `ops_app_test` database, `docker-compose.operations.yml` adding `object-store`, `asset-tools` and `alert-capture`). It deploys a release pair and checks the manifest; verifies non-root, read-only root, tmpfs paths, dropped capabilities, no-new-privileges, limits, 30 s stop period, SIGTERM forwarding and secret-file loading and rejection without leaking values; runs all six workers and the worker contract (pause, overlap skipped, lease reclaimed, a failure alert and exactly one stale-job alert received); seeds (`scripts/seed-operations-verification.mjs`), audits integrity and asset integrity, rehearses asset removal and restore; backs up, quarantines a corrupt archive, restores, fences identity and pauses workers; rolls back with a declaration; blocks a failed migration with the app left stopped; then removes everything it created (part of the test). `.github/workflows/operations.yml` runs the same, manual-only.

For Dockerfile, Compose or dependency changes choose validation by [[Engineering Delivery Workflow]]: lint changed Dockerfiles, check affected Compose contracts (`pnpm docker:hosted:check -- --env-file <file>`), build the pair and scan for fixable high/critical vulnerabilities ([[Dependency Automation]]). A vulnerability exception needs the CVE, reason, owner and expiry in the register and workflow.

## Related

[[Production Operations]] · [[Pre-hosting Candidate]] · [[Dependency Automation]] · [[Database and Multi Tenancy]] · [[Society Profiles and Assets]] · [[Engineering Delivery Workflow]]
