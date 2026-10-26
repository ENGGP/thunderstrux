---
status: current
last-reviewed: 2026-10-26
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Non-Blocking Issue Register]]", "[[Project Handover 2026-10-25]]", "[[Project Handover 2026-10-15]]", "[[Project Handover 2026-10-12]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover

This is the only current handover. It covers the session that began on **2026-10-25 at main `1bc34ef`**: a whole-repository audit and the fixes for its five most important findings (#167). The previous session (planning and delivering T10 to T46, then the Stripe audit and its fixes, 2026-10-15 to 2026-10-25) is retained in [[Project Handover 2026-10-25]]. Earlier sessions are in [[Project Handover 2026-10-15]] and [[Project Handover 2026-10-12]]. Start at [[Documentation Index]]; use [[Engineering Delivery Workflow]] for delivery and [[Non-Blocking Issue Register]] for open risks.

## Current State

**Status at 2026-10-25 (main `478b4e6`).** T01–T46 are delivered and locally qualified, apart from the assistant (T35–T37), which the founder deferred; [[Pre-hosting Candidate]] holds the candidate record. This session's audit fixes (#167) are merged. Only this handover change is in review.

What remains before real users is outside the code:
- the hosting choice and the hosted gates below;
- the hosted Stripe webhook endpoints on endive with a restricted key (runbook in [[Production Operations]]). New events now refund unfillable payments automatically, so the hosted refund webhooks (PAY-002) must be live before any real sale;
- Spaces (OPS-005) and legal terms (LEGAL-001).

Repository pins: Node 22.23.4, pnpm 10.34.7, Next.js 16.4.2, Prisma client/CLI 6.19.3 and stripe 23.0.0 on API `2026-09-30.endive`. Main's migration chain has 64 migrations, ending in `20261115010000_society_payouts` (the readiness schema contract names it), and 39 models. The latest full baseline is `baseline-6c03f713d391d53964a33823` on `b77cb3e` (#167): 665 integration tests in 101 files.

**Local development** runs all 64 migrations; #167 added none. The dev app serves the working tree, so keep its checkout on main or a branch built from it. The notification key lives in ignored `.env` with a separate Windows-user-only backup. [[Troubleshooting]] and [[Production Operations]] own backup and rollback procedure. Dev database dumps and their checksums are listed in [[Project Handover 2026-10-25]].

## Active Contracts

- Canonical tenant authority is Event.organisationId for event-owned records. Live OrganisationStaff authority grants management access; OrganisationMember is join state only. Stripe remains payment truth and production fulfilment is webhook-driven.
- Verification, reset and email-change links use purpose-bound digests, explicit POST redemption and private encrypted notifications. Signup and recovery responses conceal account existence, and since DEF-035 so does sign-in timing. Old sessions cannot upgrade their authVersion through cookie refresh. [[Authentication and Dashboard Access]] and [[API Reference]] own the contracts.
- Closure is irreversible through the app and anonymises login and editable profile while retaining business, attendance, audit and buyer-capture records. It is not deletion of all personal information.
- Owner handover clears the legacy accountUserId pointer permanently; it is never transferred or restored.
- Asset rollout needs both PostgreSQL metadata and object bytes backed up. [[Society Profiles and Assets]] owns quotas, sanitisation and reference-gated delivery.
- **Purchase facts (T10):** every order records `paymentKind` (required, no default), the purchased ticket name, seller and Stripe account, currency, fee and fee policy version, and the buyer contact with provenance `purchase`. Free orders keep the compatible `paid` status, so money queries filter on `paymentKind`. Tickets carry `validity`; only active tickets admit. [[Payment Lifecycle]] owns the contract.
- **Event policy (T11a):** events have capacity, visibility, a sales close time, open/closed sales and a version. `lib/events/event-readiness.ts` is the only place that decides publication and which ticket types can be bought; create always drafts; publish and sales changes are explicit, idempotent and version-checked. [[Event Lifecycle]] owns the contract.
- **Purchases under load (DEF-032):**
  - Checkout, free registration, commerce checkout and ticket fulfilment run at READ COMMITTED (`lockedPurchaseTransactionOptions`), deciding everything after their row locks. Don't move them back to SERIALIZABLE: its snapshot predates the lock wait.
  - The stale-order job is the only place unpaid ticket orders expire.
- **Holds (DEF-033, PAY-009):** a ticket hold lasts 5 minutes past its Stripe page (`lateWebhookGraceMs`, shared with commerce's stale expiry); pages show Stripe's closing time. New events default to `automatic_full` compensation, as commerce does.
- **Payouts (PAY-005, DEF-034):** held until 2 days after the event (7 days for commerce), then at most one payout per society per UTC day.
- Public preview (T48, SEC-014): live again since 2026-10-26 on `ops-preview` (release `cf913d5`, fresh database, Stripe test mode, no image bucket yet). `https://thunderstrux.mistayu.com` runs the production build through `pnpm ops:deploy` as project `ops-preview` with ignored `.env.preview`, loopback port 3090 behind the Cloudflare Tunnel, `cf-connecting-ip` for client addresses, MFA enforced and legacy access denied. The dev stack (port 3080) is loopback-only and never tunnelled. `proxy.ts` and the app's own cookies follow the Auth.js public URL's scheme. Preview reachability does not resolve production release gates.
- Validation follows the risk table in [[Engineering Delivery Workflow]]: local evidence recorded in each PR, GitHub test checks not required (VALID-001), documentation-only changes use docs and diff checks only.
- Product decisions follow how Eventbrite, Humanitix and Luma solved the same problem, thought through critically for a student-society tool, with the reasoning recorded in the PR.

## This Session: Codebase Audit And Fixes

**Audit (2026-10-25, read only).** The whole repository was read against the docs, PRD, database spec and user-flow spec. The assumed load was a pilot with tens of societies, peaking when 20 to 200 people act within a minute on one event or society. The report found:
- two must-fix bugs: rush errors, and late payers charged without tickets;
- three should-fix items: the payout key, login timing, and three copies of the expiry rule;
- three nice-to-haves, still open: dead code in the payment path (a metadata re-check that can't fail, `getActiveReservedQuantity`, a duplicate expiry call), the unused `autoprefixer` dependency, and image requests reading the whole object before answering "not modified".

**Plan.** Agreed with the maintainer through a `grill-me` interview, then checked against Eventbrite, Humanitix and Luma at the maintainer's request:
- one PR for findings 1 to 5;
- READ COMMITTED for rush handling;
- a 5-minute webhook grace on holds, keeping 30 minutes (Stripe's minimum), with shorter holds recorded as PAY-009;
- automatic refunds by default for new events;
- at most one payout a day;
- deleting the pre-checkout and in-lock expiry.

**Delivery ledger.**

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

**Lessons.**
- Focused integration runs inside the dev app container need the baseline test container's settings, or unrelated tests fail: `RATE_LIMIT_ENABLED=false`, `MFA_ENFORCEMENT_MODE=off`, `LEGACY_ORGANISATION_ACCESS_MODE=deny`, empty `TRUSTED_APP_ORIGINS`, `AUTH_URL`/`NEXTAUTH_URL` on plain `http`, capture-only `RESEND_API_KEY`, and `DATABASE_URL` pointing at `thunderstrux_test`. The baseline remains the evidence of record.
- Tests that move the clock past a hold should derive the time from the hold, not hard-code it.

## Security Audit And Remediation (T47 to T53)

**Audit (2026-10-25).** A deep `/security-audit` run (`thunderstrux-run-1`, outside the repository) covered `7d72e33` in 72 coverage units over four hunter waves, ending with a clean final critic. Every finding was found, validated and finally verified by separate sandboxed agents with no network and dummy data. It found no cross-tenant access, authentication bypass or injection. The results are 13 confirmed findings (1 high, 5 medium, 7 low) and 11 leads, registered as SEC-003 to SEC-026 (SEC-001 and SEC-002 were already external gates, so the first two audit rows are SEC-025 and SEC-026) in [[Non-Blocking Issue Register]].

**Remediation order**, one PR each:
- T47: request bounds and the unused image optimizer (SEC-025, 013, 018);
- T48: move the live preview onto the production profile, with the seed guard, `AUTH_SECRET` rule and scheme-based secure cookies (SEC-014 to 017);
- T49: accounts and recovery (SEC-026, 007, 008, 012, 019);
- T50: checkout holds, refunds and disputes (SEC-005, 010, 011, 024);
- T51: events, staff and notices (SEC-003, 004, 006, 009);
- T52: `thunderstrux.com` readiness: alerts, public images, release binding, restore fence (SEC-020 to 023);
- T53: a hardening bundle.

The owner closed the preview at `thunderstrux.mistayu.com` on 2026-10-26, so T49 to T53 were validated locally. It reopened the same day, first briefly on the dev stack again, then on `ops-preview` (deployed from `cf913d5`; all six workers running; public CSP and HSTS match the production build; both webhook routes reach it). `thunderstrux.com` follows on the Droplet path.

| Item | PR | Status and evidence |
| --- | --- | --- |
| Retire smoke test | [#190](https://github.com/ENGGP/thunderstrux/pull/190) | DEF-041: `pnpm test:smoke` had failed at step 4 since the trusted-origin guard. Retired `scripts/smoke-test.mjs` and the `test:smoke` script instead of repairing them, because the E2E and `_test` integration suites cover all 22 steps (mapping in the register). Docs and diff checks only. |
| Organisation create id guard | [#187](https://github.com/ENGGP/thunderstrux/pull/187) | DEF-040: Organisation's logo and cover relations include its own id, so an organisation create naming no relation column fails with P2011. Fixed the one affected caller (`scripts/smoke-test.mjs`), documented the rule in the schema, and added `organisation-creation.test.ts`. DEF-041 records that the smoke test has failed at step 4 since the trusted-origin guard. No app or schema behaviour change. |
| T53 hardening bundle | [#181](https://github.com/ENGGP/thunderstrux/pull/181) | Full 16-byte AES-GCM tags; CSRF binds the first of duplicate session cookies, as Auth.js does; staff order and asset locks carry the tenant; a lost dispute holds payouts until its reversal settles; hosted config pins MFA enforce and legacy deny; IPv6 rate-limit keys use the /64; closure waits for pending membership and merchandise orders; check-in search keeps its filter on later pages; restore keeps database URLs out of process arguments and the Droplet keeps seven dumps; `.gitignore` covers keys and dumps; opening the Stripe dashboard needs a fresh code. No migration. Baseline baseline-30d63d719b0a2423b5c3964a on d857c90: production build, 44/44 guards, typecheck, 703/703 integration tests in 103 files, no known vulnerabilities; full E2E browser-4d0cd8d9cbd870dff4efe62a passed (9 + 69 + 10) and operations rehearsal ops-986729960d passed on 1c08e03 (later commits change only the settings dialog's empty-code request and one test); runner tests 43/43; the dashboard code dialog checked at desktop, tablet and phone. |
| T52 thunderstrux.com readiness | [#180](https://github.com/ENGGP/thunderstrux/pull/180) | Unsigned-webhook alerts cooled to one per five minutes (SEC-020); public images answer 304 and HEAD from the row with one shared S3 client (SEC-021); only `main` publishes and attests, and the deploy accepts only the two release repositories (SEC-022); a restore fences identity and the runbook rotates `AUTH_SECRET` (SEC-023). [[Pre-hosting Candidate]] gains the `thunderstrux.com` go-live checklist. No migration. Baseline baseline-78f56b6587d0255c2a025528 on ca54f4b: production build, 44/44 guards, typecheck, 695/695 integration tests in 103 files, no known vulnerabilities; operations rehearsal ops-e2919055e2 passed with the identity fence checked; runner tests 43/43. The release workflow change takes effect on the next `main` run. |
| T51 events, staff and notices | [#179](https://github.com/ENGGP/thunderstrux/pull/179) | Notice and ticket subjects fold line breaks (SEC-003); an edit can't move a sold event's end into the past (SEC-004); revoking staff revokes their pending invitations (SEC-006); unpublish rechecks orders under the event lock (SEC-009). No migration. Baseline baseline-99376805e00335929ff28289 on 402f543: production build, 42/42 guards, typecheck, 694/694 integration tests in 103 files, no known vulnerabilities. No UI change; E2E not required for this risk. |
| T50 checkout holds, refunds and disputes | [#178](https://github.com/ENGGP/thunderstrux/pull/178) | One buyer's unpaid ticket holds per event stay within 10 and one unpaid merchandise basket per society, else 409 `purchase_in_progress` with its own checkout message (SEC-005, SEC-010); `checkout_create` is keyed on the buyer, not the address. A refund that may already exist stays `uncertain` on a failed lookup (SEC-011). With several disputes on a charge the order shows the worst, and a restore needs them all won (SEC-024); `prevented` counts as won. No migration. Baseline baseline-16713fefbf7ba93fd121e49b on 1ecacee: production build, 42/42 guards, typecheck, 690/690 integration tests in 103 files, no known vulnerabilities; full E2E browser-6bb5dcabd10d10b52f2400b4 passed (9 + 69 + 10). The new checkout message reuses the existing refusal screen; it was not checked in a browser. |
| T49 accounts and recovery | [#177](https://github.com/ENGGP/thunderstrux/pull/177) | Signup, verification and reset each have their own per-address bucket (SEC-026); verification needs the account's password and a completed reset verifies the address (SEC-008); duplicate sign-in `email` fields are refused (SEC-007); normalised `//host` return paths are refused (SEC-012); an unknown reset token costs no hash (SEC-019 source part). `/verify-email` gains a password field. Audit rows SEC-001/SEC-002 renamed SEC-025/SEC-026, as those IDs were already external gates. A wrong verification password says to check the password. No migration. Baseline baseline-14ab92a45a467642772013df on 669a71c: production build, 42/42 guards, typecheck, 685/685 integration tests in 103 files, no known vulnerabilities; full E2E browser-45fbe13b1c90a36cded8c4b8 passed (9 + 69 + 10); account-verification.test.ts 13/13 again on 7f48817 after the message change; `/verify-email` checked at desktop, tablet and phone. |
| T48 production-profile preview | [#176](https://github.com/ENGGP/thunderstrux/pull/176) | `allowedDevOrigins` lists no public host and Next's dev MCP endpoint is off; `AUTH_SECRET` falls back only in tests and builds (production needs 32 characters); guest and context cookies follow the public URL's scheme; the seed refuses a public origin without `SEED_DEMO_PASSWORD`. The preview moves to `ops-preview` (README, Public Preview). No migration. Baseline baseline-33b8bc3817d47b15a6a79d6a on 908244e: production build, 42/42 guards, typecheck, 680/680 integration tests in 103 files, no known vulnerabilities; operations rehearsal ops-ad72c25e25 passed. |
| T47 request bounds | [#175](https://github.com/ENGGP/thunderstrux/pull/175) | Ticket types capped at 50, JSON bodies at 100 KB through one `readJsonBody`, validation answers at 20 issues, and `/_next/image` off. No migration. Baseline `baseline-d43e7a4d2bab3a203b1d1261` on `2637fe2`: production build, 42/42 guards, typecheck, 674/674 integration tests in 102 files, no known vulnerabilities. |

## Next Safe Actions

First, ahead of the list below:
- **Preview (owner).** Runs on `ops-preview` (README, Public Preview). Send a test event from each Stripe test-mode webhook destination and confirm a 200; add an `ASSET_STORAGE_*` bucket for image uploads. Never point the tunnel at the dev stack again. The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts.
- The 2026-10-25 security remediation (T47 to T53) is complete apart from owner gates. Before `thunderstrux.com` serves anyone, work through the go-live checklist in [[Pre-hosting Candidate]].

1. Before hosting: create both Stripe webhook endpoints on `2026-09-30.endive` with the restricted key and the event lists in [[Production Operations]], and pass PAY-002 on the hosted endpoint. Automatic refunds are now the default for new events, as for commerce.
2. When hosting is chosen, run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`, and add an uptime or heartbeat check that covers the monitor (OPS-002).
3. UI-004: phone filter folding, one date formatter and the society Overview previews.
4. Optional cleanup from the audit: the three nice-to-haves above, in one small PR.
5. PAY-009, when it is scheduled: shorter or society-set holds, by closing the Stripe page early from the stale-order job. Design it as its own task.
6. Before activating account lifecycle, obtain independent security and migration review, provision and separately back up the notification key, and verify reliable Redis and real email acceptance. #167 changed payments and sign-in, which this review also covers.

## Production Release Gates

Unrestricted payments and broad staff rollout remain blocked pending:

- staff MFA enrollment/enforcement and migration away from legacy shared logins with LEGACY_ORGANISATION_ACCESS_MODE=deny;
- trusted-origin/proxy configuration and reliable Redis;
- scheduling/monitoring of email, notification, stale-order and compensation workers, notification key recovery and real provider/inbox evidence;
- refund webhooks, real Stripe automatic/manual refund acceptance and external alert delivery;
- encrypted off-machine backups, external health monitoring, a hosted restore drill, and representative query/index review;
- survey/closure or explicit acceptance of remaining audit coverage and API error normalization.

[[Production Operations]] provides current procedures; [[Production Readiness Verification 2026-09-22]] preserves earlier evidence. The issue register is authoritative for open release risks.

## Resource And Recovery Rules

- Use only run-owned disposable test databases with simple names ending in `_test`. Never reset development or real-user data.
- Preserve retained backups (including `tmp/thunderstrux-before-p319-20260921.dump` and the dev dumps listed in [[Project Handover 2026-10-25]]), failed-run recovery manifests, and unrelated caches and resources until their retention or recovery decision is explicit.
- Take a verified dump before the development app applies a new migration: any dev app restart applies pending migrations.
- Local Obsidian workspace state is ignored and must not be committed.
- Closure anonymisation is not reversed by code rollback. Pause account mutations and buyer contact/ticket delivery before rolling back to incompatible older code.
