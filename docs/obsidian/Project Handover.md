---
status: current
last-reviewed: 2026-10-30
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

**2026-10-29, main `0288810`.** This session began on 2026-10-25 at `1bc34ef`. Dated entries below run oldest first.
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
- 2026-10-28: #211 (PAY-024) adds the checkout reconciliation sweep: the stale-order worker asks Stripe about pending checkouts, confirms any paid one whose webhook was lost (alert `stripe_webhook_missed`), and never expires an order without asking. It needs the Stripe and notification secrets now (hosted compose and contract updated), dev runs it, and the dev-only `/success` fallback is gone. Adds migration `20261118010000_checkout_reconciliation_sweep` (additive). The dev database was dumped to `tmp/dev-before-pay-024-20261028.dump` (SHA-256 `f026f5b309ac1bcb87c68ee8936e1a06127ec8a8952ab683d357a4dd27d6af9d`, 40 tables, owner-only ACLs, 66 migrations; 26 users, 43 orders, 40 tickets, 22 events), then the dev app applied the migration (67).
- 2026-10-28: #212 fixes the six Medium findings of the Stripe audit of dev and preview (SEC-032, PAY-025 to PAY-028, SEC-033): payouts hold until the latest end an event ever had and until Stripe shows a refund taken back from the society; refunds that fail or come back from the bank, and payouts or bank-account changes Thunderstrux didn't make, reach a person; buyers and Stripe managers are emailed. Migration `20261119010000_payout_hold_and_refund_recovery`; the dev database was dumped first to `tmp/dev-before-sec-032-20261028.dump` (SHA-256 `34c45e9fde12161f65888499ee0c4c6b87afc0b11def2231e5df177a1f6be56c`, 40 tables, owner-only, 67 migrations; 26 users, 46 orders, 42 tickets, 22 events, 2 commerce orders), then dev applied it (68). Alerts moved to [[Production Operations Alerts]].
- 2026-10-28: the preview was deployed at `0a9728e` (#213; 69 migrations, its payments endpoint has the async events); before that it was deployed at `5dee7f4` (backup first; 68 migrations) and the recent fixes were checked live on dev: a refund the bank returned, a Dashboard refund not reversed and then reversed by hand, a payout made outside the worker, a payout-account change. #213 then fixes the audit's Low findings and two found in that testing (PAY-029 to PAY-042, SEC-034 to SEC-037, UI-009, DEF-063). Migration `20261120010000_stripe_account_unique`; dev was dumped first to `tmp/dev-before-sec-035-20261028.dump` (SHA-256 `a34765c622fd76c242776a2114d08e1574b007862da4a340631c9e5d6e160586`, 40 tables, owner-only, 68 migrations; 26 users, 48 orders, 44 tickets, 22 events, 2 commerce orders), then dev applied it (69). Payouts moved to [[Stripe Payments and Connect Payouts]].
- 2026-10-28: owner testing on the preview (society onboarding, four $1,200 tickets, a refund here, two Dashboard refunds, a lost dispute) behaved as designed except two defects, fixed in #215: refunded tickets never went back on sale (PAY-043, now they do, except for a cancelled event) and a lost dispute's buyer page said the tickets were under review (UI-010). The preview runs with `MFA_ENFORCEMENT_MODE=off` in `.env.preview` at the owner's request, temporarily; set it back to `enforce` and redeploy before anyone else uses it.
- 2026-10-28: an Impeccable critique of all 64 pages (24/40) found wrong statements at money moments. #216 fixes them (UI-011 to UI-017, no migration):
  - order status ranks a refund above a won dispute and shows staff marks;
  - the refund dialog says places go back on sale;
  - Payments says when it can't read Stripe;
  - guest links, `/cancel`, `/confirmed` and check-in tell the truth;
  - copy follows UX spec 5.4.

  UI-018 listed the critique's feature follow-ups; they shipped as #220, #221 and #222 and are resolved.
- 2026-10-28: #217 fixes the critique's layout-shift findings (UI-020 to UI-024): results ease in under their action, buttons keep their size while busy, loading stand-ins match their content, phones get a pay bar on every checkout and the door starts with search. UI Architecture Rules split off [[UI Page Patterns]].
- 2026-10-29: #218 finishes the critique's fixes with its list work (UI-019): every paged list goes both ways through one `Pager`, Purchases hides checkouts that didn't complete behind a link, and long lists show a few with "See all" or say where they stop. UI-025 keeps the remaining caps.
- 2026-10-29: #219 adds `pnpm seed:demo` (`prisma/demo-data.mjs`), which loads rich demo data on top of the seed: eight `demo-` societies in every Stripe, profile and staff condition, 60 members, 10 guests, about 660 ticket orders and 190 membership and merchandise orders in every state ([[Seeding and Data#Rich demo data]]). It refuses anything but the local dev database and rebuilds only its own rows. The dev database has it loaded; its accounts also use `password123`.
- 2026-10-29: #220 adds a QR code to staff MFA set-up (`uqr`, no dependencies) and lets staff copy, download and replace their recovery codes from Account settings (password and a fresh authenticator code; audited, no email).
- 2026-10-29: #221 adds staff batch tools: Mark several pickups ready, send several failed emails again with one reason, Download CSV on every Orders tab and the attendee list (owners and admins; rate-limited and audited), and a required reason on Mark as refunded.
- 2026-10-29: #222 adds an optional image description to events (`Event.heroAlt`, additive migration `20261121010000_event_hero_alt`), read out as the event page hero's alt text, and resolves UI-018. Apply it with `prisma migrate deploy` on each database; the dev database has it.
- 2026-10-29: #224 resolves UI-004 and UI-025 and four DEBT-002 items: phone filters fold, one date formatter, every capped list pages both ways, Change tickets keeps the choice, one set of ticket steps, sold counts valid tickets, and "Contact {society}" emails the society (a new public route, `society_enquiry` limit and template; no migration). Checkout holds (PAY-009) and per-ticket refunds follow as their own PRs.
- 2026-10-30: #225 resolves PAY-009: per-event checkout holds (`Event.checkoutHoldMinutes`, additive migration `20261122010000_event_checkout_hold`; apply it with `prisma migrate deploy` on each database), closed by the stale-order job when they end, with the end on Stripe's page and a countdown on order pages.
- 2026-10-30: #226 adds per-ticket refunds, as Humanitix: pick tickets, refund all or part of their price or $0 to cancel them, keep them valid or not, email the buyer or not (additive migration `20261123010000_refund_tickets`, which also adds the `tickets_cancelled` lifecycle step; apply it with `prisma migrate deploy` on each database). Reviewing a refund made in Stripe picks the tickets it covered.
- 2026-10-30: the preview was deployed at `d133734` (#226; backup `ops-preview-2026-10-30T03-27-51-803Z.dump` first; 72 migrations, adding those of #222, #225 and #226); readiness answers 200 locally and on `thunderstrux.mistayu.com`, and the six workers run the release's ops image. `MFA_ENFORCEMENT_MODE` is still `off`.
- 2026-10-30: #228 moves societies' Stripe accounts to Accounts v2 (PAY-023): created and read through v2, readiness capability by capability, manual payouts through Balance Settings, account changes as v2 thin events at `/api/stripe/accounts/webhook` (`STRIPE_ACCOUNTS_WEBHOOK_SECRET`). Existing accounts keep working unchanged. No migration. Before deploying it anywhere, the owner creates that event destination (step 5).
- 2026-10-30: #229 closes DEBT-001 and DEBT-002: dead code removed (including `autoprefixer` and the `tsconfig.json` rewrite), check-in scoped to the event (`?eventId=`), a per-account sign-in limit, safer staff-invite wording, compensation checked against the seller snapshot, and members-only access checked again at fulfilment. No migration.
- 2026-10-30: #230 adds QR tickets and door scanning, after a comparison with Humanitix, Eventbrite and Luma, which all scan at the door. Each active ticket shows a QR code of its id on the ticket face and in the ticket email (an inline PNG: Gmail and Outlook for Windows drop `data:` images). The check-in console gains Scan QR codes (`BarcodeDetector`, else `@zxing/library`'s QR reader for iOS), which checks a ticket in as it reads it; `Permissions-Policy` now allows the camera for the site. The check-in list shows buyer emails only to roles with `orders:read` (SEC-038), and `check_in_staff` needs no staff authenticator under `enforce` (accepted risk SEC-039; [[Authentication and Dashboard Access#Staff MFA]]). No migration.
- 2026-10-30: #231 adds ticket codes, as Eventbrite, Humanitix and Luma offer: discount codes (percent or dollars), access codes that unlock a hidden ticket type, and comps (100% off, through the free path), per event, with a ticket limit, a last day and on/off, managed on the Edit tab and shown in the Summary, the order page and the orders CSV ([[Event Lifecycle#Codes]]; the decision and its reasoning are in the PR). Registers EVT-007 (a code's limit isn't rechecked at fulfilment). Additive migration `20261124010000_ticket_codes`; take a verified dump first, then apply it with `prisma migrate deploy` on each database.
- 2026-10-30: #232 ends the flaky scan tests and strengthens the door's fallback reader (DEF-064). ZXing can pick a shape in a code's data as a corner, so the integration test reads its clean render with `PURE_BARCODE`, the e2e spec uses fixed ids, and the console retries each frame at half size. No phone has tried the fallback yet, so DEF-064 stays open for that check. No migration.
- 2026-10-30: dev moved to main at `a1852db`. The dev database was dumped first to `tmp/dev-before-evt-007-20261030.dump` (SHA-256 `d3e0af013e3f1f0ded0caab4a4450a9105e8805fb1b694b37c8f65518714f637`, 40 tables, owner-only, 72 migrations; 94 users, 711 orders, 998 tickets, 76 events, 193 commerce orders; a disposable restore matched every table's row count). `pnpm docker:restart` then installed #230's `@zxing/library` and applied `20261124010000_ticket_codes` (73), with every existing table's rows unchanged.
- 2026-10-30: #234 starts the fixes from the 2026-10-30 audit, the first of seven PRs (the rest are in Next safe actions). No migration.
  - The stale-order and refunds jobs get `EMAIL_FROM`, the notification key and the app URL from one shared settings block in each compose file, and the config check refuses them without these (DEF-065). The preview needs a deploy for this to take effect.
  - Sign-in takes only a plain form with an address (SEC-040).
  - Per-address limits rose for campus Wi-Fi (DEF-066).
  - The three webhooks refuse bodies over 1 MB (SEC-041).
  - `.claude/worktrees` is out of the Docker build context and the type check.
  - A failed sign-in took the same time for a real and an unknown address on dev (7 to 17 ms apart, inside the spread between runs), so that audit item needed no fix.
- 2026-10-30: #235 lets two full test runs go at once. Each run tags its images with its run id, so it can't test another run's code, and Docker picks its host port. Staging stays one at a time, with its own check, because the old port check was what kept those runs apart. No app code changes.
- 2026-10-31: #237 fixes the audit's email and job findings (16, 17; DEF-067 to DEF-070, SEC-043). Both email jobs send for up to 45 seconds a run, sign-in and guest links go first, and a 429 uses no attempt and ends the run. Finished notifications are deleted after 30 days, except a Stripe deadline notice, which stays until 30 days after its deadline. A failed step in the notification job alerts `notification_step_failed`, and a timed-out run keeps its lease until it lapses. The tests prove the queues drain, not how fast real email goes. No migration.

**Snapshot at `0288810`.** Re-derive these from `package.json`, `prisma/migrations/` and `config/schema-contract.json` before relying on them.
- Pins: Node 22.23.4, pnpm 10.34.7, Next.js 16.4.2, Prisma 6.19.3, stripe 23.0.1 on API `2026-09-30.endive`.
- Migrations: 70, ending in `20261121010000_event_hero_alt`. Models: 39.
- Latest full baseline: `baseline-1d8a4c4a5620cbd7524f141c` (#222), 850 integration tests in 111 files.

**Local development**
- The dev app runs all migrations. It serves this folder's working tree, so keep the folder on main or a branch built from it.
- The notification key lives in the ignored `.env`, with a separate Windows-user-only backup.
- Dev database dumps and their checksums are listed in [[Project Handover 2026-10-25]]. On 2026-10-27 the dev database was dumped to `tmp/dev-before-evt-004-20261027.dump` (SHA-256 `ac783a262e99a7e5702d6762c0c86458346449d825ab1fb9c1d79477d047952f`, 40 tables, owner-only ACLs, 64 migrations), then the dev app applied `20261116010000_guest_checkout_name` and `20261117010000_event_cancellation` (66 migrations, counts unchanged: 26 users, 40 orders, 35 tickets, 20 events). Later dumps are named in the dated entries above.
- The dev database now has all 73 migrations and the `pnpm seed:demo` data; the dev folder serves main.

**Public preview**
- `https://thunderstrux.mistayu.com` runs the production build through `pnpm ops:deploy` as project `ops-preview`: release `d133734` (#226; 72 migrations), Stripe test mode, and no image bucket yet.
- It listens on loopback port 3090 behind the Cloudflare Tunnel, uses `cf-connecting-ip` for client addresses and denies legacy access. MFA enforcement is `off` for now at the owner's request; set it back to `enforce` and redeploy before anyone else uses it.
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
- **Holds (PAY-009, DEF-033):** each event holds tickets for its `checkoutHoldMinutes` (5 to 59, default 20; shop and memberships 20). The stale-order job closes the Stripe page then; seats stay 5 more minutes only while Stripe can't be asked. Stripe's page names the end and order pages count down. New events default to `automatic_full` compensation. [[Payment Lifecycle#Holds]]
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

The PRs of 2026-10-25 to 2026-10-27; later ones are in the dated entries under Current state. Evidence (run IDs, counts, Stripe objects) is in [[Evidence Ledger]] and each PR. Only #197 and #198 added a migration.

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

1. **The rest of the 2026-10-30 audit,** one PR each, with at most two full test runs going at once:
   - money and cancellation (findings 4 to 8 and 13);
   - sales rules (9, 10, 12);
   - emails and jobs (16, 17);
   - checkout and forms (14);
   - stale docs;
   - lean (18, 20, dead code), which waits for the first two.

   The compensation engine merge is debt, due before PAY-002's campaign. Product changes follow: no email step for guest checkout, buyer pays the fee, several ticket types per order, checkout questions, then the O-Week flow.
2. **Preview (owner).**
   - Send a test event from each Stripe test-mode webhook destination and confirm a 200.
   - Add an `ASSET_STORAGE_*` bucket for image uploads.
   - Set `MFA_ENFORCEMENT_MODE` back to `enforce` in `.env.preview`, and redeploy.
   - Once the preview runs #232 or later (it runs `d133734`, from before scanning), scan a batch of tickets in Safari on an iPhone, which has no `BarcodeDetector`, from a second phone's screen and from the ticket email (DEF-064).
   - Never point the tunnel at the dev stack again.
   - The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts (and the `@demo.example.com` ones, if it is ever exposed again).
3. **Dev database:** it has every migration on main, so keep the dev folder on main or a branch built from it; older code's client can't read the newer columns.
4. **Before `thunderstrux.com` serves anyone,** work through the go-live checklist in [[Pre-hosting Candidate]].
   - Create both Stripe webhook endpoints on `2026-09-30.endive` with the restricted key and the event lists in [[Production Operations]]. The key needs Disputes **write**, so each dispute gets its staged draft answer, and Radar early fraud warnings **read**; the payments endpoint also subscribes to `radar.early_fraud_warning.created` and the Connect endpoint to `payout.created`.
   - Pass PAY-002 on the hosted endpoint.
5. **When hosting is chosen,** give `stale-order-worker` and `compensation-worker` the `stripe_secret_key` and `notification_encryption_key` secrets, and every worker `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` (PAY-024, DEF-065; `pnpm docker:hosted:check` refuses them without these), and run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`. Add an uptime or heartbeat check that covers the monitor (OPS-002).
6. **Stripe settings (owner, each sandbox and later live):** before deploying #228, create the Accounts v2 event destination and set `STRIPE_ACCOUNTS_WEBHOOK_SECRET` (dev: the `stripe-accounts-listener` secret; [[Production Operations#Stripe webhook endpoints and keys]]), then drop `account.updated` from each Connect endpoint (PAY-023). In Connect's Express settings, stop accounts editing their payout schedule and using Instant Payouts (PAY-028); add `account.external_account.created` and `account.external_account.updated` to each Connect webhook endpoint (SEC-033; done on the preview), and `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` to each payments endpoint (PAY-030; done on the preview).
7. **Before activating account lifecycle:**
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
