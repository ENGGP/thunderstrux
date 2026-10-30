---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Engineering Delivery Workflow]]", "[[Journey Qualification]]", "[[Stripe Payments and Connect]]", "[[Environment Variables]]", "[[Production Operations]]"]
sources: [scripts/run-e2e.mjs, scripts/e2e-guards.mjs, scripts/staging-payments.mjs, scripts/staging-driver.mjs, docker-compose.e2e.yml, docker/Dockerfile.e2e]
---

# E2E and Staging Payments

**Owns:** the isolated Docker runner (`scripts/run-e2e.mjs`) and its modes, the browser campaign, staging payments against real Stripe test mode, their evidence manifests, completion gates and cleanup.
**Read when:** running or changing the baseline, browser or staging campaigns, adding a Playwright spec or a staging scenario, or recovering an interrupted run.
**Not here:** which validation a change needs ([[Engineering Delivery Workflow]]); which test proves which journey ([[Journey Qualification]]); env var meanings ([[Environment Variables]]); webhook handling ([[Stripe Payments and Connect]]); the operations rehearsal ([[Production Operations Hosting]]).

## Code

| Concern | Where |
| --- | --- |
| Runner, modes, cleanup | `scripts/run-e2e.mjs` |
| Run-id, database, key, manifest and scenario guards; pinned Stripe version | `scripts/e2e-guards.mjs` (`runIdPattern`, `assertTestDatabase`, `assertTestKey`, `assertOwnedManifest`, `allStagingScenarios`, `stripeApiVersion`) |
| Stack | `docker-compose.e2e.yml`; test image `docker/Dockerfile.e2e`; object store `docker/Dockerfile.assets` |
| Staging orchestration | `scripts/staging-payments.mjs` (`runStaging`) |
| Staging fixtures, checks, Stripe cleanup | `scripts/staging-driver.mjs` (`preflight`, `storage`, `prepare`, `handoff`, `verify`, `cleanup`) |
| Mail and alert capture | `scripts/mail-capture.mjs` |
| Notification fixture | `scripts/seed-notification-e2e.mjs` (called by `tests/e2e/notifications.spec.ts`; refuses outside an isolated run id) |
| CI job summary | `scripts/e2e-ci-summary.mjs` (reads `summary-*.json` from `tests/e2e/summary-reporter.ts`) |
| Specs | `tests/e2e/*.spec.ts`; projects `desktop` and `mobile` (Pixel 7, `mobile.spec.ts` only); every run emulates reduced motion (`playwright.config.ts`) |
| Runner safety tests | `tests/runner/*.test.mjs` (`pnpm test:e2e:guards`), incl. `tests/runner/staging.test.mjs`, `tests/runner/guards.test.mjs`, `tests/runner/e2e-port.test.mjs` |
| Manual CI | `.github/workflows/e2e.yml` (guards, browser campaign, allowlisted counts) |

## Commands

| Command | Mode | Run id |
| --- | --- | --- |
| `pnpm test:e2e:guards` | runner safety tests on the host (Node only) | — |
| `node scripts/run-e2e.mjs baseline` | typecheck, integration suite, audit inside the stack | `baseline-<24 hex>` |
| `pnpm test:e2e` | browser campaign | `browser-<24 hex>` |
| `pnpm test:payments:staging [-- --scenario=<name>] [-- --use-local-test-key]` | real Stripe test mode | `staging-<24 hex>` |
| `pnpm test:e2e:cleanup -- <run-id>` | finish an interrupted run's cleanup | the run's id |

The run id is also the Compose project and the evidence folder `tmp/e2e/<run-id>/`. Needs Docker; no host Playwright or browser download.

## How a run works

1. Validate the run id; refuse if `127.0.0.1:3100` is taken (an existing server is never reused).
2. Create `tmp/e2e/<run-id>/` (0700, `icacls` on Windows), `manifest.json` (`version`, `runId`, `project`, `staging`, `createdAt`) and `runtime.env` (0600): random `AUTH_SECRET`, `NOTIFICATION_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`; `MFA_ENFORCEMENT_MODE=enforce` for the browser campaign, `off` otherwise; `LEGACY_ORGANISATION_ACCESS_MODE=deny`; empty `STRIPE_SECRET_KEY`; synthetic webhook secrets; `E2E_RUN_ID`. Compose gets only this file (`--env-file`), never the developer's `.env`.
3. Build `app`, `migration`, `tests`; record `manifest.release`: the release pair (`describeReleasePair`: revision, image ids and sizes within budget, required migration, chain digest) and `treeMatchesRevision` (`git diff --quiet HEAD`).
4. Start `app` (pulls in `db`, `redis`, `migration`, `mail-capture`, `object-store`) and wait for `GET /api/public/events` to answer (90 s).
5. Run the mode's steps, then mark `passed`, then clean up.

