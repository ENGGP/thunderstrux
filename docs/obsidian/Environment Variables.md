---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Development Workflow]]", "[[Production Operations]]", "[[E2E and Staging Payments]]", "[[Route Security Inventory]]", "[[Authentication and Dashboard Access]]"]
sources: [docker-compose.yml, docker-compose.dev.yml, docker-compose.hosted.yml, docker/entrypoint.sh, .env.example, .env.hosted.example, deploy/droplet/config.env.example, lib/app-url.ts]
---

# Environment Variables

**Owns:** every environment variable the code, Compose files and images read: who reads it, what it does, its default, where it is required, and `_FILE` support.
**Read when:** adding or changing a variable, configuring a stack, or explaining a 503 or refusal that comes from configuration.
**Not here:** how to run the stacks ([[Development Workflow]], [[Production Operations]]); rate-limit numbers and the trusted-origin rule ([[Route Security Inventory]]); runner internals ([[E2E and Staging Payments]]).

## Code

| Concern | Where |
| --- | --- |
| Compose interpolation and defaults | `docker-compose.yml` (base), `docker-compose.dev.yml`, `docker-compose.hosted.yml`, `docker-compose.assets.hosted.yml`, `docker-compose.e2e.yml`, `deploy/droplet/docker-compose.droplet.yml` |
| `_FILE` secrets | `docker/entrypoint.sh` (release images `web` and `ops` only) |
| Public origin read at run time | `lib/app-url.ts`: `appUrl()` |
| Examples | `.env.example`, `.env.db.example`, `.env.hosted.example`, `deploy/droplet/config.env.example` |

## Rules

- **Required** column: **dev** = the dev stack (base + dev override); **hosted** = `docker-compose.hosted.yml` (plus the Droplet overlay); **tests** = integration setup or the E2E runner. "compose" means Compose refuses to start without it (`${VAR:?}`).
- **`_FILE`**: `docker/entrypoint.sh` loads `DATABASE_URL`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `NOTIFICATION_ENCRYPTION_KEY`, `RATE_LIMIT_REDIS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ASSET_STORAGE_ACCESS_KEY`, `ASSET_STORAGE_SECRET_KEY` and `ALERT_WEBHOOK_URL` from `<NAME>_FILE`. The path must be absolute, a readable regular file, and non-empty; setting both `NAME` and `NAME_FILE` exits with a configuration error. The dev image (`development` target) has no entrypoint, so `_FILE` is unsupported there.
- **Dev `.env` loading:** Compose passes only the variables its file lists. In the dev stack `next dev` also reads the bind-mounted `.env` for anything Compose left unset. Prisma Client does the same when it loads, which is why `tests/setup/integration.setup.ts` pins every behaviour switch. Release images contain no `.env` (`.dockerignore`).
- **`NEXT_PUBLIC_APP_URL` is read through a computed key** (`lib/app-url.ts`) so `next build` cannot inline it; one image serves any domain (T44d). Don't add literal `process.env.NEXT_PUBLIC_APP_URL` reads.
- A new variable needs: the code read, a row here, the Compose service(s) that pass it, and the matching example file.

