---
status: current
last-reviewed: 2026-11-02
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Issue and Defect Register]]", "[[Pre-hosting Candidate]]", "[[Evidence Ledger]]", "[[Project Handover 2026-11-02]]", "[[Project Handover 2026-10-25]]"]
sources: [package.json, prisma/schema.prisma, config/schema-contract.json]
---

# Project Handover

**Owns:** where the project stands now: what is delivered, what is in flight, what blocks real users, and the next safe actions.
**Read when:** at the start of every session, after [[Documentation Index]].
**Not here:** how anything works (the living notes, routed from [[Documentation Index]]); open risks ([[Issue and Defect Register]]); run IDs and test counts ([[Evidence Ledger]] and each PR); earlier sessions ([[Project Handover 2026-11-02]], [[Project Handover 2026-10-25]], [[Project Handover 2026-10-15]], [[Project Handover 2026-10-12]]).

## Current state

**2026-11-02, after #253.** Dated entries below run oldest first, from the 2026-10-30 audit on. Everything earlier is in [[Project Handover 2026-11-02]].
- T01 to T46 are delivered and locally qualified, apart from the assistant (T35 to T37), which the founder deferred. [[Pre-hosting Candidate]] is the candidate record.
- 2026-10-30: #234 starts the fixes from the 2026-10-30 audit, the first of seven PRs. No migration.
  - The stale-order and refunds jobs get `EMAIL_FROM`, the notification key and the app URL from one shared settings block in each compose file, and the config check refuses them without these (DEF-065).
  - Sign-in takes only a plain form with an address (SEC-040).
  - Per-address limits rose for campus Wi-Fi (DEF-066).
  - The three webhooks refuse bodies over 1 MB (SEC-041).
  - `.claude/worktrees` is out of the Docker build context and the type check.
  - A failed sign-in took the same time for a real and an unknown address on dev (3 to 17 ms apart, inside the spread between runs), so that audit item needed no fix.
- 2026-10-30: #235 lets two full test runs go at once. Each run tags its images with its run id, so it can't test another run's code, and Docker picks its host port. Staging stays one at a time, with its own check, because the old port check was what kept those runs apart. No app code changes.
- 2026-10-31: #236, the stale-docs PR of the 2026-10-30 audit, corrects claims that no longer matched the code (no `openclaw:use` permission, the merchandise hold is 20 minutes, fulfilment rechecks members-only access, the Events list counts active tickets, PAY-008's refund cost and what Humanitix returns) and the `/fees` refund wording now covers per-ticket refunds. No migration.
- 2026-10-31: #238 resolves DEF-064: the owner scanned three tickets with the camera in Safari on an iPhone against the preview, so the fallback reader has now worked on a real phone.
- 2026-10-31: #237 fixes the audit's email and job findings (16, 17; DEF-067 to DEF-070, SEC-043). Both email jobs send for up to 45 seconds a run, sign-in and guest links go first, and a 429 uses no attempt and ends the run. Finished notifications are deleted after 30 days, except a Stripe deadline notice, which stays until 30 days after its deadline. A failed step in the notification job alerts `notification_step_failed`, and a timed-out run keeps its lease until it lapses. The tests prove the queues drain, not how fast real email goes. No migration.
- 2026-10-31: #240 fixes the audit's checkout and forms items (finding 14, DEF-071 to DEF-074, UI-026). A failed attempt no longer sticks to Pay, and all three buttons share `useCheckout`; the create forms send one request; the door's 10-second timeout covers the token fetch; the orders list stops loading every event; society dates missing their zone now pass it. Registers DEF-075 (a doubled sentence in two refusals). No migration.
- 2026-10-31: #241 fixes the audit's money and cancellation findings (PAY-044 to PAY-049, EVT-008, EVT-009): payouts count Stripe's pending balance, a cancelled event holds a failed refund's money, the stale-order job expires before its sweep and failing orders go to the back of its queue, Mark as refunded needs a paid order, cancelling stops a waiting "still valid" email, the calendar marks cancelled events and the door leaves them out, buyers see every refund added up, and a queued refund adjusts to one made in Stripe (tried once against Stripe test mode). No migration.
- 2026-10-31: #239 applies the audit's sales rules (PAY-050 to PAY-053, EVT-010, EVT-011): one ticket at the member price per member per event, with later tickets at the standard price; a cap on one buyer's free merchandise; plans keep their term when a society changes zone; checkout reads its clock after the event lock and no longer blames a code nobody used; a direct PATCH without `ticketTypes` leaves them alone. No migration.
- 2026-10-31: #242 brings `Memberships and Merchandise` back under the note limit, after #239 merged with `pnpm docs:check` failing.
- 2026-10-31: #243 applies #239's review follow-ups (PAY-055, UI-027): membership and merchandise checkout and fulfilment read the clock after their locks, as ticket checkout now does, and merchandise checkout explains the free cap and links back to the basket. No migration.
- 2026-10-31: #243 also adds `pnpm docker:cleanup` to the delivery workflow (DEF-076): after testing it removes only what finished runs and rehearsals left in Docker, and caps the build cache at 12 GB. Never prune this Docker: it also holds the dev stack, the preview and another project's database. Release images are left to the deploy; an old pair frees about 0.7 GB, because pairs share layers.
- 2026-10-31: #244, the last fix of the 2026-10-30 audit, removes code. No migration.
  - The three commerce refund openers are one `openCommerceRefund`, and every refund follows PAY-036: only an open or lost dispute blocks. Compensation no longer opens a refund during a dispute (the order stays under review), and a fraud refund no longer stops at a won one.
  - A paid replay never fulfils a ticket order under review: every way into review ends the hold, so the recovery path and `failOrder` are gone. `recovered` and `compensation_recovered` stay in the schema for old rows; nothing writes them.
  - The four MFA copies use `requireFreshStaffMfa`, the empty commerce `release` hook is gone, and so are `publicPlans`, `getUpcomingTicketOrders` and other dead code. DEF-075 is closed; DEBT-003 and PAY-056 are registered.