| Service | Image | Notes |
| --- | --- | --- |
| `db` | `postgres:16` | `thunderstrux_e2e_test`, user `e2e`, volume `test_database` |
| `redis` | `redis:7-alpine` | rate limiting is on |
| `migration` | `thunderstrux-e2e-ops:local` (`ops` stage) | `prisma migrate deploy` before the app starts, as in production |
| `mail-capture` | `thunderstrux-e2e-ops:local` | captures email (`THUNDERSTRUX_MAIL_CAPTURE_URL`) |
| `object-store` | `thunderstrux-assets:local` | S3-compatible store, read-only root, volume `test_assets` |
| `app` | `thunderstrux-e2e-app:local` (`web` stage) | `NODE_ENV=production`, origin `http://localhost:3100`, published on `127.0.0.1:3100` |
| `tests` | `thunderstrux-e2e-tests:local` | profile `test`; shares the app's network namespace so Auth.js, server fetches and the browser use one origin; reports mount at `/app/test-results` |
| `stripe` | `stripe/stripe-cli` | profile `staging`; `listen --latest`, forwards the payments-webhook events only to `/api/payments/webhook` |

No origin is passed at build time: the web image reads `NEXT_PUBLIC_APP_URL` at run time. Because the stack runs in production mode, `/success` can't fulfil an order; only signed webhooks do.

**Container names:** services are `<run-id>-<service>-1`; each step runs in a named container `<run-id>-checks`, `<run-id>-mfa`, `<run-id>-browser` or `<run-id>-webhooks`; staging driver calls use Compose's generated `<run-id>-tests-run-<id>`. All carry the project label cleanup checks.

## Browser campaign

| Step | App settings | Specs |
| --- | --- | --- |
| `mfa` | MFA `enforce` | `mfa-enforced.spec.ts`, `permission-matrix.spec.ts` (desktop) |
| `browser` | MFA `off` (app recreated) | every other UI spec, desktop and mobile: browser, mobile, account lifecycle, society profiles and discovery, event builder, free tickets, payments page, checkout states, public event pages, explore events, guest access/checkout/claim, order refunds, purchases, check-in, memberships, merchandise, analytics, calendar, dashboards, history, security headers, accessibility |
| `webhooks` | `STRIPE_SECRET_KEY=sk_test_synthetic` (app recreated) | `webhooks.spec.ts`, `notifications.spec.ts`, `journeys.spec.ts` (desktop) |

Webhook specs sign payloads with the run's synthetic secrets: raw-body signatures, tampering, expiry, duplicate and concurrent delivery, business mismatches, Connect's separate secret; fulfilment checks inventory, reservations, tickets and the email outbox. Paid checkouts seed the Session as the app would create it. Public pages, including `/events/[eventId]`, are anonymous; `/dashboard` and `/account` need sign-in. A new spec file must be added to a step's list in `scripts/run-e2e.mjs` or it never runs.

The baseline step `checks` runs `pnpm test:e2e:guards && pnpm typecheck && pnpm test && pnpm security:audit` inside the `tests` container against the disposable database. It describes the validation mode, not a claim the source is unchanged.

## Staging payments

Real Stripe test mode through the app, with a person paying on Stripe's Checkout pages.

**Credentials:** an ignored `.env.staging.local` with `STRIPE_TEST_SECRET_KEY` (must match `sk_test_`) and `STRIPE_TEST_CONNECTED_ACCOUNT` (a ready `acct_` test account), optionally `RESEND_TEST_API_KEY` + `RESEND_TEST_FROM` and `SPACES_TEST_ENDPOINT` (https), `SPACES_TEST_BUCKET`, `SPACES_TEST_ACCESS_KEY`, `SPACES_TEST_SECRET_KEY` ([[Environment Variables]]). `--use-local-test-key` instead reads only `STRIPE_SECRET_KEY` from `.env` and takes the account from the `STRIPE_TEST_CONNECTED_ACCOUNT` environment variable; it never loads `.env` into Compose. Provider values must be single-line with no `$`.

**Flow** (`runStaging`):
1. Record scenarios and `blocked` (`email` without Resend values). Card scenarios need an interactive terminal.
2. Start the `stripe` listener; read the fresh signing secret from its log (never streamed, never reused) into `runtime.env`; start the app.
3. `preflight`: the key is test mode, the platform identity is saved (later runs and cleanup must match it), and the connected account has charges, details, `card_payments` and `transfers` active.
4. `storage`: with all four Spaces values, put, head, get and delete one object under `t45/<run-id>/` through `lib/assets/storage.ts`; otherwise `blocked` with the missing names. A blocked provider doesn't fail the run.
5. Per scenario: set `stripeResourcesPossible`; `prepare` (one run-owned society `<run-id>-<scenario>` with a finance manager, ownership written before any Session); for card scenarios print the private Checkout URL and what to do, and wait up to 15 minutes for `confirmed`; `verify` (polls up to 120 s for reconciliation; writes `payment-<scenario>.json`); then every Stripe event the scenario relied on must show listener `[200]` and appear in the app log with `"apiVersion"` equal to `stripeApiVersion`.
6. Always `cleanup`: expire open Sessions it owns, including ones found by a bounded metadata search (10 pages of 100) for Sessions created before the order recorded them; set `stripeCleanupComplete`.

