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
- Tunnel preview: APP_PORT=3080 maps loopback host port 3080 to container port 3000; ignored .env uses https://thunderstrux.mistayu.com for auth/public/trusted origins and cf-connecting-ip for client addresses; `proxy.ts` picks the secure session cookie from the Auth.js public URL. Evidence is in [[Project Handover 2026-10-15]]; preview reachability does not resolve production release gates.
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

**Audit (2026-10-25).** A deep `/security-audit` run (`thunderstrux-run-1`, outside the repository) covered `7d72e33` in 72 coverage units over four hunter waves, ending with a clean final critic. Every finding was found, validated and finally verified by separate sandboxed agents with no network and dummy data. It found no cross-tenant access, authentication bypass or injection. The results are 13 confirmed findings (1 high, 5 medium, 7 low) and 11 leads, registered as SEC-001 to SEC-024 in [[Non-Blocking Issue Register]].

**Remediation order**, one PR each:
- T47: request bounds and the unused image optimizer (SEC-001, 013, 018);
- T48: move the live preview onto the production profile, with the seed guard, `AUTH_SECRET` rule and scheme-based secure cookies (SEC-014 to 017);
- T49: accounts and recovery (SEC-002, 007, 008, 012, 019);
- T50: checkout holds, refunds and disputes (SEC-005, 010, 011, 024);
- T51: events, staff and notices (SEC-003, 004, 006, 009);
- T52: `thunderstrux.com` readiness: alerts, public images, release binding, restore fence (SEC-020 to 023);
- T53: a hardening bundle.

The preview at `thunderstrux.mistayu.com` stays the pre-production host; `thunderstrux.com` follows on the Droplet path.

| Item | PR | Status and evidence |
| --- | --- | --- |
| T47 request bounds | [#175](https://github.com/ENGGP/thunderstrux/pull/175) | Ticket types capped at 50, JSON bodies at 100 KB through one `readJsonBody`, validation answers at 20 issues, and `/_next/image` off. No migration. Baseline  on : production build, 42/42 guards, typecheck, 674/674 integration tests in 102 files, no known vulnerabilities. |

## Next Safe Actions

First, ahead of the list below:
- **Contain the live preview now (owner).** Until T48 lands, pause the tunnel's public hostname or put a Cloudflare Access policy in front of it. Re-password or disable the seeded `@example.com` accounts in the dev database, and confirm the ignored `.env` holds a random `AUTH_SECRET` (`openssl rand -base64 32`).
- Continue the security remediation in order, T48 to T53, flipping each SEC row as its PR lands.

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