## App runtime and URLs

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `next.config.ts`, `lib/db/index.ts`, `lib/stripe/index.ts`, `lib/security/staff-mfa.ts`, `lib/staff/live-authority.ts`, `lib/auth/public-origin.ts`, `lib/ops/logger.ts`, `lib/ops/alerts.ts`, `lib/email/ticket-email-outbox.ts`, `app/success/page.tsx`, `scripts/prepare-next-build.mjs`, `scripts/doctor-dev.mjs` | `production` in release images and base/hosted Compose, `development` in dev, `test` from the integration runner. `production` selects `.next-build` and standalone output, HSTS and a strict CSP, live Stripe keys, secure app cookies, strict MFA/legacy defaults, and disables the dev checkout fallback. `development` turns on Prisma query logs. | set by images and Compose | no |
| `PORT` | Next server (`server.js`), web image healthcheck | Container port; default `3000`. | no | no |
| `HOSTNAME` | Next standalone server | `0.0.0.0` in the web image. | no | no |
| `APP_PORT` | Compose | Host port on `127.0.0.1`; default `3000` (base), `3200` (`docker-compose.operations.yml`). `.env.example` sets `3080`. | no | no |
| `NEXT_PUBLIC_APP_URL` | `lib/app-url.ts` (via `appUrl()`), `prisma/seed.mjs` | Public origin: trusted origin for writes, email and notification links, Stripe return URLs (`getAppUrl()` falls back to `http://localhost:3000`). | dev and hosted: compose; also the email and notification workers | no |
| `AUTH_URL` | `lib/auth/public-origin.ts`, `prisma/seed.mjs`, Auth.js | Auth.js public URL. Its `https:` scheme makes `proxy.ts` and the app read and set secure (`__Secure-`) cookies even when TLS ends at a proxy. | dev and hosted: compose | no |
| `NEXTAUTH_URL` | `lib/auth/public-origin.ts`, `prisma/seed.mjs`, Auth.js | Fallback for `AUTH_URL`; keep both equal. | dev and hosted: compose | no |
| `TRUSTED_APP_ORIGINS` | `lib/security/request-guard.ts` | Comma-separated extra origins accepted for cookie-authenticated writes and Stripe returns. Unset: only `NEXT_PUBLIC_APP_URL`. | hosted: compose | no |
| `PLATFORM_SUPPORT_EMAIL` | `components/public/policy-page.tsx` | Contact on the Help and Privacy pages; empty or not an email leaves the line out. Base and hosted Compose pass it. | no | no |
| `THUNDERSTRUX_RUNTIME_CONTAINER` | `scripts/prepare-next-build.mjs`, `scripts/doctor-dev.mjs` | `true` (base, hosted) makes `pnpm build` refuse under `NODE_ENV=production`; `false` in dev. The doctor checks only that it is set before inspecting the container's start command. | no | no |
| `THUNDERSTRUX_ALLOW_HOST_DEV` | `scripts/assert-docker-runtime.mjs` | `1` lets `pnpm dev` run outside Docker even when `DATABASE_URL` uses `db:5432`. For one-off host debugging with a `localhost` URL. | no | no |
| `WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING` | Next dev watcher | `true` in the dev override: bind-mount changes are polled. | no | no |
| `NEXT_TELEMETRY_DISABLED` | Next | `1` in `docker/Dockerfile`. | no | no |
| `npm_lifecycle_event` | `lib/auth/secret.ts` | Set by pnpm; `build` lets the build use the fallback auth secret. | no | no |

## Auth and staff security

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `AUTH_SECRET` | `lib/auth/secret.ts` (`auth.ts`, `proxy.ts`), `scripts/run-operations-tests.mjs` | Signs sessions. Empty, `dev-secret`, `replace-with-a-non-empty-secret` and the Dockerfile build value are refused outside tests and builds; production also needs at least 32 characters (SEC-016). Tests and builds fall back to a fixed value. | dev and hosted: compose | yes |
| `MFA_ENFORCEMENT_MODE` | `lib/security/staff-mfa.ts`, `scripts/doctor-dev.mjs` | `off`, `enroll` or `enforce`. Unset is `off` outside production and an error in production (readiness 503). Anything but `off` needs a valid `MFA_ENCRYPTION_KEY` and `RATE_LIMIT_ENABLED=true`. | hosted: compose | no |
| `MFA_ENCRYPTION_KEY` | `lib/security/staff-mfa.ts`, `scripts/doctor-dev.mjs` | Base64 of exactly 32 bytes; encrypts authenticator secrets. Back it up separately; losing it strands enrolments. | when MFA is not `off` | yes |
| `LEGACY_ORGANISATION_ACCESS_MODE` | `lib/staff/live-authority.ts` | `allow` lets an organisation account on `Organisation.accountUserId` act as owner when it has no staff row; `deny` stops it. Unset is `allow` outside production; in production unset or invalid denies and fails readiness. | hosted: compose | no |
| `AUTH_TRUST_HOST` | Auth.js | Set only by `tests/integration/dependency-security.test.ts`. | no | no |

