---
status: living
last-reviewed: 2026-10-24
owner: engineering
related: ["[[Engineering Delivery Workflow]]", "[[Stripe Payments and Connect]]"]
sources: [scripts/run-e2e.mjs, scripts/staging-payments.mjs, scripts/staging-driver.mjs, docker-compose.e2e.yml]
---

# E2E and Staging Payments

Status: the E2E harness (originally task P2.16) and its acceptance merged through PR #10 (`59dc563`); T45 extended staging acceptance to every purchase family, refunds, Resend and storage. Automated browser/webhook checks and real Stripe acceptance are separate gates; synthetic webhook tests alone do not establish completion. Later payment-path changes must repeat the relevant acceptance campaign.

## Automated checks

Run `pnpm test:e2e` from the repository root with Docker Desktop running. No host Playwright installation or browser download is required. The command builds a production-mode app and a Node 22.23.4 Chromium runner; the application also runs Node 22.23.4. The exact Playwright package determines the browser version.

The standalone Compose project publishes `127.0.0.1:3100`, creates its own database and volume, and never mounts the development source or dependency volumes. Port conflicts fail without reusing another app. The runner shares the app network namespace so Auth.js, server-side event fetches and browser navigation use the same origin. Production builds receive that origin through the non-secret `APP_ORIGIN` build argument.

Commands:

```powershell
pnpm test:e2e:guards
pnpm test:e2e
node scripts/run-e2e.mjs baseline
pnpm test:e2e:cleanup -- <run-id>
```