- 2026-10-31: #245 resolves PAY-056 and DEF-077: buyers whose refund a dispute holds read that the bank decides, not that a refund is coming, and winning the dispute releases it (commerce opens the refund; an automatic ticket job goes back to the worker; a manual one alerts a person). A paid membership under review no longer reads "No payment taken". Registers PAY-057. No migration.
- 2026-10-31: #246 resolves PAY-057 and DEF-078: a compensation order whose money is already back closes its review and tells the buyer, a lost dispute that turns to won reopens it, and a paid replay no longer reopens a settled order. Registers PAY-058. No migration.
- 2026-11-01: the preview was deployed at `2df7769` (#246; backup `ops-preview-2026-10-31T16-34-37-265Z.dump` first; 73 migrations, none new), so it now has every fix of the 2026-10-30 audit. Readiness answers 200 locally and on `thunderstrux.mistayu.com`, the six workers ran on the release's ops image with exit 0, and `MFA_ENFORCEMENT_MODE` is still `off`.
- 2026-11-02: a review of #234 to #247 against the audit's plan found them consolidated: every task landed, no PR overwrote another, and no path refunds twice. It also found that the plan's four end-to-end journeys were never run (#247 wrongly implied they were), that #235 left staging's return pages dead, and ten defects. #248 corrects the docs and tracks what nobody tracked. The fixes follow in order.
- 2026-11-02: #249 makes staging work again: it publishes port 3100 for the browser's return from Stripe (DEF-079), and checks Stripe's named release rather than its date, since Stripe released `2026-10-28.endive` (DEF-081, PAY-061). A third full run is now refused, and `--answers-in-files` lets someone who can't type in the terminal confirm a step. Two baselines on different commits ran side by side, proving #235's claim, and exposed a flaky test (DEF-080). No migration.
- 2026-11-02: #250 closes the refund gaps that review found: a won dispute on a failed refund alerts a person (PAY-064), a kept application fee alerts finance (PAY-062), a staff refund is never resized (PAY-063), merchandise tabs place a closed review under Refunded (UI-028), a refund in flight that fails closes a review a lost dispute left to it (PAY-058, narrowed), a second closing email can send (DEF-082), queued "still valid" emails stop at cancellation (DEF-083), and winning a dispute on a cancelled event opens the refund (EVT-012). Its browser run also caught calendar links whose names dropped their visible words (DEF-084). No migration.
- 2026-11-02: #251 settles comp codes (PAY-065: a code that makes the standard price free ignores the member price), refuses commerce totals under $2.00 (PAY-066), and fixes what the opening review of #230 to #232 found: the door card after a failed re-read (DEF-085), cancelled events admitting (EVT-013), and smaller items. It also closes the named test gaps. No migration.
- 2026-11-02: #252 is the audit's proof. A browser journey runs a code, a member price, one refund, a cancellation and the held figure. Staging gained `compensation-dispute-won` and `commerce-compensation-dispute-lost`, and all 14 scenarios passed on real Stripe test mode for the first time since accounts became unique to a society (DEF-093, DEF-094). The four journeys passed on dev with real Checkout pages, including a lost webhook settled by the sweep in 168 seconds. No app code changed.
- 2026-11-02: the preview was deployed at `75e3109` (#252; backup `ops-preview-2026-11-01T23-21-22-232Z.dump` first; 73 migrations, none new), so it now has every fix of the audit's plan. Readiness answers 200 on port 3090, the six workers ran on the release's ops image with exit 0, and `MFA_ENFORCEMENT_MODE` is still `off`. The public URL was already down, because the tunnel service had stopped.

**Snapshot after #252.** Re-derive these from `package.json`, `prisma/migrations/` and `config/schema-contract.json` before relying on them.
- Pins: Node 22.23.4, pnpm 10.34.7, Next.js 16.4.2, Prisma 6.19.3, stripe 23.0.1 on API `2026-09-30.endive`.
- Migrations: 73, ending in `20261124010000_ticket_codes`. Models: 40.
- Latest full baseline: `baseline-68c7c6f0951482a66e855e4e` (#252), 1037 integration tests in 118 files.

**Local development**
- The dev app runs all migrations. It serves this folder's working tree, so keep the folder on main or a branch built from it.
- The notification key lives in the ignored `.env`, with a separate Windows-user-only backup.
- Dev database dumps and their checksums are listed in [[Project Handover 2026-10-25]]. On 2026-10-27 the dev database was dumped to `tmp/dev-before-evt-004-20261027.dump` (SHA-256 `ac783a262e99a7e5702d6762c0c86458346449d825ab1fb9c1d79477d047952f`, 40 tables, owner-only ACLs, 64 migrations), then the dev app applied `20261116010000_guest_checkout_name` and `20261117010000_event_cancellation` (66 migrations, counts unchanged: 26 users, 40 orders, 35 tickets, 20 events). Later dumps are named in the dated entries of [[Project Handover 2026-11-02]].
- The dev database now has all 73 migrations and the `pnpm seed:demo` data; the dev folder serves main.

**Public preview**
- `https://thunderstrux.mistayu.com` runs the production build through `pnpm ops:deploy` as project `ops-preview`: release `75e3109` (#252; 73 migrations), Stripe test mode, and no image bucket yet.
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

## Next safe actions

1. **Next engineering work.** The 2026-10-30 audit is finished and on the preview. Only the sent payout amount stays unproven, because the test account's available balance was $0.

   The compensation engine merge (DEBT-003) is due before PAY-002's campaign. Product changes follow ([[THUNDERSTRUX_PRD#What comes next]]): no email step for guest checkout, buyer pays the fee, several ticket types per order, checkout questions with attendee names and the student number in the export, then the O-Week flow.
2. **Preview (owner).**
   - Start the `cloudflared` Windows service. It was found stopped on 2026-11-02, so `thunderstrux.mistayu.com` answers 530 while the preview itself is healthy on port 3090. Nothing shows why it stopped, and the machine had been asleep.
   - Then make one real test-mode payment on the preview and confirm its webhook settles it. The two snapshot destinations can't be pinged (#238), so that is their proof. The Accounts v2 destination has passed.
   - Add an `ASSET_STORAGE_*` bucket for image uploads.
   - Keep `MFA_ENFORCEMENT_MODE=off` in `.env.preview`: a deploy doesn't change it, and only the owner decides when it does.
   - Never point the tunnel at the dev stack again.
   - The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts (and the `@demo.example.com` ones, if it is ever exposed again).
3. **Dev database:** it has every migration on main, so keep the dev folder on main or a branch built from it; older code's client can't read the newer columns.
4. **Before `thunderstrux.com` serves anyone,** work through the go-live checklist in [[Pre-hosting Candidate]].
   - Create both Stripe webhook endpoints on `2026-09-30.endive` with the restricted key and the event lists in [[Production Operations]]. The key needs Disputes **write**, so each dispute gets its staged draft answer, and Radar early fraud warnings **read**; the payments endpoint also subscribes to `radar.early_fraud_warning.created` and the Connect endpoint to `payout.created`.
   - Pass PAY-002 on the hosted endpoint.
5. **When hosting is chosen,** give `stale-order-worker` and `compensation-worker` the `stripe_secret_key` and `notification_encryption_key` secrets, and every worker `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` (PAY-024, DEF-065; `pnpm docker:hosted:check` refuses them without these), and run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`. Add an uptime or heartbeat check that covers the monitor (OPS-002).
6. **Stripe settings (owner, each sandbox and later live):** before deploying #228 anywhere new, create the Accounts v2 event destination (the preview has one) and set `STRIPE_ACCOUNTS_WEBHOOK_SECRET` (dev: the `stripe-accounts-listener` secret; [[Production Operations#Stripe webhook endpoints and keys]]), then drop `account.updated` from each Connect endpoint (PAY-023). In Connect's Express settings, stop accounts editing their payout schedule and using Instant Payouts (PAY-028); add `account.external_account.created` and `account.external_account.updated` to each Connect webhook endpoint (SEC-033; done on the preview), and `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` to each payments endpoint (PAY-030; done on the preview).
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