## Database and Redis

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Prisma (`prisma/schema.prisma`), `scripts/assert-docker-runtime.mjs`, `scripts/rehearse-assets.mjs`, `scripts/staging-driver.mjs`, `tests/helpers/db-reset.ts` | PostgreSQL URL. In Compose it uses host `db:5432`; from the host the dev database is `localhost:5433`. The integration runner overwrites it with the resolved `_test` URL. | every app, migration and worker service: compose | yes |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `db` container (`.env.db`), its healthcheck | Database credentials and name; `.env.db.example` uses `thunderstrux` for all three. | dev | no |
| `RATE_LIMIT_ENABLED` | `lib/security/rate-limit.ts`, `lib/security/staff-mfa.ts`, `scripts/doctor-dev.mjs` | `true` turns on Redis limits and readiness pings Redis. Otherwise optional limits are skipped, routes that require protection answer 503, and staff MFA changes are refused. Compose default `false`; hosted hard-codes `true`. | hosted (fixed) | no |
| `RATE_LIMIT_REDIS_URL` | `lib/security/rate-limit.ts` | Redis URL; base default `redis://redis:6379`. Missing while enabled fails readiness and each check per its policy. | hosted (secret) | yes |
| `RATE_LIMIT_KEY_PREFIX` | `lib/security/rate-limit.ts` | Key prefix; default `thunderstrux`. | hosted: compose | no |
| `RATE_LIMIT_TRUSTED_PROXY_HEADER` | `lib/security/rate-limit.ts` | Header holding the client IP; default `x-forwarded-for`. The edge must overwrite it. An invalid header name makes every client `unknown`. The Droplet overlay uses `x-thunderstrux-client-ip`. | hosted: compose | no |

## Stripe

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | `lib/stripe/index.ts`, `lib/orders/order-detail.ts`, `scripts/staging-driver.mjs` | Platform key. Missing: Stripe calls throw `StripeConfigurationError` (Connect routes 503 "Stripe is not configured."; webhooks 503). `sk_live_`/`rk_live_` keys are refused outside production. `order-detail.ts` picks live or test Dashboard links with `isLiveStripeKey` (`sk_live_` or `rk_live_`). | for paid flows; compensation and checkout-recovery workers | yes |
| `STRIPE_WEBHOOK_SECRET` | `lib/stripe/index.ts` | Signing secret for `/api/payments/webhook`; missing is 503. Must match the CLI listener or Dashboard endpoint in use. | for payment webhooks | yes |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `lib/stripe/index.ts` | Signing secret for `/api/stripe/connect/webhook`; missing is 503. | for Connect webhooks | yes |

## Email and notifications

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | `lib/email/ticket-delivery.ts`, `scripts/staging-driver.mjs` | Resend key. Missing (or `EMAIL_FROM` missing) fails each send with a configuration error inside the worker; fulfilment still succeeds and queues the email. | for delivery | yes |
| `EMAIL_FROM` | `lib/email/ticket-delivery.ts`, `lib/email/notification-outbox.ts`, `lib/auth/account-lifecycle.ts` | Sender. Notifications freeze it into the stored message when queued. | hosted: compose | no |
| `NOTIFICATION_ENCRYPTION_KEY` | `lib/email/notification-crypto.ts` | Base64 of exactly 32 bytes; encrypts queued notification payloads. Missing or invalid: readiness 503 in every stack, and signup, verification and guest access refuse. Never replace it while encrypted jobs exist; back it up with database backups. | dev and hosted (readiness) | yes |
| `EMAIL_OUTBOX_BATCH_SIZE` | `lib/email/ticket-email-outbox.ts` | Jobs per run; default `25`. A non-positive or non-integer value uses the default. | no | no |
| `EMAIL_OUTBOX_MAX_ATTEMPTS` | `lib/email/ticket-email-outbox.ts` | Attempts before a job is exhausted; default `5`. | no | no |
| `EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS` | `lib/email/ticket-email-outbox.ts` | Age after which a claimed job is reclaimed; default `600`. | no | no |
| `THUNDERSTRUX_MAIL_CAPTURE_URL` | `lib/email/ticket-delivery.ts` | Sends notifications to the E2E mail capture. Accepted only when it is exactly `http://mail-capture:8025/emails` and `E2E_RUN_ID` is a valid run ID; otherwise sending fails. | E2E only | no |

## Image storage

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `ASSET_STORAGE_BUCKET` | `lib/assets/storage.ts`, `scripts/rehearse-assets.mjs` | Bucket. Missing bucket or keys: image routes 503 "Image storage is not configured". Dev uses `thunderstrux-assets` on `object-store`. | hosted: compose (assets overlay) | no |
| `ASSET_STORAGE_ENDPOINT` | `lib/assets/storage.ts`, `scripts/rehearse-assets.mjs` | S3-compatible endpoint; must start `http://` or `https://`. Unset uses AWS. | hosted: compose | no |
| `ASSET_STORAGE_REGION` | `lib/assets/storage.ts` | Default `us-east-1`. | no | no |
| `ASSET_STORAGE_PATH_STYLE` | `lib/assets/storage.ts` | `true` for path-style addressing (dev object store). | no | no |
| `ASSET_STORAGE_ACCESS_KEY` | `lib/assets/storage.ts` | Access key. | for images | yes |
| `ASSET_STORAGE_SECRET_KEY` | `lib/assets/storage.ts` | Secret key. | for images | yes |

