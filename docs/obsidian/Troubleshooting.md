---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Development Workflow]]", "[[Environment Variables]]", "[[Seeding and Data]]", "[[Stripe Payments and Connect]]", "[[Authentication and Dashboard Access]]"]
sources: [scripts/doctor-dev.mjs, scripts/recreate-dev-app.mjs, scripts/clean-next-dev.mjs, scripts/integration-test-guards.mjs, lib/ops/readiness.ts, lib/auth/secret.ts, lib/stripe/connect.ts, components/settings/stripe-connect-settings.tsx]
---

# Troubleshooting

**Owns:** live failure symptoms on a local or preview stack, each as symptom → cause → fix.
**Read when:** something local is broken and you want the known cause before debugging.
**Not here:** how the stack is built and what each command does ([[Development Workflow]]); variable meanings ([[Environment Variables]]); production incidents, alerts and recovery ([[Production Operations]]); Connect states in full ([[Stripe Payments and Connect]]).

## Code

| Concern | Where |
| --- | --- |
| Read-only dev report | `scripts/doctor-dev.mjs` (`pnpm dev:doctor`, run in the app container) |
| Dev app recreate with fresh dependencies | `scripts/recreate-dev-app.mjs` (`pnpm docker:restart`, `pnpm docker:rebuild`) |
| Readiness checks | `lib/ops/readiness.ts` (`GET /api/health/ready`) |

## Rules

- `DC` below means `docker compose -f docker-compose.yml -f docker-compose.dev.yml`. Use it for every dev-stack command.
- **Trap:** `docker compose up -d --force-recreate app` (base file only) replaces the dev app with the production web container: no source mount, `NODE_ENV=production`, the old image. To reload env or code, use `pnpm docker:restart`.
- Diagnose first with `DC exec app pnpm dev:doctor`. It changes nothing.
- Never `down -v`, delete volumes, or reseed to fix a stale app. Keep database, Redis and `asset_data` volumes.

## Docker and Next dev

**Route exists in source but dev returns 404.**
- Cause: first rule out a guard. Management pages give a concealed 404 to members, other societies and staff without the permission (`lib/auth/page-access.ts`), and `check_in_staff` get 404 on drafts. Otherwise the dev route manifest is stale: Turbopack or a OneDrive/Windows file lock kept an old `.next/dev`.
- Check: `DC exec app sh -lc "grep -c 'events/\[eventId\]' .next/dev/server/app-paths-manifest.json"`, and the app log for the `scripts/clean-next-dev.mjs` warning "Unable to clear volatile Next.js cache paths".
- Fix: stop any host Node process holding `.next`, delete `.next` on the host, then `pnpm docker:restart`. If it recurs, try `pnpm dev:webpack` in the container.

**Page shows old UI after a source change.**
- Cause: browser cache, a missed poll, stale `.next`, or the container is not on the bind mount.
- Check: search source for the stale text (`rg -n "exact text" app components`), then `DC exec app cat <file>` to compare the container copy, then search `.next`.
- Fix in order: hard refresh; `pnpm docker:restart`; delete `.next` and restart. If the container copy differs, it was started from the base file: `pnpm docker:dev:clean`.

**Layout or classes look like an old stylesheet; hydration warning shows old class names on the client side.**
- Cause: polling missed a newly added file, so Tailwind didn't recompile, or the browser kept old JavaScript.
- Fix: hard reload (Ctrl+Shift+R); if it persists, `pnpm docker:restart`.

**`Cannot resolve` a module that exists, `@redis/client` missing, or Prisma Client missing or out of date.**
- Cause: the `node_modules` volume masks the image's dependencies, so a rebuilt image alone changes nothing.
- Fix: `pnpm docker:rebuild`. It rebuilds the image, deletes only the labelled `node_modules` volume, recreates the app, regenerates Prisma Client, deploys migrations, and checks `@redis/client` and `@prisma/client` import. Don't edit a valid import to work around it.