**Names.** Each run's ID says what it ran and doubles as its Compose project and evidence folder (`tmp/e2e/<run-id>`): `baseline-<24 hex>`, `browser-<24 hex>` (`pnpm test:e2e`) or `staging-<24 hex>`. Images are `thunderstrux-e2e-app:local` and `thunderstrux-e2e-tests:local`; the test container service is `tests`, and each step runs in a container named after the run and the step (`<run-id>-checks` for baseline, `<run-id>-mfa`, `<run-id>-browser`, `<run-id>-webhooks`) instead of Compose's generated `runner-run-<id>` names. The other containers are `<run-id>-app-1`, `<run-id>-db-1` and so on. Every run removes its containers, network and test database when it ends (images and Docker's build cache stay, so the next build reuses them); `pnpm test:e2e:cleanup -- <run-id>` finishes a run whose cleanup was interrupted.


The `baseline` mode runs typecheck, the full integration suite and audit inside the isolated stack. It describes the validation mode, not a claim that the source is unchanged. Integration resets affect only the disposable test database.

Browser coverage includes real signup/login/logout, callback restrictions, event discovery and mobile layout, checkout preconditions, named staff/legacy-owner access, misleading membership roles, tenant denial and live-session revocation. Public homepage/API access remains anonymous; event detail pages require login as before.

Synthetic HTTP webhook coverage verifies raw-body signatures, tampering, expiry, duplicate/concurrent delivery, business mismatches and Connect's separate secret. Fulfilment assertions include inventory, reservations, tickets and the email outbox. `/success` cannot fulfil orders because the stack runs in production mode.

## Guided Stripe acceptance

Prefer an ignored `.env.staging.local` containing `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_CONNECTED_ACCOUNT`. Run `pnpm test:payments:staging` in an interactive terminal. Live keys are rejected. The platform identity, connected account, test mode and capabilities are verified before Sessions are created.

To explicitly reuse only the existing test key from `.env`:

```powershell
$env:STRIPE_TEST_CONNECTED_ACCOUNT = 'acct_your_ready_test_account'
pnpm test:payments:staging -- --use-local-test-key
```

This reads only `STRIPE_SECRET_KEY` from `.env`; it does not load that file into Compose. Stripe CLI obtains a new signing secret from the exact active listener. Existing webhook secrets are not reused. The events the app receives must be shaped for its pin, `2026-09-30.endive` since PAY-006; a mismatch blocks acceptance. The listener runs with `--latest`, which forwards events at the newest version its Stripe CLI build knows (endive for v1.53.1), not the account's default. The app logs each webhook's `apiVersion`, and the runner checks it for every event a scenario relied on. An event fetched back from the API carries the account's default version at the time it was created (still dahlia on the test account), so it can't show what was delivered; the first endive campaign, `staging-2774be7496147e7612cb171c`, stopped on exactly that check. `stripeApiVersion` in `scripts/e2e-guards.mjs` must equal `lib/stripe/version.ts`, and a runner guard test checks that.

**Scenarios (T45).** Each scenario gets its own run-owned society with a finance manager. They run in this order:

| Scenario | What it proves |
| --- | --- |
| `free` | A member's free ticket through the checkout page, no Stripe; Resend accepts the receipt. Needs no card or terminal. |
| `success` | The real `Buy tickets` flow: destination charge, fee, fulfilment, inventory, buyer's Tickets page, Resend acceptance; then finance refunds the whole order through the app, the transfer is reversed, the fee is returned and the tickets are void. |
| `decline` | Provider decline evidence, then forced expiry: no tickets, stock restored. |
| `cancel` | Manually attested return to the app's cancel page, then forced expiry. |
| `member` | A free membership, then a ticket at the member price ($9.00 instead of $15.00), linked to the membership. |
| `guest` | A guest confirms their email from the captured link and pays; the order belongs to the verified guest and Resend accepts their receipt. |
| `membership` | A paid membership: the commerce order is fulfilled and the grant is made. |
| `merchandise` | Two lines paid together: stock for each option drops, then finance refunds the order through the app. |
| `compensation` | The order expires locally while its Session stays open; paying it issues no tickets, and the compensation worker refunds it in full (`automatic_full`). |
| `commerce-dispute` | PAY-003: a paid membership with Stripe's dispute card (4000 0000 0000 0259); the order records the open dispute, the run submits Stripe's losing evidence, and the lost dispute ends the membership. |
| `commerce-outside-refund` | PAY-003: $15.00 of a merchandise order is refunded outside Thunderstrux; the order records it, staff mark it reviewed, and the app refunds only the remaining $40.00. |
| `commerce-compensation` | PAY-003: a merchandise order expires locally, is paid anyway, fulfils nothing and changes no stock, and the refund worker returns it in full. |

To repeat one, append exactly one `--scenario=<name>`. A passing focused run is not full acceptance on its own. Evidence from different runs can be combined only when the application and the assertions for those scenarios are unchanged between them.

Every card scenario presents a private Stripe URL and the action to take on it. Each prompt permits 15 minutes, followed by up to 120 seconds for webhook reconciliation. Every Stripe event a scenario relies on, including refund events, must show listener HTTP 200 and appear in the app log. The terminal is required only when a selected scenario needs a card.

**Email and storage.** `.env.staging.local` may also hold `RESEND_TEST_API_KEY` and `RESEND_TEST_FROM`, and `SPACES_TEST_ENDPOINT`, `SPACES_TEST_BUCKET`, `SPACES_TEST_ACCESS_KEY` and `SPACES_TEST_SECRET_KEY`. A missing provider is recorded under `blocked` in the manifest; it doesn't fail the run. Run-owned users get `delivered+<run>-<scenario>-<role>@resend.dev` addresses, so Resend accepts mail without a verified domain and no real inbox receives it. The app's email worker sends ticket receipts to Resend. Account and guest notifications stay in the private mail capture, which the guest scenario reads its link from. The storage smoke puts, reads, checks and deletes one object under `t45/<run>/` through the product's storage adapter.

The three kinds of email evidence are kept apart. Captured mail proves what the app would send. Resend acceptance proves the provider took it. Inbox delivery is not observed here; it needs a verified sending domain (an H gate).

The isolated stack uses enabled Redis rate limiting and a private mail-capture service. Automated account-lifecycle/notification scenarios process captured messages with synthetic credentials; they do not establish real provider or inbox delivery.

## Recovery and evidence

`tmp/e2e/<run-id>/manifest.json` records resource ownership. Private files under that directory are owner-restricted and excluded from Git and Docker builds. The database volume survives interrupted processes until cleanup succeeds. Recovery verifies the original Stripe platform and connected account, retrieves known Sessions, and uses bounded metadata-matched lookup for Sessions created before their IDs reached the database.

Run the cleanup command with the same credentials. When using the `.env` option, supply the account variable and append `--use-local-test-key` to cleanup too. Failed Stripe cleanup exits unsuccessfully and retains the database volume and recovery metadata, but removes run containers and the generated credential file. Recovery reloads credentials and verifies the original Stripe identity. Never delete the manifest or volume until recovery completes. Cleanup never deletes connected accounts, the development stack, unrelated volumes or global Docker caches.

Only allowlisted counts are published to the GitHub job summary. Browser traces, cookies, Checkout URLs, raw provider payloads and private state are not uploaded. The normal local Playwright error context contains only disposable synthetic-test data and stays ignored. Do not manually attach private staging files to a PR.

## Completion gates

- Historical P2.16 baseline: 190 integration tests. Current Package 3 baseline: 354 tests in 42 files on `15a1e4b`, run `p216-e62123415fe7e1788a49219e`, with build/typecheck and clean audit. Final UI revision `5931086`, run `p216-86e01a93979f3ffc3d963f33`, passed 30 complete checks (3 MFA, 20 browser/mobile/account/profile/discovery, 7 signed webhook/notification); both cleanups completed. Earlier counts below retain their dated evidence.
- Select local regression and E2E coverage using [[Engineering Delivery Workflow]]. One complete successful applicable run with cleanup is sufficient; repeat only for changed inputs, failures or a documented reliability concern. Cancelled, skipped or partial required scenarios do not qualify.
- GitHub E2E and operations workflows are manual-only and are not merge requirements. Documentation-only evidence updates run docs/diff checks and claim review, without functionality tests or a new provider campaign.
- Preserve tested-revision evidence and explain its applicability to the reviewed diff. Historical repeated local/CI campaigns below remain evidence of past delivery, not current repetition requirements.
- Require observed real Stripe evidence for every scenario in the table above (T45), including manual cancel attestation, forced expiry with automatic reconciliation, and refund events. The test explicitly expires unpaid Sessions through Stripe; it does not claim to observe natural timeout. Missing or skipped scenarios remain outstanding.
- See [[Project Handover]] and the evidence ledger in [[../MVP_READINESS_PLAN]] for current evidence.

## Validation evidence

**PAY-006 Stripe API endive (2026-10-24).** `staging-872334655caa4b455d206a0f` on `642cdca` (the head #164 merged from; tree matching) passed all twelve scenarios on Stripe API `2026-09-30.endive` with stripe 23: free, success with a full refund (`re_3UU5lnRuN9MD4SvF1TjvdMtZ`), decline, cancel, member, guest, membership, merchandise with a full refund, compensation, commerce-dispute (dispute `du_1UU5smRuN9MD4SvFiEYVNv1q` lost and taken back as `trr_1UU5t5RuN9MD4SvFhtvtvLYR`), commerce-outside-refund and commerce-compensation. Every Stripe event a scenario relied on was delivered by the `--latest` listener and logged by the app at `2026-09-30.endive`; Stripe and stack cleanup completed. The first two endive runs stopped on the old check, which read the account's default version from the API instead of what the app received (`staging-2774be7496147e7612cb171c`; fixed in `642cdca`).

**PAY-005 payouts (2026-10-24, dev app, not a staging run).** Real payout on Stripe test mode (dev app, 24 Oct 2026): a $10.00 test destination charge to the Empty Society (`pi_3UU4ZeRuN9MD4SvF1SEVvhrQ`, Stripe's `pm_card_bypassPending`, so the money was available at once). One refunds-worker run then sent payout `po_1UU4ZwRwWHtrRpnvSnTTzE4m`: $10.00 available, $0.00 held, `automatic: false`, with the society in its metadata. It was recorded as a `SocietyPayout`, and the account's available balance went back to $0.00. A signed `payout.paid` sent to the Connect webhook (body status `in_transit`) recorded Stripe's re-read status, paid, and Payments listed $10.00 Paid.

**PAY-004 lost-dispute recovery (2026-10-24).** `staging-d456141b4d8bbadbdbd84901` (commerce-dispute) on `05ca852` (tree matching, migration `20261114010000_dispute_transfer_reversal` required): dispute `du_1UU2uVRuN9MD4SvFXvgHpRMP` on a paid membership was lost, the membership ended, and the refunds worker reversed the society's transfer by the disputed amount as `trr_1UU2v1RuN9MD4SvF1tUcwKJJ`, with the dispute in its metadata. All three Stripe events were delivered (listener HTTP 200) and received; Stripe cleanup completed.

**T46 fee (2026-10-24).** `staging-531f5b0f778b85d1fe58fbf2` (success) on `3e6f323`: the $12.00 ticket carried the new $1.34 fee (`platform_fee_3_75_percent_89c_v2`), and the full refund returned $12.00 and the $1.34; Resend accepted the receipt.

**PAY-003 commerce recovery (2026-10-24).** Baseline `baseline-9734427260591184e71e8334` (41/41 guards, 641 integration tests in 97 files, typecheck, clean audit), browser `browser-f884013075b6ac47e03097d7` on `6e8924e` (9 MFA, 67 desktop/mobile with the new disputed and partly refunded order screenshots, 10 webhook checks), operations `ops-b747a83484` (migration through upgrade and fenced restore), and staging on real Stripe test mode on `6e8924e`: `staging-a828d3d0d1942113a84e7e78` (commerce-dispute: dispute `du_1UTmCrRuN9MD4SvFGMdIjpRW` opened, lost, membership ended), `staging-f5d4c10aa92914683c6ecbf3` (commerce-outside-refund: $15.00 refunded outside, reviewed, the remaining $40.00 refunded here as `re_3UTmGIRuN9MD4SvF1VZCVqHc`) and `staging-d1981708891bb40ac0ac9600` (commerce-compensation: $55.00 refunded automatically with the $5.50 fee returned, stock unchanged). Every Stripe event listed was delivered (listener HTTP 200) and received by the app; every run cleaned up.

**T45 provider acceptance (2026-10-24).** Every scenario passed on Stripe API version `2026-03-25.dahlia`, with the migration digest `589d805fc690…` and each run's tree matching its revision. Stripe and local cleanup completed after every run.

- Run `staging-741aec2c432e45ed9ee6bf49` on `355b76d` covered seven scenarios:

  | Scenario | Evidence |
  | --- | --- |
  | free | Resend `01a16958-…` |
  | success | Event `evt_1UTkJnRuN9MD4SvF3yh66fcQ`, fee 120, Resend `01a1695c-…`. Refund `re_3UTkJmRuN9MD4SvF0G9LjmMX` returned 1200 and the 120 fee (event `evt_3UTkJmRuN9MD4SvF0W0PmgKE`). |
  | decline | Event `evt_1UTkOxRuN9MD4SvFjimCwpgc` |
  | cancel | Manually attested; event `evt_1UTkT5RuN9MD4SvFoXk94vfY` |
  | member | Unit price 900, fee 90; event `evt_1UTkV0RuN9MD4SvF7KlaxZES`; Resend `01a16967-…` |
  | guest | Fee 150; event `evt_1UTkbeRuN9MD4SvFdfRu285x`; Resend `01a1696f-…` |
  | membership | Fee 250; event `evt_1UTkeRRuN9MD4SvF0fMDzLhe` |

  Its merchandise step then failed on a driver fixture. The SKU wasn't in the catalogue's uppercase format, so the run stopped before any merchandise Session existed.
- Focused runs on `5a7ed97`. Only that fixture changed.
  - `staging-20ffc6bc0f22bbf4d4f25976`, merchandise: 2 lines, 5500 with fee 550, event `evt_1UTkjdRuN9MD4SvF44ZrJEhW`. Refund `re_3UTkjcRuN9MD4SvF00h3eSOv` returned 5500 and the 550 fee.
  - `staging-02b236b72c5db5284aa91a66`, compensation: paid after local expiry, event `evt_1UTkm4RuN9MD4SvF4yEikz8C`. Automatic refund `re_3UTkm3RuN9MD4SvF1uoFI2yo` returned 1200 and the 120 fee.
- An earlier attempt, `staging-3eec1e4c7496a494368a9d92`, paid and refunded `success` correctly but failed the driver's fee check. That check looked for the fee on the platform charge, while a destination charge's fee belongs to the society's payment. The fix was `355b76d`, and the attempt cleaned up.
- **Storage:** blocked. `SPACES_TEST_BUCKET`, `SPACES_TEST_ACCESS_KEY` and `SPACES_TEST_SECRET_KEY` are not set (OPS-005).
- **Not claimed:**
  - inbox delivery;
  - natural Session timeout;
  - manual compensation confirmation against Stripe;
  - commerce compensation (PAY-003);
  - hosted webhooks.

P3.19 repeat acceptance (2026-09-21): campaign `p216-20010cf603f4e0763ec530c1` passed all three guided scenarios and cleanup after the lifecycle-model changes. The staging driver now verifies exact lifecycle event ordering and Stripe event/session correlation as well as the existing payment invariants. Success event: `evt_1UHz3tRuN9MD4SvFpGbf8zTn`; decline/forced-expiry event: `evt_1UHz62RuN9MD4SvFMJeKqd9x`; manually attested cancellation/forced-expiry event: `evt_1UHz8uRuN9MD4SvFZRbGqV1c`. API version remained `2026-03-25.dahlia`; listener HTTP 200 and application receipt were verified. Email delivery and natural timeout are not claimed. See [[Payment Lifecycle]] for P3.19 regression evidence.

Real Stripe acceptance used API version `2026-03-25.dahlia` and verified correlated HTTP 200 listener delivery and application receipt:

- Run `p216-3814760f49ba7ccc6a4560ce`: successful payment event `evt_1UHFpFRuN9MD4SvFgpzvhKO2`; declined payment followed by forced expiry event `evt_1UHFrdRuN9MD4SvF19WpUoFg`. The cancellation prompt timed out before completion, so this run is not counted as a full passing campaign. Open Sessions, generated secrets, containers, database volume and network were cleaned up successfully.
- Focused run `p216-858bf79cfaff48e96b389719`: cancellation manually attested by the user; unpaid/non-fulfilled state and forced expiry event `evt_1UHHWPRuN9MD4SvFsWDcpe3i` verified automatically. Run and cleanup passed. Application and payment assertion code were unchanged from the earlier run; only explicit scenario selection was added.
- The combined evidence covers all three scenarios, including destination charge configuration, paid fulfilment, buyer ticket visibility and unpaid inventory preservation. It does not claim natural timeout or actual email delivery.
- The focused-scenario follow-up passed independent review and 8/8 runner safety tests. Final implementation revision is `5c08512`.

Attempt `p216-fe5d873b859c4d3ac41470df` was blocked by Docker being stopped and subsequently cleaned up; it is not a passing run. Final isolated regression `p216-a2dec49ed9fdfde6d7551779` passed typecheck, all 194 integration tests, production build and audit (no known vulnerabilities), and cleaned up successfully. The independent code review reported no remaining concrete blockers after the recovery finalizer fix.

Local E2E qualification for implementation revision `5c08512` passed three consecutive runs, each with 8 browser/mobile tests and 6 signed HTTP webhook tests, no skips/retries, and successful resource cleanup:

- `p216-f8ac5ba275229c8aa2784ad7`
- `p216-50ed800c2ebd6258c244ccae`
- `p216-2affa8ad6a05518356b18211`

The occupied-port rejection and repeated cleanup checks passed. Actionlint passed for the new E2E workflow. Development API smoke verification returned HTTP 200. All run-owned containers and test volumes were removed; development containers and data volumes were preserved.

CI qualification on `5c08512` passed [attempt 1](https://github.com/ENGGP/thunderstrux/actions/runs/35425904971/attempts/1), [attempt 2](https://github.com/ENGGP/thunderstrux/actions/runs/35425904971/attempts/2) and [attempt 3](https://github.com/ENGGP/thunderstrux/actions/runs/35425904971/attempts/3). [Static validation, integration tests and production build](https://github.com/ENGGP/thunderstrux/actions/runs/35425904976) also passed. Branch protection requires `static-validation`, `integration-tests`, `production-build` and `e2e-tests`, with strict up-to-date checking preserved; security audit remains non-required.

[PR #10](https://github.com/ENGGP/thunderstrux/pull/10) merged the reviewed P2.16 implementation and evidence. Documentation-only updates require green checks on their final PR head, not a repeat of an unchanged implementation's payment campaign.