## Workers, deploy and hosts

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `ALERT_WEBHOOK_URL` | `lib/ops/alerts.ts` | Operational alerts are also POSTed here as redacted JSON, best effort. Unset: logs only. | hosted (secret) | yes |
| `WORKER_TIMEOUT_SECONDS` | `lib/ops/worker.ts`, `scripts/every-minute.mjs` | Run timeout; integer 10–3600 or the worker throws; default `300`. The loop kills a run after timeout + 60 s. Base and hosted Compose pass it to every worker. | no | no |
| `WORKER_INTERVAL_SECONDS` | `scripts/every-minute.mjs` | Loop interval; default `60`. No Compose file sets it. | no | no |
| `APP_IMAGE`, `OPS_IMAGE` | Compose | Web and ops images. Base defaults `thunderstrux-app:local`, `thunderstrux-ops:local`; hosted requires immutable `@sha256:` references. | hosted: compose | no |
| `DEV_APP_IMAGE` | `docker-compose.dev.yml` | Dev image tag; default `thunderstrux-app:dev`. | no | no |
| `APP_CPUS`, `APP_MEMORY_LIMIT`, `APP_PIDS_LIMIT`, `OPS_CPUS`, `OPS_MEMORY_LIMIT`, `OPS_PIDS_LIMIT` | `docker-compose.hardened.yml`, `docker-compose.hosted.yml` | Container limits. | hosted: compose | no |
| `*_SECRET_NAME` (`DATABASE_URL_SECRET_NAME`, `AUTH_SECRET_NAME`, `MFA_ENCRYPTION_KEY_SECRET_NAME`, `NOTIFICATION_ENCRYPTION_KEY_SECRET_NAME`, `RATE_LIMIT_REDIS_URL_SECRET_NAME`, `STRIPE_SECRET_KEY_SECRET_NAME`, `STRIPE_WEBHOOK_SECRET_NAME`, `STRIPE_CONNECT_WEBHOOK_SECRET_NAME`, `RESEND_API_KEY_SECRET_NAME`, `ALERT_WEBHOOK_URL_SECRET_NAME`, `ASSET_STORAGE_ACCESS_KEY_SECRET_NAME`, `ASSET_STORAGE_SECRET_KEY_SECRET_NAME`) | `docker-compose.hosted.yml`, `docker-compose.assets.hosted.yml` | External secret names; default `thunderstrux_<lowercase name>`. Mounted at `/run/secrets/…` and read through `_FILE`. | no | n/a |
| `SITE_ADDRESS`, `ACME_EMAIL` | `deploy/droplet/docker-compose.droplet.yml` (Caddy) | Public domain and Let's Encrypt account. | Droplet: compose | no |
| `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT` | Droplet overlay | Defaults `80`, `443`. | no | no |
| `THUNDERSTRUX_SECRETS_DIR` | Droplet overlay | Secret files; default `/etc/thunderstrux/secrets`. | no | no |
| `THUNDERSTRUX_BACKUP_DIR`, `BACKUP_NAME` | Droplet overlay `backup` service | Backup folder (default `/var/lib/thunderstrux/backups`) and file name (default `manual`). | no | no |
| `SEED_DEMO_PASSWORD` | `prisma/seed.mjs` | Required (16+ characters) when any app URL is not loopback; then every seeded account uses it (SEC-015). | seeding a public origin | no |
| `REHEARSAL_TOOLS_IMAGE` | `scripts/rehearse-upgrade.mjs` | Tools image; default `thunderstrux-e2e-tests:local`. | no | no |
| `USERDOMAIN` | `scripts/run-e2e.mjs`, `scripts/operations.mjs` | Windows only: owner for `icacls` when locking run and state folders. | Windows | no |

## Tests, E2E and staging

