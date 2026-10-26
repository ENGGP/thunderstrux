---
status: current
last-reviewed: 2026-10-27
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
- PR_REF (2026-10-27, built on #197's branch) resolves EVT-004 and EVT-005: "Cancel event" refunds every paid order through the refunds worker with one authenticator code, cancels free registrations and emails every holder; buyers can release their own free registration before the event, and the places go back on sale. It adds migration `20261117010000_event_cancellation` (additive: `Event.cancelledAt`, `cancellationReason`, lifecycle source `buyer_action`).

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
- **Payouts (PAY-005, DEF-034):** ticket money is held until 2 days after the event and membership and merchandise money for 7 days after payment, then paid at most once per society per UTC day. [[Stripe Payments and Connect]]
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
| PR_REF | Cancel event and buyer release of free registrations (EVT-004, EVT-005). Adds migration `20261117010000_event_cancellation` |
| #196 | Documentation-audit fixes: deploy stops and restarts workers (OPS-007), ticket email zone and wording, order date filters in the society's zone, refund, payout, analytics, dispute-reversal and disconnect fixes, bounded request bodies, config faults (DEF-047 to DEF-052, PAY-011 to PAY-015, SEC-028, API-002, AUD-002, OPS-006) |

## Next safe actions

1. **Preview (owner).**
   - Send a test event from each Stripe test-mode webhook destination and confirm a 200.
   - Add an `ASSET_STORAGE_*` bucket for image uploads.
   - Never point the tunnel at the dev stack again.
   - The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts.
2. **Dev database:** it already has #197's and PR_REF's migrations (dump above). Keep the dev folder on `codex/cancel-event` or a branch with both until they merge; older code can't read events with `cancelledAt` missing from its client.
3. **DEBT-001 and DEBT-002 cleanup:** the dead and redundant code the documentation audit listed, and the smaller items of the journey audit. Small; no risky behaviour change.
4. **Before `thunderstrux.com` serves anyone,** work through the go-live checklist in [[Pre-hosting Candidate]].
   - Create both Stripe webhook endpoints on `2026-09-30.endive` with the restricted key and the event lists in [[Production Operations]].
   - Pass PAY-002 on the hosted endpoint.
5. **When hosting is chosen,** run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`. Add an uptime or heartbeat check that covers the monitor (OPS-002).
6. **UI-004:** fold the phone filters, use one date formatter, and add the society Overview previews.
7. **PAY-009, when scheduled:** shorter or society-set holds, made by closing the Stripe page early from the stale-order job. It is its own task.
8. **Before activating account lifecycle:**
   - get an independent security and migration review, which also covers #167's payment and sign-in changes and #197's payout-hold, refund and staff-security changes, and PR_REF's bulk refunds on event cancellation;
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