Events fetched back from Stripe's API carry the account's default version, so only the app's own log proves what was delivered. `stripeApiVersion` in `scripts/e2e-guards.mjs` must equal `lib/stripe/version.ts` (`tests/runner/guards.test.mjs` checks it). The listener's `--latest` forwards the newest version its CLI build knows; a CLI upgrade can change it.

| Scenario (`allStagingScenarios`, run order) | Proves |
| --- | --- |
| `free` | a member's free ticket from the event page, no Stripe; Resend accepts the receipt. No card or terminal |
| `success` | Get tickets → Pay A$12.00: destination charge, fee, fulfilment, stock, buyer's Tickets page, Resend; then finance refunds the whole order in the app: transfer reversed, fee returned, tickets void |
| `decline` | decline card (4000 0000 0000 0002), then forced expiry: no tickets, stock restored |
| `cancel` | manually attested return to the cancel page, then forced expiry |
| `member` | free membership, then the ticket at member price ($9.00 not $15.00), linked to the membership |
| `guest` | guest confirms email from the captured link and pays; order belongs to the verified guest; Resend accepts |
| `membership` | paid membership ($25.00): commerce order fulfilled, grant made |
| `merchandise` | two lines ($55.00): each option's stock drops; finance refunds the order in the app |
| `compensation` | ticket order expired locally (`automatic_full`) while its Session stays open; paying it issues nothing and the refunds worker refunds in full. Since PAY-024 the stale-order job closes an open page before expiring, so the run expires it with no Stripe key outside production, the one path that still leaves the page payable |
| `commerce-dispute` | paid membership with the dispute card (4000 0000 0000 0259); the order records the dispute, the run submits losing evidence, the lost dispute ends the membership and the transfer is reversed |
| `commerce-outside-refund` | $15.00 of a merchandise order refunded outside Thunderstrux; recorded, marked reviewed, the app refunds only the remaining $40.00 |
| `commerce-compensation` | merchandise order expired locally (the same way), paid anyway: nothing fulfilled, stock unchanged, refunded in full by the worker |

Unpaid Sessions are explicitly expired through Stripe; natural timeout is never observed. Connect webhooks (`payout.*`) and Accounts v2 events are not forwarded by the listener; the run's connected account is onboarded beforehand, and preflight checks it through Accounts v2 (merchant `card_payments` and recipient `stripe_transfers` active, terms accepted).

**Email and storage evidence:** run-owned users get `delivered+<run-id>-<scenario>-<role>@resend.dev`, which Resend accepts without a verified domain and no inbox receives. Ticket receipts go to Resend; account and guest notifications stay in mail capture (the guest scenario reads its link there). Captured mail proves what the app would send; Resend acceptance proves the provider took it; inbox delivery needs a verified sending domain and is not observed here (H03).

## Completion gates

- Choose the campaign by [[Engineering Delivery Workflow]]. One complete passing run with cleanup is enough; repeat only for changed inputs, a failure or a documented reliability concern. Cancelled, skipped or partial required steps don't qualify.
- Staging acceptance needs observed real Stripe evidence for every scenario, with the app and the scenario assertions unchanged across any runs combined. A focused `--scenario` run is not full acceptance alone.
- The manifest names what ran (`release`, `treeMatchesRevision`); state how that evidence applies to the reviewed diff.
- GitHub E2E and operations workflows are manual-only and not merge requirements (VALID-001). Documentation-only changes run docs/diff checks and claim review, no functionality tests.
- Record dated results in the PR and [[Project Handover]]; history is in [[Evidence Ledger]].

## Traps

- Port 3100 must be free; stop any other run first.
- A paused or killed staging run keeps its database volume and manifest until Stripe cleanup succeeds; don't delete either by hand.
- Evidence from `tmp/e2e/` is private: only allowlisted counts reach the GitHub job summary. Traces, cookies, Checkout URLs, raw provider payloads and private state are never uploaded; don't attach private staging files to a PR.

## Failure and recovery

- Every run ends with cleanup: verify each container's project label is the run id, `compose down --volumes --remove-orphans` for all profiles, set `cleanupComplete`, delete `runtime.env`. Images and Docker's build cache stay.
- A staging run whose Stripe cleanup didn't finish removes its containers and `runtime.env` but keeps the database volume and manifest (`passed: false`). Run `pnpm test:e2e:cleanup -- <run-id>` with the same credentials (with `--use-local-test-key` and the account variable if used): it restarts the app, re-verifies the saved Stripe identity, expires owned Sessions, then removes the stack. It never deletes connected accounts, the dev stack, unrelated volumes or global caches.
- Driver errors hide `sk_test_`, `whsec_` and `re_` values and show only a Stripe error's type; the runner's captured Docker output also hides Checkout URLs.

## Related

[[Journey Qualification]] · [[Engineering Delivery Workflow]] · [[Stripe Payments and Connect]] · [[Payment Lifecycle]] · [[Production Operations]] · [[Environment Variables]] · [[Pre-hosting Candidate]]