**Buttons do nothing; sign-in form reloads as `GET /login?`.**
- Cause: the page never hydrated because Next blocks dev resources (HMR) for hosts not in `allowedDevOrigins`. The log says `Blocked cross-origin request to Next.js dev resource`.
- Fix: open the app at `127.0.0.1` or `localhost`. For another local name, add it to `allowedDevOrigins` in `next.config.ts`. Never add a public host (SEC-014).

**Writes fail 403 "Untrusted request origin".**
- Cause: the page's origin isn't `NEXT_PUBLIC_APP_URL` or in `TRUSTED_APP_ORIGINS`. Typical: `.env` says `http://127.0.0.1:3080` and the browser is on `localhost:3080`. The log shows `trusted_origin.rejected`.
- Fix: browse at the host `.env` names, or add the other origin to `TRUSTED_APP_ORIGINS` and `pnpm docker:restart`.

**`pnpm dev` exits: "Thunderstrux is configured for Docker-first development".**
- Cause: `next dev` on the host with `DATABASE_URL` on `db:5432`.
- Fix: run in Docker (`pnpm docker:dev`). For one-off host debugging only: `THUNDERSTRUX_ALLOW_HOST_DEV=1` and a `localhost:5433` URL. The message's own advice (`docker compose up -d`, port 3000) starts the production image; ignore it.

**Compose exits before start: `DATABASE_URL is required` (or `AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`).**
- Cause: `.env` missing or the value empty; the base file requires them at interpolation.
- Fix: fill `.env` from `.env.example`, then `pnpm docker:dev`.

