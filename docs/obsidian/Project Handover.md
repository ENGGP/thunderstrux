---
status: current
last-reviewed: 2026-11-02
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Issue and Defect Register]]", "[[Pre-hosting Candidate]]", "[[Evidence Ledger]]", "[[Project Handover 2026-11-02 Audit Fixes]]", "[[Project Handover 2026-11-02]]", "[[Project Handover 2026-10-25]]"]
sources: [package.json, prisma/schema.prisma, config/schema-contract.json]
---

# Project Handover

**Owns:** where the project stands now: what is delivered, what is in flight, what blocks real users, and the next safe actions.
**Read when:** at the start of every session, after [[Documentation Index]].
**Not here:** how anything works (the living notes, routed from [[Documentation Index]]); open risks ([[Issue and Defect Register]]); run IDs and test counts ([[Evidence Ledger]] and each PR); earlier sessions ([[Project Handover 2026-11-02 Audit Fixes]], [[Project Handover 2026-11-02]], [[Project Handover 2026-10-25]], [[Project Handover 2026-10-15]], [[Project Handover 2026-10-12]]).

## Current state

**2026-11-02.** The dated entries below are this session's: the UI/UX audit and its fixes (#273 to #275), the night violet round (#277, #278), and their preview deploys. The 2026-10-30 audit's fixes, up to the `4fa63e9` deploy, are in [[Project Handover 2026-11-02 Audit Fixes]]; everything earlier is in [[Project Handover 2026-11-02]].
- T01 to T46 are delivered and locally qualified, apart from the assistant (T35 to T37), which the founder deferred. [[Pre-hosting Candidate]] is the candidate record.
- 2026-11-02: a UI/UX audit of every page at 390 and 1280px (275 views, 7 roles) found 9 P1 and 34 P2 issues: flows that lose the user's place, phone navigation crowding the screen, one fact shown several ways, and end states that are hard to see. Three PRs fix them by area. #273 does the public, buying and personal pages (UI-032 to UI-052): the phone buy bar no longer picks a ticket for the buyer, sign-in comes back to the page, a guest's basket survives the email link, unknown event and society links answer 404, and joining while unverified offers verification. Uploads are now stored at most 2048px wide, and PERF-004 tracks sized copies. #274 does the door, events and organiser pages (UI-053 to UI-064): check-in verdicts a bright venue can read, Check in all for an order, a door screen that starts at the search on a phone, cancelled events that read as cancelled, one meaning for Sold, Publish on a draft's Edit, and a first run that shows setup steps rather than zeros. #275 does orders and the back office (UI-065 to UI-073): one set of order pills derived from the badge, so every order is under exactly one and Needs review is what the overview counts; a page for membership orders never granted; and plainer order pages, refunds, pickups, analytics, roster, profile editor and staff page. No migration.
- 2026-11-02: the preview was deployed at `2a5d5d9` (#275; backup `ops-preview-2026-11-02T12-08-18-562Z.dump` first; 73 migrations, none new), so it now has the UI/UX audit's fixes (#273 to #275). Readiness answers 200 on port 3090 and on `thunderstrux.mistayu.com`, the six workers ran on the release's ops image with no failures, and `MFA_ENFORCEMENT_MODE` is still `off`. On the public URL the site icons are served, unknown event and society links answer 404, the home and society pages carry link previews, and the phone Menu opens as a popover and closes on Escape.
- 2026-11-03: a colour critique of every page (2 Nov) found purple doing about fifteen jobs, five near-identical lavenders with five meanings, and weak status at decision points. The owner chose night violet. Round G on the design canvas (17 boards, reviewed with `/impeccable critique` and revised) was approved on 3 Nov and is built in two PRs. #277 is PR 1: night violet owns the home hero (with a ticket stub for the soonest event), the organiser column, the date tile and image placeholders; the canvas darkens so cards lift; disabled fields turn inert grey; information leaves purple; the focus ring is ink with a white gap; row titles and utility links are quiet ink; Cancel and the staff and society danger walls quieten; charts hatch refunds with a crimson amount and grey a cancelled event's sales. #277 merged on 3 Nov. #278, merged the same day, is PR 2: every status badge carries a glyph and green means only money moved or someone admitted; a cancelled event is one danger "Cancelled"; the door's verdicts are GO, striped STOP (Already checked in included, overriding ORG-06's separate warning) and HOLD bands, 72px on phones, and the door has its own Auto/Light/Dark mode; the buyer's ticket leads with a status band and a used one shows when it was used; anything that blocks a purchase is an ochre warning with a button, and the verify banner steps aside where the page asks itself; returned money is struck through on Purchases and the overview, and a partial refund shows the part refunded; phone tab bars keep the current tab in view and bottom bars lift. No migration.
- 2026-11-03: the preview was deployed at `e15cb90` (#278; backup `ops-preview-2026-11-03T10-06-35-862Z.dump` first; 73 migrations, none new), so it now has the night violet round (#277 and #278). Readiness answers 200 on port 3090 and on `thunderstrux.mistayu.com`, each of the six workers' first run on the release's ops image exited 0, and `MFA_ENFORCEMENT_MODE` is still `off`. The public home page serves the night hero, and its stylesheet carries the door's dark mode and STOP stripes.

- 2026-11-04: at the owner's request every dropdown is the house `Select` (`components/ui/select.tsx`, an ARIA combobox in the design system's style) instead of the browser's own list, the event builder's calendar no longer cuts off Sunday, and a new event's end fills in two hours after its start and follows it until the organiser picks one. No migration. [[UI Architecture Rules#Primitives]], [[Event Lifecycle#Creating]].
- 2026-11-04: the preview was deployed at `d8f54fd` (#286; backup `ops-preview-2026-11-03T15-46-22-655Z.dump` first; 75 migrations, none new), so it now has the house dropdowns, the calendar fix and the end time that follows the start. Readiness answers 200 on port 3090 and on `thunderstrux.mistayu.com`, each of the six workers' first run on the release's ops image succeeded, `MFA_ENFORCEMENT_MODE` is still `off`, and `/admin` answers 404 on both. The public `/events` page serves the new combobox.
- 2026-11-04: a sign-up with an address that already has an account still answers the same, and now emails that account's owner (`signup_existing_account`: sign in, or reset the password; at most one an hour, never a disabled account). Before, nothing was sent. [[Authentication and Dashboard Access]].
- 2026-11-04: at the owner's request the dev portal (`http://127.0.0.1:3080/admin`) asks for no authenticator: `docker-compose.dev.yml` sets `ADMIN_PORTAL_MFA=off`, honoured only under `NODE_ENV=development`. The preview and production still always ask. [[Platform Admin Portal]].
- 2026-11-04: the owner's new mark (a two-part bolt on a lavender tile) is the app logo: favicon (`app/icon.svg`, `app/favicon.ico`), home-screen icon, and beside the wordmark in the header, footer and admin shell. From `md` to `lg` the header shows the mark alone, which also fixes Sign out being cut off for staff at 768px. Not yet on the preview. [[UI Architecture Rules#Global header and footer]].
- 2026-11-03: the preview was deployed at `a59e70d` (#281; backup `ops-preview-2026-11-03T12-59-55-377Z.dump` first; 74 migrations, `20261125010000_platform_admin` new). Readiness answers 200 on port 3090 and on `thunderstrux.mistayu.com`, the six workers restarted on the release's ops image, `MFA_ENFORCEMENT_MODE` is still `off`, and `/admin` answers 404 on both. `pnpm ops:admin` served the portal on `127.0.0.1:3091`; its early exit is fixed in this PR.
- 2026-11-03: the platform admin portal was planned (grilled with the owner: dedicated operator logins, authenticator always on, no impersonation, loopback-only, CLI-only grants, a logged trail, 72 h takeover-class recovery) and designed as round H on the canvas, approved the same day. T54 builds its read-only foundation: `PlatformOperator`, the append-only `PlatformAuditLog`, `User.lastSignInAt` (migration `20261125010000_platform_admin`), `pnpm ops:operator` and `pnpm ops:admin`, and `/admin` (overview, search, user, society and order records, operations, audit, operators). The changes are T55 (ADMIN-001). [[Platform Admin Portal]].
- 2026-11-03: T55 (#283) adds every change an operator can make, through one dialog (what happens, why, a fresh code; Undo where there is an opposite) and `POST /api/admin/actions`: resend verification, password reset, sign out everywhere, disable and re-enable; an authenticator reset or ownership recovery that tells everyone and completes only after 72 hours (ownership also holds payouts 7 days), with a wizard and a request timeline at `/admin/recovery/[requestId]`; restricting a society (checkout, publishing, reopening, Connect changes, listings and payouts stop) and holding payouts; revoking another operator; pausing jobs and running the integrity audit. Each change writes its trail row in the same transaction and alerts `platform_admin_action`; society History shows "Thunderstrux support". Migration `20261126010000_platform_admin_controls` is additive; before rolling back across it, pause the `refunds` job. The dev database was dumped to `tmp/dev-before-t55-platform-controls-20261103.dump` first (43 tables).
- 2026-11-03: the preview was deployed at `09fc714` (#283; backup `ops-preview-2026-11-03T14-22-09-772Z.dump` first; 75 migrations, `20261126010000_platform_admin_controls` new), so it now has T55. Readiness answers 200 on port 3090 and on `thunderstrux.mistayu.com`, each of the six workers' first run on the release's ops image succeeded (the refunds job's payouts batch included), `MFA_ENFORCEMENT_MODE` is still `off`, and `/admin` and `POST /api/admin/actions` answer 404 on both. The `a59e70d` `pnpm ops:admin` container left from #282's first run was stopped first, so no T54 portal ran against the T55 schema. Then `pnpm ops:admin -- --project ops-preview --env-file .env.preview`, run from main, printed `Admin portal ready: http://localhost:3091/admin` and kept running (#282's hold): `ops-preview-admin` from `thunderstrux-app:09fc714` is healthy on `127.0.0.1:3091` only, readiness answers 200, `/admin` redirects to sign-in and a foreign `Host` gets 404. It was left up for the owner's first sign-in; Ctrl-C's stop and removal is still to be seen.

**Snapshot, 2026-11-02.** Re-derive these from `package.json`, `prisma/migrations/` and `config/schema-contract.json` before relying on them.
- Pins: Node 22.23.4, pnpm 10.34.9, Next.js 16.4.3, Prisma 6.19.3, stripe 23.1.0 on API `2026-10-28.endive`.
- Migrations: 75, ending in `20261126010000_platform_admin_controls`. Models: 43.

**Local development**
- The dev app runs all migrations. It serves this folder's working tree, so keep the folder on main or a branch built from it.
- The notification key lives in the ignored `.env`, with a separate Windows-user-only backup.
- Dev database dumps and their checksums are listed in [[Project Handover 2026-10-25]]. On 2026-10-27 the dev database was dumped to `tmp/dev-before-evt-004-20261027.dump` (SHA-256 `ac783a262e99a7e5702d6762c0c86458346449d825ab1fb9c1d79477d047952f`, 40 tables, owner-only ACLs, 64 migrations), then the dev app applied `20261116010000_guest_checkout_name` and `20261117010000_event_cancellation` (66 migrations, counts unchanged: 26 users, 40 orders, 35 tickets, 20 events). Later dumps are named in the dated entries of [[Project Handover 2026-11-02]].
- The dev database now has all 73 migrations and the `pnpm seed:demo` data; the dev folder serves main. Dev's dependencies were last rebuilt at #268.

**Public preview**
- `https://thunderstrux.mistayu.com` runs the production build through `pnpm ops:deploy` as project `ops-preview`: release `d8f54fd` (#286; 75 migrations), Stripe test mode, and no image bucket yet.
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
- **Delivery:** follow [[Engineering Delivery Workflow]]. Each PR records local evidence; GitHub test checks are optional (VALID-001), but a failed `release-pair` blocks a merge; docs-only changes run only the docs and diff checks.
- **Product decisions:** follow how Eventbrite, Humanitix and Luma solved the same problem, thought through for a student-society tool, with the reasoning recorded in the PR.

## Next safe actions

1. **Next engineering work.** The night violet round (#277, #278) is merged and on the preview; the owner runs `/design-sync` to refresh the claude.ai design project. The 2026-10-30 audit and the 2026-11-02 UI/UX audit's fixes (#273 to #275) are finished and on the preview too. Only the sent payout amount stays unproven, because the test account's available balance was $0.

   The compensation engine merge (DEBT-003) is due before PAY-002's campaign. Product changes follow ([[THUNDERSTRUX_PRD#What comes next]]): no email step for guest checkout, buyer pays the fee, several ticket types per order, checkout questions with attendee names and the student number in the export, then the O-Week flow.
2. **Preview (owner).**
   - The public URL needs the `cloudflared` Windows service. It stopped once on 2026-11-02 and nothing shows why; it runs again and the URL answers 200. If the URL answers 530 while port 3090 is healthy, start that service.
   - The webhook endpoints are `we_1UXEi62NYytE9ruqV2ndcTqD` (payments) and `we_1UXEi62NYytE9ruqbUkxoeaf` (Connect), both on `2026-10-28.endive` and both proven. The Accounts v2 destination has passed.
   - Add an `ASSET_STORAGE_*` bucket for image uploads.
   - Keep `MFA_ENFORCEMENT_MODE=off` in `.env.preview`: a deploy doesn't change it, and only the owner decides when it does.
   - Never point the tunnel at the dev stack again.
   - The dev database was public twice on 2026-10-26, so re-password or disable its seeded `@example.com` accounts (and the `@demo.example.com` ones, if it is ever exposed again).
3. **Dev database:** it has every migration on main, so keep the dev folder on main or a branch built from it; older code's client can't read the newer columns.
4. **Before `thunderstrux.com` serves anyone,** work through the go-live checklist in [[Pre-hosting Candidate]].
   - Create both Stripe webhook endpoints on `2026-10-28.endive` with the restricted key and the event lists in [[Production Operations]]. The key needs Disputes **write**, so each dispute gets its staged draft answer, and Radar early fraud warnings **read**; the payments endpoint also subscribes to `radar.early_fraud_warning.created` and the Connect endpoint to `payout.created`.
   - Pass PAY-002 on the hosted endpoint.
5. **When hosting is chosen,** give `stale-order-worker` and `compensation-worker` the `stripe_secret_key` and `notification_encryption_key` secrets, and every worker `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` (PAY-024, DEF-065; `pnpm docker:hosted:check` refuses them without these), and run every worker each minute (`docker-compose.schedules.yml` or the platform scheduler), including `checkout-recovery-worker` and `monitor-worker`. Add an uptime or heartbeat check that covers the monitor (OPS-002).
6. **Stripe settings (owner, each sandbox and later live):** before deploying #228 anywhere new, create the Accounts v2 event destination (the preview has one) and set `STRIPE_ACCOUNTS_WEBHOOK_SECRET` (dev: the `stripe-accounts-listener` secret; [[Production Operations#Stripe webhook endpoints and keys]]), then drop `account.updated` from each Connect endpoint (PAY-023). In Connect's Express settings, stop accounts editing their payout schedule and using Instant Payouts (PAY-028); add `account.external_account.created` and `account.external_account.updated` to each Connect webhook endpoint (SEC-033; done on the preview), and `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` to each payments endpoint (PAY-030; done on the preview).
7. **Before activating account lifecycle:**
   - get the independent review in [[Pre-hosting Candidate#Gates before real users and real money]], which covers #167's payment and sign-in changes, #197's payout-hold, refund and staff-security changes, #198's bulk refunds on event cancellation, and the payment changes from #239 to #252 and #266;
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
