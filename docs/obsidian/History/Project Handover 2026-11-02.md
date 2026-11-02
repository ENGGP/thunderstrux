---
status: historical
last-reviewed: 2026-11-02
owner: engineering
related: ["[[Project Handover]]", "[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Issue and Defect Register]]", "[[Project Handover 2026-10-25]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover 2026-11-02

**Archived 2026-11-02, when [[Project Handover]] ran out of room under the note limit.** It covers the session that began on 2026-10-25 at `1bc34ef`, up to the 2026-10-30 audit. The content below is as it stood. The audit's fixes (#234 on) are in [[Project Handover 2026-11-02 Audit Fixes]]; [[Project Handover]] is the current handover.

## Dated entries

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
- 2026-10-30: #228 moves societies' Stripe accounts to Accounts v2 (PAY-023): created and read through v2, readiness capability by capability, manual payouts through Balance Settings, account changes as v2 thin events at `/api/stripe/accounts/webhook` (`STRIPE_ACCOUNTS_WEBHOOK_SECRET`). Existing accounts keep working unchanged. No migration. Before deploying it anywhere, the owner creates that event destination (see Next safe actions in [[Project Handover]]).
- 2026-10-30: #229 closes DEBT-001 and DEBT-002: dead code removed (including `autoprefixer` and the `tsconfig.json` rewrite), check-in scoped to the event (`?eventId=`), a per-account sign-in limit, safer staff-invite wording, compensation checked against the seller snapshot, and members-only access checked again at fulfilment. No migration.
- 2026-10-30: #230 adds QR tickets and door scanning, after a comparison with Humanitix, Eventbrite and Luma, which all scan at the door. Each active ticket shows a QR code of its id on the ticket face and in the ticket email (an inline PNG: Gmail and Outlook for Windows drop `data:` images). The check-in console gains Scan QR codes (`BarcodeDetector`, else `@zxing/library`'s QR reader for iOS), which checks a ticket in as it reads it; `Permissions-Policy` now allows the camera for the site. The check-in list shows buyer emails only to roles with `orders:read` (SEC-038), and `check_in_staff` needs no staff authenticator under `enforce` (accepted risk SEC-039; [[Authentication and Dashboard Access#Staff MFA]]). No migration.
- 2026-10-30: #231 adds ticket codes, as Eventbrite, Humanitix and Luma offer: discount codes (percent or dollars), access codes that unlock a hidden ticket type, and comps (100% off, through the free path), per event, with a ticket limit, a last day and on/off, managed on the Edit tab and shown in the Summary, the order page and the orders CSV ([[Event Lifecycle#Codes]]; the decision and its reasoning are in the PR). Registers EVT-007 (a code's limit isn't rechecked at fulfilment). Additive migration `20261124010000_ticket_codes`; take a verified dump first, then apply it with `prisma migrate deploy` on each database.
- 2026-10-30: #232 ends the flaky scan tests and strengthens the door's fallback reader (DEF-064). ZXing can pick a shape in a code's data as a corner, so the integration test reads its clean render with `PURE_BARCODE`, the e2e spec uses fixed ids, and the console retries each frame at half size. No phone has tried the fallback yet, so DEF-064 stays open for that check. No migration.
- 2026-10-30: dev moved to main at `a1852db`. The dev database was dumped first to `tmp/dev-before-evt-007-20261030.dump` (SHA-256 `d3e0af013e3f1f0ded0caab4a4450a9105e8805fb1b694b37c8f65518714f637`, 40 tables, owner-only, 72 migrations; 94 users, 711 orders, 998 tickets, 76 events, 193 commerce orders; a disposable restore matched every table's row count). `pnpm docker:restart` then installed #230's `@zxing/library` and applied `20261124010000_ticket_codes` (73), with every existing table's rows unchanged.

## PRs of 2026-10-25 to 2026-10-27

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
