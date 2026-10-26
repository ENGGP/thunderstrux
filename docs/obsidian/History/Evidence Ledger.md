---
status: historical
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Project Handover]]", "[[Resolved Defects]]", "[[Issue and Defect Register]]"]
---

# Evidence Ledger

**Owns:** dated validation and delivery evidence (run IDs, test counts, Stripe objects, activation notes) that the 2026-10-26 documentation audit moved out of living notes and that no PR description, register row or historical handover already held.
**Read when:** you need proof of how something was validated, or to trace a run ID.
**Not here:** current behaviour (living notes), open risks ([[Issue and Defect Register]]), resolved defects ([[Resolved Defects]]).

Entries are verbatim and keep their original dates. File names and counts are as they were then; some files have since been removed. New evidence belongs in its PR description, not here.

## Project Handover — session from 2026-10-25 (moved 2026-10-26)

Delivery ledger and dated observations of the codebase-audit, security-remediation and test-audit session, moved verbatim from [[Project Handover]].

### Codebase audit, UI audit and design sync

| Item | PR | Status and evidence |
| --- | --- | --- |
| Audit fixes: checkout rush, late payers, payouts, sign-in timing (DEF-032 to DEF-035) | [#167](https://github.com/ENGGP/thunderstrux/pull/167) | Merged as `478b4e6`. No migration. Each new regression failed without its fix (30 buyers for 20 tickets gave 7 free and 5 paid sales before the change). Validation on `b77cb3e`, tree matching: baseline `baseline-6c03f713d391d53964a33823` (production build, 42/42 runner guards, typecheck, 665/665 integration tests in 101 files, no known vulnerabilities); browser `browser-9264cddad228d8fe358abcc1` (9 enforced-MFA, 69 desktop/mobile, 10 signed-webhook checks; builder screenshots show the automatic-refund default); real Stripe test mode `staging-c4ad83c75bbf179da2fe45ad` (`--scenario=success`: fulfilled, receipt accepted by Resend, refunded as `re_3UU8K6RuN9MD4SvF0V4K7xF1` with the $1.34 fee, events `evt_1UU8K8RuN9MD4SvFiXeVB3Br` and `evt_3UU8K6RuN9MD4SvF0qdN4veZ` delivered). An earlier baseline, `baseline-daa1fa1710011aa33237fcdb` on `1e97dd9`, passed 664/665; the failure was a recovery test's hard-coded 32-minute hold, fixed in tests. Every run cleaned up. |
| This handover | [#168](https://github.com/ENGGP/thunderstrux/pull/168) | Docs only. The previous handover becomes [[Project Handover 2026-10-25]]. |
| UI audit P1 fixes (DEF-036 to DEF-038, UI-003) | [#169](https://github.com/ENGGP/thunderstrux/pull/169) | Page titles, Create-a-society routing, phone event page order and buy bar, money and empty-state copy, plan default, Joined badge, clipping at 1280 px, expired staff invitations; from audit pass 2, option order on shop cards and checkout errors no longer blamed on the buyer. No migration. |
| UI consistency pass (UI-005) | [#170](https://github.com/ENGGP/thunderstrux/pull/170) | Header marker, sticky footer, empty states, counts, status pills, sign-in layout, society page header and join card, even event cards, recent lists without abandoned checkouts, Staff on phones, draft readiness first, plain copy. Stacked on #169. |
| Design tokens and design-sync inputs | [#171](https://github.com/ENGGP/thunderstrux/pull/171) | `text-caption`/`text-ui` replace arbitrary 13/15px sizes, stray radii use the radius tokens, new primitives are mapped for `/design-sync`, visual spec §16.4 lists them. Stacked on #170. |
| Design-system re-sync | [#173](https://github.com/ENGGP/thunderstrux/pull/173) | `.design-sync/` inputs only, no app code. The "Thunderstrux UI" project now has 17 primitives, each with a graded preview: `EmptyState`, `ResponsiveTable`, `DateField`, `DateTimeField`, `MoneyInput` and `AuditTimeline` added; all 11 earlier cards were regraded against the new tokens. A declared converter fork keeps `next/link` files (`FilterBar`, `LinkTabs`) out of the bundle, and the CSS safelist now has the `sm:`/`md:`/`lg:` variants the conventions promise. Validation: render check 17/17 clean, 0 bad; upload verified by file listing (95 files). |
| Renovate digest release age | [#174](https://github.com/ENGGP/thunderstrux/pull/174) | Docker digest PRs no longer wait on `renovate/stability-days`, which can never pass for them (no release timestamp); #50 sat pending for two weeks. Strict config validator passed. See [[Dependency Automation]]. |

**Development activation (2026-10-25).** The dev app was restarted on the #167 branch (no migration) and now serves main at `478b4e6`. As `member@example.com`, a $1.00 test-mode checkout for "Super launch" stored its hold exactly 300 s past Stripe's `expires_at`. The cancel page read "holding until 2:40 am" (Stripe's time) at 375 and 1280 px. Cancel order then expired the order and released the hold.

**UI audit (2026-10-25, read only, then fixes).** Every reachable page of the dev app was walked at 390 and 1280 px and compared with the "Thunderstrux redesign" canvas and the UX and visual specs. Most screens match; the misleading or clipped items were fixed (UI-003, DEF-036), and the remaining consistency findings are UI-004. Agreed with the maintainer through a `grill-me` interview: P1 fixes first in one PR, then audit pass 2 on demo content created through the app (a plan, products with photos, an event image, a draft), then the consistency pass (PR B) and the design-system and docs sync (PR C).

**Audit pass 2 (2026-10-25).** Demo content was created in dev through the app as the Engineering organiser: profile text, refund and pickup policies, logo and cover, two published products with photos (EngSoc hoodie, Enamel pin), the free "Semester 2 2026" plan, an image and $0.50 member price on Super launch, and the draft "CAD workshop for first-years". Writes from `http://localhost:3080` are refused as untrusted; use `http://127.0.0.1:3080`, which `.env` trusts. Free memberships can't complete in dev until `EMAIL_FROM` is set in `.env` (DEF-037).

### Security audit remediation (T47 to T53) and test audit

| Item | PR | Status and evidence |
| --- | --- | --- |
| Test audit findings | [#193](https://github.com/ENGGP/thunderstrux/pull/193) | The merchandise Pickups buttons' accessible names now start with their visible words: axe-core 4.14 (#189) failed the browser campaign on main on them, so the webhook step hadn't run since (DEF-046, WCAG 2.5.3). A paid ticket Session that isn't its order's now alerts a person to refund it (PAY-010), and the CSRF check reads session cookies as Auth.js does, so a lone chunk needs a token (SEC-027). New tests: the payments webhook route (a PaymentIntent named by id, a failure before commit retried once, refund routing by metadata, 503 without Stripe), a commerce PaymentIntent by id, Stripe account statuses and a platform not ready for Connect, buyer status precedence, the confirmed page's privacy, checkout polling, unverified commerce disputes and refunds, and audit rows for the 30 actions no test checked. Removed a test that only exercised Prisma, four duplicates and a legacy demo-data guard; merged check-out's two refusal tests, seven stale-read tests into one, and three availability tests into one table. Docs: the UX spec states T46's fee; journey evidence names `inventory-locks`; a browser test tool update needs a browser campaign. Baseline `baseline-b804a38b50797943158c3f63` on `4bbd6f9` plus this change: 44/44 runner guards, typecheck, 748/748 integration tests in 105 files, no known vulnerabilities. Browser `browser-c94009db98b26f9a705ca590`: 9 MFA-step, 69 desktop/mobile (clean accessibility scans) and 10 webhook-step checks, including both connected journeys, passed. The first run, `browser-872deb2b8ed7d8950f19d919`, caught two faults in the first pickup fix. The baseline ran before that second fix, which changed only the button's class and hidden text. |
| Test audit tiers 2 and 3 | [#192](https://github.com/ENGGP/thunderstrux/pull/192) | Removed the unused `POST /api/events/[eventId]/ticket-types`, which got around the 50-type cap, the event lock and the version check (DEF-045). Route tests for staff role changes, notice resends, guest merchandise checkout and cancel, profile, compensation confirm, asset preview and delete, valid MFA codes on cancel and membership end, event edit refusals; History, basket, client error messages, the success page's production guard and the recovery, refund and worker give-up paths. Fixed a refund test that never ran its disputed-charge case (DEF-044). Shared guest and MFA test helpers. Gaps measured with V8 coverage first; per-route origin and rate-limit returns left to their own tests. Baseline `baseline-40474f9a30d50919678f0aa1` on `2bc1c3b`: 44/44 runner guards, typecheck, 754/754 integration tests in 104 files, no known vulnerabilities. |
| Test audit tier 1 | [#191](https://github.com/ENGGP/thunderstrux/pull/191) | No app code. The integration setup pins its behaviour switches, so the dev `.env` no longer changes results (DEF-042). 29 new tests cover money and security failure paths: ticket webhook mismatches and late expiries, compensation refund retries and failures, dispute reversal failures, commerce checkout and payout failures, MFA errors and routes with real codes, and CSRF and the Referer fallback, whose old test never reached it (DEF-043). Opened PAY-010 and SEC-027 from what the tests showed. Baseline `baseline-c15eef8548fc26a1e27f7d3c` on `f449557`: production build, 44/44 runner guards, typecheck, 734/734 integration tests in 104 files, no known vulnerabilities. |
| Retire smoke test | [#190](https://github.com/ENGGP/thunderstrux/pull/190) | DEF-041: `pnpm test:smoke` had failed at step 4 since the trusted-origin guard. Retired `scripts/smoke-test.mjs` and the `test:smoke` script instead of repairing them, because the E2E and `_test` integration suites cover all 22 steps (mapping in the register). Docs and diff checks only. |
| Organisation create id guard | [#187](https://github.com/ENGGP/thunderstrux/pull/187) | DEF-040: Organisation's logo and cover relations include its own id, so an organisation create naming no relation column fails with P2011. Fixed the one affected caller (`scripts/smoke-test.mjs`), documented the rule in the schema, and added `organisation-creation.test.ts`. DEF-041 records that the smoke test has failed at step 4 since the trusted-origin guard. No app or schema behaviour change. |
| T53 hardening bundle | [#181](https://github.com/ENGGP/thunderstrux/pull/181) | Full 16-byte AES-GCM tags; CSRF binds the first of duplicate session cookies, as Auth.js does; staff order and asset locks carry the tenant; a lost dispute holds payouts until its reversal settles; hosted config pins MFA enforce and legacy deny; IPv6 rate-limit keys use the /64; closure waits for pending membership and merchandise orders; check-in search keeps its filter on later pages; restore keeps database URLs out of process arguments and the Droplet keeps seven dumps; `.gitignore` covers keys and dumps; opening the Stripe dashboard needs a fresh code. No migration. Baseline baseline-30d63d719b0a2423b5c3964a on d857c90: production build, 44/44 guards, typecheck, 703/703 integration tests in 103 files, no known vulnerabilities; full E2E browser-4d0cd8d9cbd870dff4efe62a passed (9 + 69 + 10) and operations rehearsal ops-986729960d passed on 1c08e03 (later commits change only the settings dialog's empty-code request and one test); runner tests 43/43; the dashboard code dialog checked at desktop, tablet and phone. |
| T52 thunderstrux.com readiness | [#180](https://github.com/ENGGP/thunderstrux/pull/180) | Unsigned-webhook alerts cooled to one per five minutes (SEC-020); public images answer 304 and HEAD from the row with one shared S3 client (SEC-021); only `main` publishes and attests, and the deploy accepts only the two release repositories (SEC-022); a restore fences identity and the runbook rotates `AUTH_SECRET` (SEC-023). [[Pre-hosting Candidate]] gains the `thunderstrux.com` go-live checklist. No migration. Baseline baseline-78f56b6587d0255c2a025528 on ca54f4b: production build, 44/44 guards, typecheck, 695/695 integration tests in 103 files, no known vulnerabilities; operations rehearsal ops-e2919055e2 passed with the identity fence checked; runner tests 43/43. The release workflow change takes effect on the next `main` run. |
| T51 events, staff and notices | [#179](https://github.com/ENGGP/thunderstrux/pull/179) | Notice and ticket subjects fold line breaks (SEC-003); an edit can't move a sold event's end into the past (SEC-004); revoking staff revokes their pending invitations (SEC-006); unpublish rechecks orders under the event lock (SEC-009). No migration. Baseline baseline-99376805e00335929ff28289 on 402f543: production build, 42/42 guards, typecheck, 694/694 integration tests in 103 files, no known vulnerabilities. No UI change; E2E not required for this risk. |
| T50 checkout holds, refunds and disputes | [#178](https://github.com/ENGGP/thunderstrux/pull/178) | One buyer's unpaid ticket holds per event stay within 10 and one unpaid merchandise basket per society, else 409 `purchase_in_progress` with its own checkout message (SEC-005, SEC-010); `checkout_create` is keyed on the buyer, not the address. A refund that may already exist stays `uncertain` on a failed lookup (SEC-011). With several disputes on a charge the order shows the worst, and a restore needs them all won (SEC-024); `prevented` counts as won. No migration. Baseline baseline-16713fefbf7ba93fd121e49b on 1ecacee: production build, 42/42 guards, typecheck, 690/690 integration tests in 103 files, no known vulnerabilities; full E2E browser-6bb5dcabd10d10b52f2400b4 passed (9 + 69 + 10). The new checkout message reuses the existing refusal screen; it was not checked in a browser. |
| T49 accounts and recovery | [#177](https://github.com/ENGGP/thunderstrux/pull/177) | Signup, verification and reset each have their own per-address bucket (SEC-026); verification needs the account's password and a completed reset verifies the address (SEC-008); duplicate sign-in `email` fields are refused (SEC-007); normalised `//host` return paths are refused (SEC-012); an unknown reset token costs no hash (SEC-019 source part). `/verify-email` gains a password field. Audit rows SEC-001/SEC-002 renamed SEC-025/SEC-026, as those IDs were already external gates. A wrong verification password says to check the password. No migration. Baseline baseline-14ab92a45a467642772013df on 669a71c: production build, 42/42 guards, typecheck, 685/685 integration tests in 103 files, no known vulnerabilities; full E2E browser-45fbe13b1c90a36cded8c4b8 passed (9 + 69 + 10); account-verification.test.ts 13/13 again on 7f48817 after the message change; `/verify-email` checked at desktop, tablet and phone. |
| T48 production-profile preview | [#176](https://github.com/ENGGP/thunderstrux/pull/176) | `allowedDevOrigins` lists no public host and Next's dev MCP endpoint is off; `AUTH_SECRET` falls back only in tests and builds (production needs 32 characters); guest and context cookies follow the public URL's scheme; the seed refuses a public origin without `SEED_DEMO_PASSWORD`. The preview moves to `ops-preview` (README, Public Preview). No migration. Baseline baseline-33b8bc3817d47b15a6a79d6a on 908244e: production build, 42/42 guards, typecheck, 680/680 integration tests in 103 files, no known vulnerabilities; operations rehearsal ops-ad72c25e25 passed. |
| T47 request bounds | [#175](https://github.com/ENGGP/thunderstrux/pull/175) | Ticket types capped at 50, JSON bodies at 100 KB through one `readJsonBody`, validation answers at 20 issues, and `/_next/image` off. No migration. Baseline `baseline-d43e7a4d2bab3a203b1d1261` on `2637fe2`: production build, 42/42 guards, typecheck, 674/674 integration tests in 102 files, no known vulnerabilities. |

## Living notes, moved 2026-10-26

Dated sections taken out of living notes by the documentation audit, verbatim, with the note and section they came from.


### Payment Lifecycle — Validation

- Fresh migration and Prisma generation pass.
- 213 integration tests pass, including lifecycle ordering/idempotency, concurrent replay, tenant isolation, actor attribution, ambiguous identity, late-paid compensation, manual-refund recovery blocking, cleanup concurrency, and stale-worker fencing.
- Typecheck, production build, 15 browser/signed-webhook tests, 13 runner-safety tests, and the high-severity audit pass (no known vulnerabilities).
- Three consecutive runs on unchanged implementation revision `138c982` each passed all 15 browser/signed-webhook tests with cleanup: `p216-d057dd2d2efe4f3aa17a417c`, `p216-dbf811d56f13115a5084c9ba`, and `p216-049df43b5b5520a8597ff398`. They cover history pagination, desktop/mobile overflow, tenant denial, and concurrent/expiry transport. Desktop/mobile history screenshots were inspected.
- Final operations rehearsal `p217-ci-2931ec054f` passed backup/restore with a lifecycle event, outage probes, corrupt-archive quarantine, rollback compatibility, and migration-failure blocking.
- Independent review identified an incorrect compensation reservation after-state; the journal now reads the actual resulting reservation, with regression coverage. Follow-up review found no further correctness issues.
- Real Stripe campaign `p216-20010cf603f4e0763ec530c1` passed success, decline, manually attested cancellation, and forced expiry on API version `2026-03-25.dahlia`. It verified the new lifecycle sequence and real Stripe event correlation, destination-charge configuration, inventory, tickets, outbox, and buyer visibility. Listener HTTP 200 and app receipt were correlated. Stripe cleanup and run-owned resource cleanup passed.
- Real event evidence: success `evt_1UHz3tRuN9MD4SvFpGbf8zTn`, decline/expiry `evt_1UHz62RuN9MD4SvFMJeKqd9x`, cancellation/expiry `evt_1UHz8uRuN9MD4SvFZRbGqV1c`. This does not claim natural timeout or email-provider delivery.
- Implementation revision: `138c982`; merged through [PR #13](https://github.com/ENGGP/thunderstrux/pull/13) after five latest-head checks passed. Local evidence did not replace CI.
- See [[E2E and Staging Payments]] for the real Stripe acceptance procedure required after payment-path changes.

### Analytics and Calendar — Calendar (T33)

- An event shorter than 24 hours, even past midnight, sits on the day it starts with its end day named ("10:00 pm to 2:00 am Sun"). Longer events span each day they touch, splitting at week edges with "continues" and "until". The small hours belong to the night before: a day it reaches only by 6:00 am doesn't count, so a workshop from Wednesday 1:00 am to Thursday 3:00 am sits on Wednesday alone, in the month and in Wednesday's time grid from 1 am (fixed 23 Oct 2026; before, it spanned both days and sat in the week's All day row). Spanning events still use the All day row in the week. Every month chip carries its full name and times as a tooltip.


### Database and Multi Tenancy — Database Integrity Audit And Numeric Constraints

Latest local Docker audit before Phase 3 migration: 14 checks, 0 violations.

### Database and Multi Tenancy — T41 checks, the paid-total constraint and the upgrade rehearsal

Representative plans, 23 Oct 2026 (`EXPLAIN ANALYZE` on a synthetic `scale_plans_test` database, one society with 400,000 audit rows over three years, 85% of them check-ins, among 1,000,000 rows in 11 societies, and 13,000 events): History's first page reads 52 rows backwards along `AuditLog(organisationId, createdAt)` in 0.4 ms; one person's actions use `(organisationId, actorUserId, createdAt)` in 0.2 ms; a month of staff actions takes 0.9 ms; the rarest filter (payments setup, one row in 1,000) skips 52,000 rows in 13.4 ms. A calendar month reads one society's 3,000 events through `Event(organisationId, status)` in 1.0 ms (0.6 ms for published only). No index was added.

### Dependency Automation — Asset runtime qualification (2026-10-11)

T07 adds explicit Sharp 0.35.5 and AWS S3 SDK 3.1149.0 pins. The checksum-pinned SeaweedFS 4.48 upstream binary failed its fixable high/critical scan (x/net CVE-2026-78669 and Go stdlib CVE-2026-78667/78669/97031). `docker/Dockerfile.assets` rebuilds that exact source with digest-pinned Go 1.27.2 and x/net 0.60.0; the delivery image scan passes. The existing Node base also inherited vulnerable perl-base 5.36.0-7+deb12u3; explicit security-repository refresh in `docker/Dockerfile` installs the patched package. Pinned Trivy 0.68.2 scans of both final images report no fixable high/critical findings. Both Dockerfiles pass pinned Hadolint. This is dated local evidence, not ongoing advisory clearance or hosted activation.

### Dependency Automation — Current dependency remediation

Package 3 adds the asset dependency/image boundary above. Its dated baseline is `15a1e4b` / `p216-e62123415fe7e1788a49219e` (354 tests/42 files, build/typecheck and clean audit); final UI `5931086` also passes its production browser build and 30 checks. Local app dependencies and persistent image storage were activated on 2026-10-12 after backup; hosted activation remains unverified. [[Project Handover]] owns the latest overall validation and rollout state. The dependency campaigns below are dated evidence, not the latest overall campaign.

#### Vite and Vitest advisories (2026-10-22)

On 2026-10-22 the baseline audit began failing on `main` with eight development-only advisories published after 19 October: six in Vite 8.3.2 and two in `@vitest/mocker` below 4.1.12 (manual mock code injection; Windows backslash path traversal). Renovate security [PR #126](https://github.com/ENGGP/thunderstrux/pull/126) moved Vite to 8.3.3 (`dd93c81`). Vitest is pinned to 4.1.12, which moves every `@vitest/*` package to 4.1.12 and needs no other change; 4.1.12 is the latest 4.x release. Neither package ships in the app image; the integration runner is the only consumer. Local baseline `baseline-1ea53cc6a75a20ab0196acdd` on `dd93c81` plus this pin passed frozen installation, the production build, 30/30 runner guard tests, typecheck, all 595 integration tests in 84 files and the audit with no known vulnerabilities; its manifest records `passed` and `cleanupComplete`.

#### Redis client update qualification

[PR #52](https://github.com/ENGGP/thunderstrux/pull/52) merged `@redis/client` 6.2.1 to 6.3.0 on 2026-10-13 as `eff2184`, while follow-up qualification was in progress. The update retains the Node >=20 requirement (the app uses Node 22.23.3) and removes `cluster-key-slot` because upstream vendors that implementation. Thunderstrux uses a standalone client for readiness `PING` and the atomic rate-limit Lua `EVAL`; upstream connection/reconnection changes make outage/recovery evidence part of this update's acceptance. Added regression/fixture coverage is delivered separately from the already-merged pin update.

`tests/integration/redis-runtime.test.ts` uses the installed client and a run-owned Redis, with an isolated TCP path for connection interruption. It checks shared cold-start connection, concurrent counters, 429/Retry-After/TTL, bounded failure, sensitive-policy 503, existing optional-policy behavior and recovery retaining the counter. It deletes only its own random-prefix keys. `INTEGRATION_REDIS_URL` identifies the disposable service: Docker E2E Compose uses `redis://redis:6379`; the manual Dependency Validation integration job supplies its own Redis at `redis://localhost:6379`. Other integration entrypoints must provision an isolated Redis and set that variable; do not point tests at development or production Redis.

Merging package/lockfile pins does not activate the installed development dependency cache. After maintainer merge, use the existing dependency refresh procedure in [[Troubleshooting]]; preserve PostgreSQL, Redis and asset volumes. Hosted release images must be rebuilt and reviewed separately. Rollback restores the 6.2.1 manifest/lockfile and rebuilds/refreshes dependencies; this update needs no data migration or database rollback. The live tunnel is not refreshed as part of PR qualification.

Local Redis 6.3.0 qualification on 2026-10-13: source/test/fixture inputs `8231530` pass frozen Docker installation, production build/typecheck, all 380 integration tests in baseline `p216-a888af193938da9ec374a603`, and dependency audit with no known vulnerabilities. The real Redis regression passes; both test images report installed client 6.3.0. Thirty runner safety checks also pass. The earlier test typing failure was corrected; an interrupted run was cleaned up and is not qualification evidence. [[Project Handover 2026-10-15]] records completed browser and resource-cleanup evidence for the separate coverage follow-up.

The D1-D5 dependency fixes were published through [PR #3](https://github.com/ENGGP/thunderstrux/pull/3), merge `b81c631`. The [post-remediation Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35290377481) passed. GitHub reported zero open dependency alerts on 2026-09-18. The failed runs and counts below are historical evidence.

The current security baseline is owned by `package.json` and `pnpm-lock.yaml`: Next.js 16.3.8, NextAuth 5.0.0-beta.32, paired Prisma client/CLI 6.19.3, PostCSS 8.5.28, pnpm 10.34.7, and Node 22.23.4 (from 22.23.3 on 2026-10-22 for the 21 Oct Node security release, High: CVE-2026-111497, CVE-2026-106069, CVE-2026-105482). The reviewed override `@prisma/config@6.19.3>deepmerge-ts=8.0.2` is restricted to that parent. On the next Prisma update, remove it when the selected config package resolves a patched version natively, then rerun the config regression, Prisma generation and migrations, integration tests, production build, and full audit. `tests/integration/dependency-security.test.ts` covers native Sharp processing, JWT/Auth.js behavior, and Prisma config loading.

#### October 2026 transitive security patches

[PR #39](https://github.com/ENGGP/thunderstrux/pull/39) patches the two high-severity findings in the [2026-10-07 scheduled audit](https://github.com/ENGGP/thunderstrux/actions/runs/37604274931): `source-map-js` indexed source-map denial of service and Sharp's vulnerable librsvg dependency. Exact pnpm overrides select `source-map-js=1.2.2` and `sharp=0.35.5`; the lockfile updates Sharp's platform binaries and libvips packages together. No advisory suppression or audit threshold change is used.

Remove each override only when its upstream dependency graph resolves a patched version without it, then verify frozen installation, audit, build and applicable regressions. The existing native Sharp resize/encode regression covers compatibility. Merging the lockfile does not refresh a running app or its dependency volume: rebuild the release image or refresh the development dependencies without deleting database/Redis volumes. Rollback restores the vulnerable dependency graph and needs an explicit security decision.

Review on 2026-10-09 found additional Next.js advisories after Copilot's audit. The original patched graph passed build/typecheck and 311 integration tests, but audit failed with six Next.js findings (one high, four moderate, one low). Next.js is therefore pinned to 16.3.8, including the patch for [image-optimization SSRF](https://github.com/advisories/GHSA-cjq9-62q9-8jv4). Current configuration has no remote image allowlist; that limits exposure to this specific advisory but does not justify leaving the audited dependency vulnerable.

Final local baseline on executable `b3f965d`, run `p216-4eeb6f57df076e27f533e459`, passed frozen installation with pnpm 10.34.6/Node 22.23.3, production build, typecheck, all 31 migrations, 311 integration tests in 36 files (including native Sharp compatibility), and audit with no known vulnerabilities. Its manifest records `passed` and `cleanupComplete`. The earlier Docker-unavailable attempt and original-graph audit-failed run were also cleaned. Final documentation-only evidence updates use docs/diff checks; no browser/payment/operations campaign is required because those contracts and test infrastructure did not change. At that qualification, no development or hosted deployment was performed and running images/dependency volumes still required refresh. The dated local runtime refresh below records subsequent development activation; hosted activation remains unverified.

### Dependency Automation — P2.15 status

The original P2.15 integration gate passed locally: 185/185 tests, including 22 Stripe Connect disclosure tests. The four original failures were reproduced on `c8878fe` and fixed separately from dependency infrastructure without weakening their expectations. See the evidence below.

Repository-side P2.15 implementation and evidence are merged through PRs #1-#5, #7, and #8. Renovate is authorized and operational: [Dependency Dashboard #6](https://github.com/ENGGP/thunderstrux/issues/6) proves npm and GitHub Actions discovery with Docker exclusions, and controlled [PR #7](https://github.com/ENGGP/thunderstrux/pull/7) merged as `b3f4fce`. All five post-merge checks passed on `main`. The non-required `renovate/stability-days` status remained pending for this pin update; it was not a failed application test. Overall P2.15 remains **Open - operational evidence pending**: a real eligible high/critical advisory is needed to verify a security-labelled Renovate PR, while maintainer notification receipt must be recorded after the next genuine Security Audit failure, including a registry failure.

Routine Renovate evidence advanced on 2026-09-28: [PR #20](https://github.com/ENGGP/thunderstrux/pull/20) updated all workflow Node 22 inputs to 22.23.3, and [PR #19](https://github.com/ENGGP/thunderstrux/pull/19) updated the pinned `pnpm/action-setup` v4.1.0 digest. Both were manually reviewed, merged, and passed all five latest-head checks. These routine updates do not satisfy the outstanding genuine security-PR or failure-notification evidence gates.

### Dependency Automation — Security audit operations

Security Audit runs Wednesday at 03:00 UTC and manually. It audits all dependencies at severity `high`, including development/build tooling. High/critical findings and registry errors fail the job visibly. This scheduled job is not a required PR check. Subscribe the repository maintainer to workflow failure notifications and triage each failure; never suppress registry failures or use an automatic audit fix.

The original audit reported 41 vulnerabilities (5 critical, 21 high, 15 moderate), with 54 separately counted GitHub alerts. [[Dependency Advisory Triage 2026-09-18]] retains that historical inventory. D1-D5 fixes are merged; the current baseline, owner, override rationale, removal condition, and rollout limits are recorded above. No advisory suppression is used. A new high/critical finding or registry failure must still fail the audit.

### Dependency Automation — External rollout checklist

These actions require a repository administrator; configuration files alone do not activate them.

1. Completed: reviewed changes are published and all three Dependency Validation checks passed.
2. Completed: Renovate is authorized for `ENGGP/thunderstrux`, created [Dependency Dashboard #6](https://github.com/ENGGP/thunderstrux/issues/6), and Dependabot alerts report zero open findings. Dependabot update PRs remain disabled, leaving Renovate as the only update bot.
3. Completed: `static-validation`, `integration-tests`, and `production-build` remain strict protected-branch checks; `security-audit` is not required.
4. Completed: controlled CI-only [PR #7](https://github.com/ENGGP/thunderstrux/pull/7) initially pinned Node 20 to 20.20.2 and workflow Node 22 to 22.23.2. [PR #20](https://github.com/ENGGP/thunderstrux/pull/20) later updated every workflow Node input to 22.23.3, and [PR #19](https://github.com/ENGGP/thunderstrux/pull/19) updated the pinned `pnpm/action-setup` digest. These changes touched no manifests or lockfile and passed all five latest-head checks. Dockerfile, Compose, and workflow service images remain excluded from Renovate.
5. Pending: security-PR evidence requires a real eligible advisory. Maintainer failure-notification receipt requires the next genuine audit failure, whether caused by an advisory or a registry error. Never downgrade dependencies, introduce a vulnerability or cause a registry failure to manufacture evidence.
6. Mark P2.15 complete only after both pending evidence items are recorded.

GitHub vulnerability alerts were enabled during implementation. The historical dependency graph contained 205 packages and 54 open alerts; after remediation, a 2026-09-18 API check found zero open alerts. Renovate authorization and repository discovery are evidenced by [Dependency Dashboard](https://github.com/ENGGP/thunderstrux/issues/6) and controlled PR #7. The repository-side deployment (task P2.17), migration, health, backup/restore, and rollback tooling is implemented; external production activation remains outstanding. Real browser/Stripe tests are covered by P2.16.

### Dependency Automation — GitHub rollout evidence (2026-09-18)

- [Implementation PR #1](https://github.com/ENGGP/thunderstrux/pull/1) merged with a regular merge commit `05d9502`, preserving the original four commits plus advisory assignment commit `178d431`. There were no upstream conflicts; remote branches were retained.
- [Validation run 35231538737](https://github.com/ENGGP/thunderstrux/actions/runs/35231538737) passed all three jobs for commit `6b3fb9e176120ac56302239de51a41afcebc29af`.
- After that green run, `main` branch protection was configured and read back: require `static-validation`, `integration-tests`, `production-build`, bound to the observed GitHub Actions app (15368), require an up-to-date branch, enforce for administrators. No audit check or new reviewer-count requirement was added.
- Completed after initial rollout: Renovate authorization, Dependency Dashboard #6 and controlled PR #7 validation and merge. Docker dependencies are absent from the dashboard because their managers and datasource are disabled. Dependabot update PRs remain disabled. Eligible vulnerability-PR evidence awaits a real advisory; maintainer notification evidence awaits the next genuine audit failure.

### Dependency Automation — Original P2.15 local verification

Before the authorization fix, isolated runs of `organisation-connect-disclosure.test.ts` on both clean commit `c8878fe` and the P2.15 working copy produced the same 9 passes / 4 failures. This demonstrates that the failures predate the infrastructure changes. Both used disposable PostgreSQL 16 databases (`baseline_test` and `current_test`) and equivalent fake Stripe environment values.

The authorization fix adds a bounded broad-capability check before input validation, while retaining separate target-tenant authorization and the first-party-origin guard first for mutations. Active owner/admin staff can manage Connect regardless of account role. Safe legacy ownership applies only when no staff row exists for that user/tenant pair; revoked, invited or downgraded staff cannot regain authority through legacy fallback. Unrelated staff membership does not erase legitimate legacy ownership. Missing/unrelated/revoked target access remains non-disclosing, while broad lack of capability remains 403.

After the fix: focused suite 22/22; complete suite 185/185; typecheck and production build passed. Added regressions cover member owner/admin access, malformed/missing/valid unauthorized requests, cross-tenant 404 body equivalence, target-role denial, legacy ownership, same-session revocation/invitation/downgrade, origin ordering, no provider calls and no organisation changes on denial. Original disclosure assertions were retained. Clean-environment fixture corrections keep dates relative and supply fake Stripe credentials.

Validation uses a disposable source copy and database, preserving the running app and workspace build files. The frozen install left `pnpm-lock.yaml` byte-for-byte unchanged; typecheck and the production build passed. The non-test database guard refused a `production` database before attempting a connection.

Both workflows passed actionlint 1.7.7. Renovate configuration passed validator 44.93.4 with Node 24.11.1; installation emitted engine warnings from the bootstrap Node 20 process, and the validator reported its optional RE2 fallback. Action SHAs were resolved from their official upstream release tags.

### Dependency Automation — Historical completed rollout evidence (2026-09-18 Australia/Brisbane)

- [Fresh pre-merge validation](https://github.com/ENGGP/thunderstrux/actions/runs/35236969551) passed all three required jobs for `178d431`.
- Local disposable Docker validation passed frozen installation, Prisma generation, typecheck, all 185 integration tests (including 22 Connect regressions), and production build against PostgreSQL 16 database `p215_test`.
- [Manual Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35286130474) ran from merged `main` (`05d9502`), started 2026-09-17 23:17:07 UTC (2026-09-18 09:17:07 Brisbane). Installation passed; the audit failed with exit code 1 after reporting 41 findings: 5 critical, 21 high, 15 moderate. This expected failure proves advisory detection; it is not a green audit or vulnerability remediation.
- GitHub's separately counted open-alert inventory remains 54: 9 critical, 24 high, 21 moderate. D1-D5 owner: ENGGP repository maintainer. Deadlines: D1/D2 2026-09-21; D3/D5 2026-09-25; D4 2026-10-02.
- Branch protection was read back: strict/up-to-date, administrator enforcement, and the three GitHub Actions checks remain required. Security Audit remains non-required and scheduled Wednesdays at 03:00 UTC.
- Lockfile unchanged: Windows checkout SHA-256 `6E4D3BD138B75D817D349AB7CB43784B1BEEF47ED0A1965D11C53BE1FFCBA080`; committed LF archive and validated Linux copy both `31d8d163e8b7a81effe7ac97041afec243c18900a8720ecb8967c13662bad95f`. The difference is checkout line endings.
- This historical rollout evidence was published through documentation-only PR #2. The production-readiness plan is now synchronized with current rollout status.

### Dependency Automation — Finalisation evidence (2026-09-18)

- [PR #4](https://github.com/ENGGP/thunderstrux/pull/4), merge `3229578`, ignores generated `next-env.d.ts` and runs `next typegen` before standalone typechecking. [Main validation](https://github.com/ENGGP/thunderstrux/actions/runs/35292254371) passed all three jobs.
- Branch protection still requires `static-validation`, `integration-tests`, and `production-build`, with up-to-date enforcement. Security Audit remains non-required.
- Windows dependencies were refreshed using pnpm 10.0.0 and the frozen lockfile; Prisma 6.19.3 generation passed. This replaces the previously stale host installation.
- Finalisation validation passed: host typecheck (Node 22.18.0), all 21 installed direct dependency versions match the manifest, and host audit reports no known vulnerabilities. Isolated Node 20 validation passed frozen installation, Prisma generation, typecheck, all 190 integration tests, production build and audit. Production HTTP checks passed for homepage, login, health, compiled CSS, malformed-token redirect and invalid image input. No package or lockfile changes were needed.
- Renovate 44.93.4 strict configuration validation passed (optional native RE2 unavailable; validator used its documented RegExp fallback). Independent read-only review found no concrete issues. Docker image exclusion includes workflow service images through the Docker datasource rule.
- Renovate authorization completed after finalisation. Dashboard #6 and merged PR #7 provide repository discovery and controlled-update evidence; Docker dependencies are absent as configured. PR #7's five post-merge checks passed; its non-required release-age status remained pending for a pin update.
- Overall P2.15 remains Open only for security-PR proof after a real eligible advisory and maintainer notification receipt after the next genuine audit failure, as explicitly selected by the maintainer.

### Dependency Automation — Local runtime refresh (2026-10-10)

The local development dependency volume still held Next 16.3.5 while package.json pinned 16.3.8. `node scripts/recreate-dev-app.mjs` refreshed the development image and verified dependency cache without changing package/lockfile pins or database/Redis volumes. Runtime Next 16.3.8, generated Prisma Client, 32 applied migrations, affected dashboard compilation and readiness 200 were observed. [[Troubleshooting]] and [[Project Handover 2026-10-12]] record the archive/key retention and local configuration recovery. This activates the dependency patches in local development only; hosted release images still need separate rollout and verification.

### E2E and Staging Payments — Validation evidence

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

### E2E and Staging Payments — Completion gates

- Historical P2.16 baseline: 190 integration tests. Current Package 3 baseline: 354 tests in 42 files on `15a1e4b`, run `p216-e62123415fe7e1788a49219e`, with build/typecheck and clean audit. Final UI revision `5931086`, run `p216-86e01a93979f3ffc3d963f33`, passed 30 complete checks (3 MFA, 20 browser/mobile/account/profile/discovery, 7 signed webhook/notification); both cleanups completed. Earlier counts below retain their dated evidence.
- Select local regression and E2E coverage using [[Engineering Delivery Workflow]]. One complete successful applicable run with cleanup is sufficient; repeat only for changed inputs, failures or a documented reliability concern. Cancelled, skipped or partial required scenarios do not qualify.
- GitHub E2E and operations workflows are manual-only and are not merge requirements. Documentation-only evidence updates run docs/diff checks and claim review, without functionality tests or a new provider campaign.
- Preserve tested-revision evidence and explain its applicability to the reviewed diff. Historical repeated local/CI campaigns below remain evidence of past delivery, not current repetition requirements.
- Require observed real Stripe evidence for every scenario in the table above (T45), including manual cancel attestation, forced expiry with automatic reconciliation, and refund events. The test explicitly expires unpaid Sessions through Stripe; it does not claim to observe natural timeout. Missing or skipped scenarios remain outstanding.
- See [[Project Handover]] and the evidence ledger in [[MVP_READINESS_PLAN]] for current evidence.

### Production Operations — Account Closure Release Compatibility

Migration 20261005030000_account_closure adds permanent User closure markers, immutable Order buyer contact captures and integrity constraints. Run the one-shot migration before app/worker rollout. No legacy account is automatically closed and no historical purchase-time identity is invented. A user-initiated closure anonymises login/profile irreversibly through the app while preserving business/audit/security and buyer contacts. Database backups consequently contain retained personal information and require the existing access/encryption/retention controls.

Before rollback to an older app/worker, pause closure/account mutations and buyer contact/ticket email flows: older images do not resolve retained snapshots or fence staff/MFA credential races. Restoring a backup into a disposable _restore_test database verifies records/constraints; restoring old non-disposable data would be a separate explicit recovery decision and must not silently reactivate closed accounts. Independent review before activation remains required. Development and production stacks are not deployed by local qualification.

### Production Operations — Private invitation rollout and recovery

Apply `20261009010000_private_staff_invites` once before rolling out app and notification workers. Preserve and separately back up the notification key: database-only restoration cannot decrypt invitations. The disposable operations rehearsal verifies a version-linked encrypted invitation survives backup/restore and decrypts with the recovered run key, alongside deployment, migration and rollback guards. Additive columns can remain after code rollback, but pause invitation acceptance and delivery before rolling back to code lacking version/role-preservation checks. Existing pre-migration digests remain redeemable only under the new guards; no recovery mail is fabricated. Repository delivery does not activate development or hosted stacks; independent security/migration review and real provider acceptance remain separate gates.

### Production Operations — Handover rollout and rollback

Handover uses the existing schema; apply the Package 2 migration before release as usual. Confirm named incoming staff have verified email and enforced MFA enrollment before retiring committee access. No credentials or Stripe connection move. Code rollback does not restore accountUserId or outgoing access; pause handover/owner mutations before reverting to code lacking the shared ownership guards, and recover authority only through explicit audited management. The disposable recovery rehearsal verifies retired pointer, active incoming owner, revoked outgoing owner and audit continuity survive restore; independent production review remains a release gate.

### Pre-hosting Candidate — Evidence

| What | Runs |
| --- | --- |
| Combined local qualification (T44d) | baseline `baseline-b2ff8cf634def9f550fa6665`, browser `browser-7d05b953af18e5356cfdd5dc`, operations `ops-17701f7891`, Droplet `droplet-707dfb0351` on `3ccada0` |
| Provider acceptance (T45) | Stripe test mode, nine scenarios (`staging-741aec2c…`, `staging-20ffc6bc…`, `staging-02b236b7…`); Resend accepted ticket receipts; storage blocked (OPS-005) |
| Commerce recovery (PAY-003) | baseline `baseline-9734427260591184e71e8334`, browser `browser-f884013075b6ac47e03097d7`, operations `ops-b747a83484`, staging `staging-a828d3d0…`, `staging-f5d4c10a…`, `staging-d1981708…` |
| T46 (fee, public pages, audit) | baseline `baseline-c0ff0efd8c4250c005ff024e` on `3e4bb68` (41/41 guards, 642 integration tests in 98 files, typecheck, clean audit); browser `browser-598296fd5c1112147bf994eb` on `78cc794` (9 MFA, 68 desktop/mobile with the Fees, Help and Privacy screenshots, 10 webhook checks). The commits after `3e4bb68` change only the public pages' layout and copy and their browser test. Staging `staging-531f5b0f778b85d1fe58fbf2` on `3e6f323` confirmed the new fee on real Stripe test mode: a $12.00 ticket carried a $1.34 application fee, and the full refund returned the $12.00 and the $1.34. |
| Stripe audit (DEF-031, PAY-004 to PAY-006) | #159 baseline `baseline-1f95f18e…` and browser `browser-7422320a…`; #160 baseline `baseline-986612515c5fbf9bf704355a`, operations `ops-cb89090db0`, staging `staging-d456141b…` (dispute reversed); #162 baseline `baseline-5a9e0e1f365e986ce8e74d58`, browser `browser-9f3bc87f…`, operations `ops-b68382c0ce`, a real $10.00 test-mode payout (`po_1UU4ZwRwWHtrRpnvSnTTzE4m`); #164 baseline `baseline-638068d83b1f4138dc931894`, browser `browser-1473fd78…`, full staging campaign `staging-872334655caa4b455d206a0f` on endive (twelve scenarios) |

[[Journey Qualification]] maps every section 7 journey to its tests. The readiness plan's section 8 carries T46's verdict for every PRD row.