| Variable | Read by | Purpose; when unset | Required | `_FILE` |
| --- | --- | --- | --- | --- |
| `INTEGRATION_DATABASE_URL`, `TEST_DATABASE_URL` | `scripts/run-integration-tests.mjs` | Test database, in that order; default `postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public`. Must name a `_test` database. | no | no |
| `INTEGRATION_REDIS_URL` | `tests/integration/redis-runtime.test.ts`, `tests/e2e/fixtures.ts` | Run-owned Redis; that test throws without it. Never dev or production Redis. | baseline | no |
| `THUNDERSTRUX_INTEGRATION_TEST` | nothing | Set to `1` by the integration runner; unused. | no | no |
| `THUNDERSTRUX_FAST_TEST_RESET` | `tests/helpers/db-reset.ts`, `tests/helpers/test-data.ts` | `1` uses the fast reset ([[Development Workflow#Integration test speed]]). Nothing sets it. | no | no |
| `E2E_RUN_ID` | `lib/email/ticket-delivery.ts`, `scripts/seed-notification-e2e.mjs`, `scripts/staging-driver.mjs` | Run ID (`baseline-`, `browser-` or `staging-` + 24 hex), written to the run's `runtime.env`. Gates mail capture and the notification seed. | E2E | no |
| `E2E_RUNTIME_FILE`, `E2E_OUTPUT_DIR` | `docker-compose.e2e.yml` | Set by `scripts/run-e2e.mjs`; Compose refuses to start without them ("Run through pnpm test:e2e"). | E2E: compose | no |
| `E2E_BASE_URL` | nothing | Set to `http://localhost:3100` in the `tests` container; Playwright's `baseURL` is hard-coded in `playwright.config.ts`. | no | no |
| `E2E_RESEND_API_KEY`, `E2E_EMAIL_FROM` | `docker-compose.e2e.yml` | Staging Resend credentials from `.env.staging.local`; defaults `re_capture_only`, `synthetic@example.com`. | no | no |
| `STRIPE_TEST_CONNECTED_ACCOUNT` | `scripts/staging-payments.mjs`, `scripts/staging-driver.mjs` | Ready test `acct_…`. From `.env.staging.local`, or the shell with `--use-local-test-key`. | staging | no |
| `SPACES_TEST_ENDPOINT`, `SPACES_TEST_BUCKET`, `SPACES_TEST_ACCESS_KEY`, `SPACES_TEST_SECRET_KEY` | `scripts/staging-driver.mjs` | Staging storage smoke (https endpoint). Any missing: storage is recorded as blocked (OPS-005). | no | no |
| `CI` | `playwright.config.ts` | Non-empty forbids `test.only`. Passed into the `tests` container. | no | no |
| `GITHUB_STEP_SUMMARY` | `scripts/e2e-ci-summary.mjs` | When set, the run summary is appended to it. | no | no |

`.env.staging.local` (ignored, no example) is parsed by `scripts/staging-payments.mjs`, not loaded into the environment: `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_CONNECTED_ACCOUNT`, `RESEND_TEST_API_KEY`, `RESEND_TEST_FROM` and the `SPACES_TEST_*` values. The runner writes `STRIPE_API_KEY` into the run's `runtime.env` for the Stripe CLI service. The dev `object-store` container takes `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `S3_BUCKET` from `docker-compose.dev.yml`.

## Example files

| File | For | Notes |
| --- | --- | --- |
| `.env.example` | Local `.env` | `ASSET_STORAGE_*` apply to `ops:deploy` stacks only (the dev override sets its own); `SEED_DEMO_PASSWORD` is commented out. App URLs say `localhost:3080`; the maintained local `.env` uses `127.0.0.1:3080`. `AUTH_SECRET` is a placeholder the app refuses. |
| `.env.db.example` | `.env.db` | — |
| `.env.hosted.example` | Hosted contract | Includes the `ASSET_STORAGE_*` values and secret names `docker-compose.assets.hosted.yml` reads. |
| `deploy/droplet/config.env.example` | Droplet `config.env` | Secrets are files in `THUNDERSTRUX_SECRETS_DIR`. |

## Traps

- A variable Compose doesn't list never reaches a release container, even if it is in your `.env` (it may still reach the dev app through `next dev`).
- Changing `.env` needs a container recreate (`pnpm docker:restart`), not a restart.
- Leaving `NOTIFICATION_ENCRYPTION_KEY` unset makes `/api/health/ready` 503 even in dev.

## Related

[[Development Workflow]] · [[Production Operations]] · [[E2E and Staging Payments]] · [[Route Security Inventory]] · [[Authentication and Dashboard Access]] · [[Troubleshooting]]