**Homepage 500.**
- Cause: app run on the host (`db:5432` doesn't resolve), migrations not applied, or the database empty after a reset (an empty database shows the empty state, not a 500).
- Check: `DC ps`, `DC logs --tail=80 app`, `DC exec app pnpm dev:doctor`.
- Fix: `pnpm docker:dev`; pending migrations apply on startup (or `DC exec app pnpm prisma:migrate:deploy`); reseed if needed ([[Seeding and Data]]).

**`/api/health/ready` returns 503 `unavailable`.**
- Cause, in check order: `NOTIFICATION_ENCRYPTION_KEY` missing or not 32 bytes; `LEGACY_ORGANISATION_ACCESS_MODE` invalid (or unset in production); MFA mode not `off` without a valid key and `RATE_LIMIT_ENABLED=true`; the migration in `config/schema-contract.json` not applied; Redis unreachable while rate limiting is on. The body never says which.
- Fix: `DC exec app pnpm dev:doctor` (MFA, rate limiting, migrations), then check those variables ([[Environment Variables]]).

**Images fail to upload or show; 503 "Image storage is not configured" or "temporarily unavailable".**
- Cause: `object-store` isn't running (`pnpm docker:restart` starts only `app`, `db`, `redis`) or `ASSET_STORAGE_*` is unset.
- Fix: `DC up -d --build object-store`. Bounded checks: `DC exec app pnpm assets:maintain --objects` or `--integrity`. Unattached or deleted images correctly return 404. Recovery: [[Society Profiles and Assets]].

**`pnpm build` throws "Do not run pnpm build inside a running container".**
- Cause: `NODE_ENV=production` with `THUNDERSTRUX_RUNTIME_CONTAINER=true`. Intended.
- Fix: rebuild the image (`pnpm docker:build`) or use the baseline runner.

**`tsc` errors inside `.next/types` or `.next/dev/types`.**
- Cause: stale generated route types, which `tsconfig.json` includes after a dev run.
- Fix: `pnpm typecheck` (runs `next typegen` first) in the container, or delete `.next` and restart.

**Hydration warning naming `data-gr-ext-installed`, `data-new-gr-c-s-check-loaded` or similar on `<body>`.**
- Cause: a browser extension (Grammarly) edits the page before React hydrates. Not an app bug. Fix: ignore, or test in a clean profile.

## Auth and sessions

**Startup fails: "AUTH_SECRET must be set to a random value…" or "…at least 32 characters in production."**
- Cause: `AUTH_SECRET` empty, a known placeholder, or short in production (SEC-016; `lib/auth/secret.ts`).
- Fix: `openssl rand -base64 32` into `.env`, then `pnpm docker:restart`.

**Signed-in page bounces between itself and `/login?callbackUrl=…` behind an HTTPS tunnel or proxy.**
- Cause: cookie-name mismatch. Auth.js issues `__Secure-` cookies when its public URL is https; `proxy.ts` decides with `publicOriginIsHttps` from `AUTH_URL`, then `NEXTAUTH_URL`, then the request URL.
- Fix: set `AUTH_URL`, `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the https address and redeploy. Don't disable secure cookies or CSRF.

**Signup, verification, reset, password change or guest email answers 503.**
- Cause: `RATE_LIMIT_ENABLED` isn't `true` or Redis is down (these routes require protection), or `NOTIFICATION_ENCRYPTION_KEY` is missing.
- Fix: `RATE_LIMIT_ENABLED=true` with the Compose `redis`, a valid key, `pnpm docker:restart`.

**Signup or recovery returns 202 but no email arrives.**
- Cause: 202 is deliberately generic. Nothing delivers in dev until the notification worker runs.
- Fix: `DC exec app pnpm notifications:process`. With no `RESEND_API_KEY`/`EMAIL_FROM` the job records a configuration failure. Request a fresh link rather than replaying one; links need an explicit POST and must match the latest issuance.

**Signed out after a password or email change.** Intended: the change bumps `authVersion` and revokes sessions. Sign in again. An enrolled authenticator still needs its login-bound MFA step even with enforcement `off`.

**`/mfa` fails because `public.UserMfa` does not exist.**
- Cause: migrations behind the code.
- Fix: `DC exec app pnpm dev:doctor`; if migrations are pending, `DC exec app pnpm prisma:migrate:deploy`; if the doctor says the container is stale, `pnpm docker:restart`. Then `curl --fail http://127.0.0.1:3080/api/health/ready`. Never create the table by hand or mark a migration applied. (DEF-001, [[Resolved Defects]].)

**Staff action answers 503 "Staff verification is unavailable".**
- Cause: `MFA_ENFORCEMENT_MODE` not `off` without a valid `MFA_ENCRYPTION_KEY` or with rate limiting off. Fix: correct the variables ([[Environment Variables]]).

## Database and migrations

**Integration runner: "Refusing integration database access: use a PostgreSQL URL with a single database name ending in "_test"."**
- Cause: `INTEGRATION_DATABASE_URL`, `TEST_DATABASE_URL` or (in `tests/helpers/db-reset.ts`) `DATABASE_URL` names a non-`_test` database.
- Fix: point at a disposable `_test` database. Never at `thunderstrux`.

**`tests/integration/redis-runtime.test.ts` throws "INTEGRATION_REDIS_URL must identify the run-owned test Redis".**
- Cause: whole suite run outside the baseline. Fix: run `node scripts/run-e2e.mjs baseline`, or run only the files you need ([[Development Workflow#Tests locally]]).

**`pnpm prisma:migrate` (or `pnpm docker:migrate`) offers to reset the database.**
- Cause: drift between the database and migration history. Answering yes wipes the dev database. Fix: say no; inspect the drift; use `pnpm prisma:migrate:deploy` for existing migrations.

**Users, events or orders gone.**
- Cause: `pnpm docker:reset` or `down -v` deleted `postgres_data`.
- Fix: `pnpm docker:dev`, then `DC exec app pnpm seed` ([[Seeding and Data]]). Business data needs a real restore ([[Production Operations]]).

## Stripe

**Checkout answers 400 "Stripe not connected".**
- Cause: the event's society has no connected account or charges aren't enabled (`stripe_not_ready`; `lib/payments/checkout-creation.ts`). Free tickets still work.
- Fix: as a society owner or admin (`stripe:manage`), open `/dashboard/settings` and use Connect Stripe, Continue Stripe setup or Fix in Stripe, then Refresh status. States: [[Stripe Payments and Connect#Connect account states]].

**Settings show "Stripe platform setup required" (`PLATFORM_NOT_READY`), or Stripe says "You can only create new accounts if you've signed up for Connect".**
- Cause: the platform account behind `STRIPE_SECRET_KEY` hasn't enabled Connect or finished its platform profile. Both errors are mapped to `PLATFORM_NOT_READY`; no account is created. Seeded Payments Lab starts here.
- Fix: complete `https://dashboard.stripe.com/settings/connect/platform-profile`, then Retry after completion. Disconnect Stripe account resets it to `NOT_CONNECTED`.

**Connect or settings routes answer 503 "Stripe is not configured. Check STRIPE_SECRET_KEY…"; checkout answers 503 "Payments are unavailable right now".**
- Cause: `STRIPE_SECRET_KEY` empty in the container, or a live key outside production. Fix: set a test key in `.env`, `pnpm docker:restart`.

**`STRIPE_SECRET_KEY` changed to another platform; status shows "Status may be out of date" (`ERROR`).**
- Cause: connected `acct_…` ids belong to the platform that created them. Disconnect also fails: it first calls `restoreStripePayoutSchedule` on the old account, which the new platform can't update, and it refuses while the society has open orders on that account.
- Fix: switch back to the original key, or on a dev database only clear the link and reconnect:

```sql
UPDATE "Organisation" SET "stripeAccountId" = NULL, "stripeAccountStatus" = 'NOT_CONNECTED',
  "stripeChargesEnabled" = false, "stripePayoutsEnabled" = false, "stripeDetailsSubmitted" = false
WHERE slug = 'engineering-society';
```

  (`DC exec db psql -U thunderstrux -d thunderstrux`.) This writes no audit row. To re-link a known old account instead, set its `acct_…` with status `CONNECTED_INCOMPLETE` and press Refresh status.

**Webhooks return 400 "Invalid Stripe signature"; orders stay pending.**
- Cause: the app's `STRIPE_WEBHOOK_SECRET` isn't the secret of the running `stripe listen` or Dashboard endpoint. `/api/stripe/connect/webhook` uses `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Fix: `stripe listen --forward-to 127.0.0.1:3080/api/payments/webhook`, copy its `whsec_…` into `.env`, `pnpm docker:restart`, then compare without printing it: `DC exec app node -e "const s=process.env.STRIPE_WEBHOOK_SECRET; console.log(s ? s.slice(0,12)+'... len='+s.length : 'missing')"`. A valid event logs `stripe.webhook.received`; unrelated types answer 200 `Ignored`. Missing secret is 503.

**Webhook answers 200 with `ignored: "mode_mismatch"`.** A test-mode event reached a live-key deployment or the reverse; it is ignored and alerts `stripe_webhook_mode_mismatch`. Point the endpoint at the matching deployment.

**Test payment never completes without returning to `/success`.** The dev stack has no webhook endpoint unless you add one; see [[Development Workflow#Stripe on the dev app]].

## Email

**Paid order has tickets but no email.**
- Cause: the dev stack runs no workers; ticket emails wait in the outbox. Missing `RESEND_API_KEY` or `EMAIL_FROM` makes each attempt fail with a configuration error (fulfilment is unaffected).
- Fix: `DC exec app pnpm email:outbox:process`. Outbox states and retries: [[Email Delivery Implementation]].

## Tests

**E2E run refuses: "Port 3100 is occupied; existing server will not be reused".** Stop whatever holds 3100; the runner never reuses a server.

**Interrupted E2E or staging run.** Repeat `pnpm test:e2e:cleanup -- <run-id>` until it confirms cleanup; keep a payment recovery manifest and its volumes until recovery succeeds ([[E2E and Staging Payments]]).

**`pnpm security:audit` fails.** Capture the advisory, version and every dependency path; update the parent or a reviewed override, then revalidate. Never suppress advisories ([[Dependency Automation]]).

## Related

[[Development Workflow]] · [[Environment Variables]] · [[Seeding and Data]] · [[Stripe Payments and Connect]] · [[Authentication and Dashboard Access]] · [[Production Operations]] · [[Email Delivery Implementation]]
