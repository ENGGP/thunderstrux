---
status: current
last-reviewed: 2026-10-28
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Issue and Defect Register]]", "[[Pre-hosting Candidate]]", "[[Evidence Ledger]]", "[[Project Handover 2026-10-25]]"]
sources: [package.json, prisma/schema.prisma, config/schema-contract.json]
---

# Project Handover

**Owns:** where the project stands now: what is delivered, what is in flight, what blocks real users, and the next safe actions.
**Read when:** at the start of every session, after [[Documentation Index]].
**Not here:** how anything works (the living notes, routed from [[Documentation Index]]); open risks ([[Issue and Defect Register]]); run IDs and test counts ([[Evidence Ledger]] and each PR); earlier sessions ([[Project Handover 2026-10-25]], [[Project Handover 2026-10-15]], [[Project Handover 2026-10-12]]).

## Current state

**2026-10-26, main `183b2e2`.** This session began on 2026-10-25 at `1bc34ef`.
- T01 to T46 are delivered and locally qualified, apart from the assistant (T35 to T37), which the founder deferred. [[Pre-hosting Candidate]] is the candidate record.
- This session delivered the codebase audit fixes, the UI audit and design sync, the security audit remediation (T47 to T53) and the test audit. The documentation audit (#195) rewrote the notes and registered 17 items; #196 fixes 16 of them (DEBT-001, a cleanup, is left).
- A security and buyer-journey audit (2026-10-26, compared with Luma, Humanitix and Eventbrite) found 20 items; #197 fixes 18 of them (PAY-016, PAY-018 to PAY-021, SEC-029 to SEC-031, DEF-053 to DEF-062, UI-006) and registers event cancellation (EVT-004), buyer self-cancel of free registrations (EVT-005) and smaller leftovers (DEBT-002). It adds migration `20261116010000_guest_checkout_name`.
- #198 (2026-10-27, built on #197's branch) resolves EVT-004 and EVT-005: "Cancel event" refunds every paid order through the refunds worker with one authenticator code, cancels free registrations and emails every holder; buyers can release their own free registration before the event, and the places go back on sale. It adds migration `20261117010000_event_cancellation` (additive: `Event.cancelledAt`, `cancellationReason`, lifecycle source `buyer_action`).
- A read-only Stripe audit (2026-10-27, against Stripe's best-practice and Connect guidance) found four Medium gaps and one Low bug. #204 resolves them:
  - payouts follow the payouts flag, not the state;
  - a dispute gets a draft answer staged in Stripe, a reminder and an operator runbook;
  - a society's Stripe managers are emailed when Stripe pauses card payments or sets a deadline;
  - cancelling a long-lead event names refunds of money already released for payout (PAY-022, accepted risk);
  - a network error no longer reads as "platform not ready".

  It registers the Low leftovers as PAY-023. No migration.
- #205 fixes PAY-023's code items: readiness needs the `transfers` capability, paid prices start at $2.00, payouts wait for $20 (or a week) under a per-attempt key, and an actionable early fraud warning on an unused order is refunded automatically. PAY-023 keeps the webhook IP allowlist and Accounts v2. No migration.
- 2026-10-28: the Impeccable design skill was added with `PRODUCT.md` (a PRD summary) and a code-generated `DESIGN.md`; comparing it with the visual spec registered UI-007 (no price on event cards) and UI-008 (home and event-page layout). The built values kept on purpose are in visual spec 16.8, and the unused lime token is gone. #209 then closed UI-007, UI-008 and UI-004's society Overview previews: event cards show the price or selling state, the home hero leads with events, and Overview previews memberships and merchandise. See [[UI Architecture Rules#Impeccable]].
- 2026-10-28: an Impeccable critique of all 64 pages (24/40) found wrong statements at money moments. #216 fixes them (UI-011 to UI-017, no migration):
  - order status ranks a refund above a won dispute and shows staff marks;
  - the refund dialog says places go back on sale;
  - Payments says when it can't read Stripe;
  - guest links, `/cancel`, `/confirmed` and check-in tell the truth;
  - copy follows UX spec 5.4.

  UI-018 lists the critique's feature follow-ups.
- 2026-10-28: #217 fixes the critique's layout-shift findings (UI-020 to UI-024): results ease in under their action, buttons keep their size while busy, loading stand-ins match their content, phones get a pay bar on every checkout and the door starts with search. UI Architecture Rules split off [[UI Page Patterns]].
- 2026-10-29: #218 finishes the critique's fixes with its list work (UI-019): every paged list goes both ways through one `Pager`, Purchases hides checkouts that didn't complete behind a link, and long lists show a few with "See all" or say where they stop. UI-025 keeps the remaining caps.
- 2026-10-28: owner testing on the preview (society onboarding, four $1,200 tickets, a refund here, two Dashboard refunds, a lost dispute) behaved as designed except two defects, fixed in #215: refunded tickets never went back on sale (PAY-043, now they do, except for a cancelled event) and a lost dispute's buyer page said the tickets were under review (UI-010). The preview runs with `MFA_ENFORCEMENT_MODE=off` in `.env.preview` at the owner's request, temporarily; set it back to `enforce` and redeploy before anyone else uses it.
- 2026-10-28: the preview runs `0a9728e` (#213; 69 migrations, its payments endpoint has the async events); before that it was deployed at `5dee7f4` (backup first; 68 migrations) and the recent fixes were checked live on dev: a refund the bank returned, a Dashboard refund not reversed and then reversed by hand, a payout made outside the worker, a payout-account change. #213 then fixes the audit's Low findings and two found in that testing (PAY-029 to PAY-042, SEC-034 to SEC-037, UI-009, DEF-063). Migration `20261120010000_stripe_account_unique`; dev was dumped first to `tmp/dev-before-sec-035-20261028.dump` (SHA-256 `a34765c622fd76c242776a2114d08e1574b007862da4a340631c9e5d6e160586`, 40 tables, owner-only, 68 migrations; 26 users, 48 orders, 44 tickets, 22 events, 2 commerce orders), then dev applied it (69). Payouts moved to [[Stripe Payments and Connect Payouts]].
- 2026-10-28: #212 fixes the six Medium findings of the Stripe audit of dev and preview (SEC-032, PAY-025 to PAY-028, SEC-033): payouts hold until the latest end an event ever had and until Stripe shows a refund taken back from the society; refunds that fail or come back from the bank, and payouts or bank-account changes Thunderstrux didn't make, reach a person; buyers and Stripe managers are emailed. Migration `20261119010000_payout_hold_and_refund_recovery`; the dev database was dumped first to `tmp/dev-before-sec-032-20261028.dump` (SHA-256 `34c45e9fde12161f65888499ee0c4c6b87afc0b11def2231e5df177a1f6be56c`, 40 tables, owner-only, 67 migrations; 26 users, 46 orders, 42 tickets, 22 events, 2 commerce orders), then dev applied it (68). Alerts moved to [[Production Operations Alerts]].
- 2026-10-28: #211 (PAY-024) adds the checkout reconciliation sweep: the stale-order worker asks Stripe about pending checkouts, confirms any paid one whose webhook was lost (alert `stripe_webhook_missed`), and never expires an order without asking. It needs the Stripe and notification secrets now (hosted compose and contract updated), dev runs it, and the dev-only `/success` fallback is gone. Adds migration `20261118010000_checkout_reconciliation_sweep` (additive). The dev database was dumped to `tmp/dev-before-pay-024-20261028.dump` (SHA-256 `f026f5b309ac1bcb87c68ee8936e1a06127ec8a8952ab683d357a4dd27d6af9d`, 40 tables, owner-only ACLs, 66 migrations; 26 users, 43 orders, 40 tickets, 22 events), then the dev app applied the migration (67).

**Snapshot at `912e49b`.** Re-derive these from `package.json`, `prisma/migrations/` and `config/schema-contract.json` before relying on them.
- Pins: Node 22.23.4, pnpm 10.34.7, Next.js 16.4.2, Prisma 6.19.3, stripe 23.0.1 on API `2026-09-30.endive`.
- Migrations: 64, ending in `20261115010000_society_payouts`. Models: 39.
- Latest full baseline: `baseline-b804a38b50797943158c3f63`, 748 integration tests in 105 files.

**Local development**
- The dev app runs all migrations. It serves this folder's working tree, so keep the folder on main or a branch built from it.
- The notification key lives in the ignored `.env`, with a separate Windows-user-only backup.
- Dev database dumps and their checksums are listed in [[Project Handover 2026-10-25]]. On 2026-10-27 the dev database was dumped to `tmp/dev-before-evt-004-20261027.dump` (SHA-256 `ac783a262e99a7e5702d6762c0c86458346449d825ab1fb9c1d79477d047952f`, 40 tables, owner-only ACLs, 64 migrations), then the dev app applied `20261116010000_guest_checkout_name` and `20261117010000_event_cancellation` (66 migrations, counts unchanged: 26 users, 40 orders, 35 tickets, 20 events). The dev folder now serves `codex/cancel-event`.

**Public preview**
- `https://thunderstrux.mistayu.com` runs the production build through `pnpm ops:deploy` as project `ops-preview`: release `cf913d5`, a fresh database, Stripe test mode, and no image bucket yet.
- It listens on loopback port 3090 behind the Cloudflare Tunnel, uses `cf-connecting-ip` for client addresses, enforces MFA and denies legacy access.
- The dev stack (port 3080) is loopback-only and is never tunnelled.
- Preview reachability satisfies no release gate. See [[Production Operations]].

## What blocks real users

None of it is code. [[Pre-hosting Candidate]] owns the gates and the `thunderstrux.com` go-live checklist; [[Issue and Defect Register]] tracks each one.
- The hosting choice, and the hosted gates OPS-001 to OPS-004, SEC-001 and SEC-002.
- Hosted Stripe webhook endpoints on endive with a restricted key. The refund webhooks (PAY-002) must be live before any real sale, because new events refund unfillable payments automatically.
- Object storage (OPS-005) and legal terms (LEGAL-001).

## Active contracts

Pointers only; each linked note owns its rule.
- **Tenant:** `Event.organisationId` is the canonical owner of event-owned records. Live `OrganisationStaff` authority grants management; `OrganisationMember` is join state only. [[Database and Multi Tenancy#Tenant boundary]]
- **Payment truth:** Stripe is payment truth, and fulfilment is webhook-driven and idempotent. An order is never marked paid from a success page. [[Payment Lifecycle]]
- **Purchases under load (DEF-032):** checkout, free registration, commerce checkout and fulfilment run at READ COMMITTED (`lockedPurchaseTransactionOptions`) and decide everything after their row locks. Don't move them back to SERIALIZABLE: its snapshot predates the lock wait, so queued buyers fail.
- **Holds (DEF-033, PAY-009):** a ticket hold outlives its Stripe page by 5 minutes (`lateWebhookGraceMs`), and pages show Stripe's closing time. New events default to `automatic_full` compensation. [[Payment Lifecycle#Holds]]
- **Payouts (PAY-005, DEF-034, PAY-022):** ticket money is held until 2 days after the event and membership and merchandise money for 7 days after payment (never past 80 days), then paid at most once per society per UTC day to any society whose payouts are enabled. [[Stripe Payments and Connect]]
- **Disputes:** the platform operator answers every dispute in Stripe from the staged draft before its due date. [[Production Operations]]
- **Accounts:**
  - Verification, reset and email-change links use purpose-bound digests and explicit POST redemption.
  - Signup, recovery and sign-in timing conceal which addresses have accounts.
  - Old sessions can't raise their `authVersion`.
  - Closure anonymises login and profile but keeps business, attendance, audit and buyer records; it is not full deletion.
  - Owner handover clears the legacy `accountUserId` pointer for good.
  - [[Authentication and Dashboard Access]]
- **Assets:** a rollout needs both PostgreSQL rows and object bytes backed up. [[Society Profiles and Assets]]
- **Delivery:** follow [[Engineering Delivery Workflow]]. Each PR records local evidence; GitHub test checks are optional (VALID-001); docs-only changes run only the docs and diff checks.
- **Product decisions:** follow how Eventbrite, Humanitix and Luma solved the same problem, thought through for a student-society tool, with the reasoning recorded in the PR.

## This session's PRs

Evidence (run IDs, counts, Stripe objects) is in [[Evidence Ledger]] and each PR. None added a migration.

| PR | Change |
| --- | --- |
| #167 | Audit fixes: checkout rush, late payers, payouts, sign-in timing (DEF-032 to DEF-035) |
| #168, #172, #182, #194 | Handover updates |
| #169 | UI audit P1 fixes (DEF-036 to DEF-038, UI-003) |
| #170 | UI consistency pass (UI-005) |
| #171, #173 | Design tokens and design-system re-sync (`.design-sync/`) |
| #174 | Renovate: Docker digest PRs skip the release-age wait |
| #175 | T47 request bounds and no image optimizer (SEC-025, SEC-013, SEC-018) |
| #176 | T48 preview on the production build (SEC-014 to SEC-017) |
| #177 | T49 accounts and recovery (SEC-026, SEC-007, SEC-008, SEC-012, SEC-019 source part) |
| #178 | T50 checkout holds, refunds and disputes (SEC-005, SEC-010, SEC-011, SEC-024) |
| #179 | T51 events, staff and notices (SEC-003, SEC-004, SEC-006, SEC-009) |
| #180 | T52 `thunderstrux.com` readiness (SEC-020 to SEC-023) |
| #181 | T53 hardening bundle (DEF-039 and the audit's hardening notes) |
| #187 | Organisation create id guard (DEF-040) |
| #190 | Smoke test retired (DEF-041) |
| #191 | Test audit tier 1 (DEF-042, DEF-043) |
| #192 | Test audit tiers 2 and 3; standalone ticket-type route removed (DEF-044, DEF-045) |
| #193 | Test audit findings (DEF-046, PAY-010, SEC-027) |
| #50, #183 to #186, #188, #189 | Renovate updates: container digests, postcss, golang, stripe 23.0.1, caddy, axe-core 4.14. axe-core 4.14 failed the browser campaign until #193 (DEF-046). |
| #195 | Documentation audit: vault root at `docs/`, notes rewritten for agent readers, stricter `pnpm docs:check`, resolved defects moved to History, 17 new register items |
| #197 | Security and journey audit fixes: payout hold (manual mark, end-time edit, disconnect), refunds or disputes before fulfilment, free-ticket cap, merchandise hold grace, capacity under review, refunds after a won dispute, fresh codes for Stripe onboarding and a password for authenticator setup; checkout dead end, guest names and door references, guest link at the door, sign-in after verification, society-zone order times, link previews, map and calendar links, event form safety (PAY-016, PAY-018 to PAY-021, SEC-029 to SEC-031, DEF-053 to DEF-062, UI-006). Adds migration `20261116010000_guest_checkout_name` |
| #198 | Cancel event and buyer release of free registrations (EVT-004, EVT-005). Adds migration `20261117010000_event_cancellation` |
| #199 | Cancelling an event closes unpaid orders' Stripe pages, and their order pages stop offering payment (EVT-006) |
| #204 | Stripe audit fixes: payouts gate, dispute draft answers and reminder, paused-sales and deadline emails, early-released money on cancellation, connect error (PAY-022, PAY-023) |
| #205 | Stripe audit leftovers: readiness needs `transfers`, $2 paid minimum, $20 payout minimum with a per-attempt key, early fraud warnings refunded automatically (PAY-023 code items) |
| #196 | Documentation-audit fixes: deploy stops and restarts workers (OPS-007), ticket email zone and wording, order date filters in the society's zone, refund, payout, analytics, dispute-reversal and disconnect fixes, bounded request bodies, config faults (DEF-047 to DEF-052, PAY-011 to PAY-015, SEC-028, API-002, AUD-002, OPS-006) |

## Next safe actions

1. **Preview (owner).**
   - Send a test event from each Stripe test-mode webhook destination and confirm a 200.
   - Add an `ASSET_STORAGE_*` bucket for image uploads.
   - Never point the tunnel at the dev stack again.
   - The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts.
2. **Dev database:** it already has #197's and #198's migrations (dump above). Keep the dev folder on `codex/cancel-event` or a branch with both until they merge; older code can't read events with `cancelledAt` missing from its client.
3. **DEBT-001 and DEBT-002 cleanup:** the dead and redundant code the documentation audit listed, and the smaller items of the journey audit. Small; no risky behaviour change.
4. **Before `thunderstrux.com` serves anyone,** work through the go-live checklist in [[Pre-hosting Candidate]].
   - Create both Stripe webhook endpoints on `2026-09-30.endive` with the restricted key and the event lists in [[Production Operations]]. The key needs Disputes **write**, so each dispute gets its staged draft answer, and Radar early fraud warnings **read**; the payments endpoint also subscribes to `radar.early_fraud_warning.created` and the Connect endpoint to `payout.created`.
   - Pass PAY-002 on the hosted endpoint.
5. **When hosting is chosen,** give `stale-order-worker` the `stripe_secret_key` and `notification_encryption_key` secrets and `NEXT_PUBLIC_APP_URL` (PAY-024; `pnpm docker:hosted:check` refuses it without them), and run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`. Add an uptime or heartbeat check that covers the monitor (OPS-002).
6. **Stripe settings (owner, each sandbox and later live):** in Connect's Express settings, stop accounts editing their payout schedule and using Instant Payouts (PAY-028); add `account.external_account.created` and `account.external_account.updated` to each Connect webhook endpoint (SEC-033; done on the preview), and `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` to each payments endpoint (PAY-030; done on the preview).
7. **UI-004:** fold the phone filters and use one date formatter.
8. **PAY-009, when scheduled:** shorter or society-set holds, made by closing the Stripe page early from the stale-order job. It is its own task.
9. **Before activating account lifecycle:**
   - get an independent security and migration review, which also covers #167's payment and sign-in changes and #197's payout-hold, refund and staff-security changes, and #198's bulk refunds on event cancellation;
   - provision the notification key and back it up separately;
   - verify reliable Redis and real email acceptance.

## Resource and recovery rules

- Use only run-owned disposable test databases with simple names ending in `_test`. Never reset development or real-user data.
- Preserve these until a retention or recovery decision is explicit:
  - retained backups, including `tmp/thunderstrux-before-p319-20260921.dump` and the dev dumps listed in [[Project Handover 2026-10-25]];
  - failed-run recovery manifests;
  - unrelated caches and resources.
- Take a verified dump before the dev app applies a new migration: any dev app restart applies pending migrations.
- Local Obsidian workspace state (`docs/.obsidian/workspace.json`) is ignored and must not be committed.
- Closure anonymisation is not reversed by a code rollback. Pause account mutations and buyer contact and ticket delivery before rolling back to incompatible older code.
