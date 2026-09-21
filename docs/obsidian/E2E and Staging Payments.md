# E2E and Staging Payments

P2.16 status: implementation and acceptance merged through PR #10 (`59dc563`). Automated browser/webhook checks and real Stripe acceptance are separate gates; synthetic webhook tests alone do not establish completion. Later payment-path changes must repeat the relevant acceptance campaign.

## Automated checks

Run `pnpm test:e2e` from the repository root with Docker Desktop running. No host Playwright installation or browser download is required. The command builds a production-mode app and a Node 22 Chromium runner; the application remains on Node 20. The exact Playwright package determines the browser version.

The standalone Compose project publishes `127.0.0.1:3100`, creates its own database and volume, and never mounts the development source or dependency volumes. Port conflicts fail without reusing another app. The runner shares the app network namespace so Auth.js, server-side event fetches and browser navigation use the same origin. Production builds receive that origin through the non-secret `APP_ORIGIN` build argument.

Commands:

```powershell
pnpm test:e2e:guards
pnpm test:e2e
node scripts/run-e2e.mjs baseline
pnpm test:e2e:cleanup -- p216-<24-hex-character-run-id>
```

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

This reads only `STRIPE_SECRET_KEY` from `.env`; it does not load that file into Compose. Stripe CLI obtains a new signing secret from the exact active listener. Existing webhook secrets are not reused. The listener API version must match `2026-03-25.dahlia`; a mismatch blocks acceptance.

To repeat a missing scenario, append exactly one of `--scenario=success`, `--scenario=decline` or `--scenario=cancel`. The manifest records the selected scenarios. A passing focused run is not full payment acceptance: all three scenarios still require evidence, including successful resource cleanup. Previously verified payment evidence can be combined only when the relevant application and assertion code is unchanged.

The command drives the app's real Buy Ticket flow, then presents a private Stripe URL. Complete the success, decline and cancel prompts using Stripe test cards. Each prompt permits 15 minutes, followed by up to 120 seconds for webhook reconciliation. Successful payment verifies destination charge configuration, real event identity, listener HTTP 200, app receipt, database fulfilment and buyer ticket visibility. Decline requires provider error evidence. Cancel navigation is explicitly recorded as manual attestation; pending/unfulfilled state and subsequent real Session expiry are verified automatically.

Email workers/provider delivery stay disabled. An automatic outbox job is verified without sending mail. Rate limiting stays disabled in this isolated functional suite; its existing integration tests remain separate.

## Recovery and evidence

`tmp/e2e/<run-id>/manifest.json` records resource ownership. Private files under that directory are owner-restricted and excluded from Git and Docker builds. The database volume survives interrupted processes until cleanup succeeds. Recovery verifies the original Stripe platform and connected account, retrieves known Sessions, and uses bounded metadata-matched lookup for Sessions created before their IDs reached the database.

Run the cleanup command with the same credentials. When using the `.env` option, supply the account variable and append `--use-local-test-key` to cleanup too. Failed Stripe cleanup exits unsuccessfully and retains the database volume and recovery metadata, but removes run containers and the generated credential file. Recovery reloads credentials and verifies the original Stripe identity. Never delete the manifest or volume until recovery completes. Cleanup never deletes connected accounts, the development stack, unrelated volumes or global Docker caches.

Only allowlisted counts are published to the GitHub job summary. Browser traces, cookies, Checkout URLs, raw provider payloads and private state are not uploaded. The normal local Playwright error context contains only disposable synthetic-test data and stays ignored. Do not manually attach private staging files to a PR.

## Completion gates

- Existing baseline: 190 integration tests, typecheck, production build and audit passed before application changes.
- Require the post-change full regression suite and three consecutive complete local E2E runs on unchanged executable/test/configuration content, including successful cleanup. Cancelled, skipped or partial runs do not qualify.
- Require three green CI E2E runs on the qualification revision and green final-commit CI. Executable changes restart qualification; documentation-only evidence updates require final-commit CI, not another payment campaign.
- Require `e2e-tests` in branch protection alongside the existing three deterministic checks after qualification.
- Require observed real Stripe success, decline, manual cancel attestation and verified forced expiry with automatic reconciliation. The test explicitly expires unpaid Sessions through Stripe; it does not claim to observe natural timeout. Missing or skipped scenarios remain outstanding.
- See [[Current Handover]] and the P2.16 section of the remediation plan for current evidence.

## Validation evidence

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
