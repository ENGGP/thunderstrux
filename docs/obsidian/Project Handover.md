---
status: current
last-reviewed: 2026-10-16
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Non-Blocking Issue Register]]", "[[Project Handover 2026-10-15]]", "[[Project Handover 2026-10-12]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover

This is the only current handover. It covers the session that began on **2026-10-15 at main `33e84ce`**, right after the UX redesign (PRs #63 to #67): planning T10 to T46 and delivering Package 4 ticket foundations in waves. The previous session (specification-alignment refactor, tunnel and Redis fixes, UX redesign and design-system sync, 2026-10-12 to 2026-10-15) is retained in [[Project Handover 2026-10-15]]; PR #31 to PR #53 delivery is in [[Project Handover 2026-10-12]]. Start at [[Documentation Index]]; use [[Engineering Delivery Workflow]] for delivery and [[Non-Blocking Issue Register]] for open risks.

## Current State

**Packages 1, 2 and 3 (T01–T09) are implemented and locally qualified; Package 4 is in progress (T10 merged, T11a in review).** Completion does not establish full MVP or hosted production readiness. See [[../MVP_READINESS_WORK_PACKAGES|Work Packages]] and [[../MVP_READINESS_PLAN|Readiness Plan]] for dependencies and detailed evidence.

| Package | Tasks | Delivered capability | Evidence |
| --- | --- | --- | --- |
| 1. Account lifecycle | T02–T04 | Encrypted notifications, verification, recovery, private settings, email change, permanent closure | PRs #31–#33, #36–#38 |
| 2. Staff and permissions | T05–T06 | Live permissions, explicit personal/staff context, private invitations, atomic owner handover | PRs #42–#44 |
| 3. Society profiles and discovery | T07–T09 | Sanitised tenant assets, public profiles and resumable setup, anonymous directory, verified free affiliation | PRs #47–#49 |
| 4. Ticket foundations | T10–T13 (+T14) | T10 purchase snapshots and ticket validity (merged); T11a event policy and readiness (in review) | PRs #68, #70 |

Repository pins: Node 22.23.3, pnpm 10.34.6, Next.js 16.3.8 and Prisma client/CLI 6.19.3. Main's migration chain has 35 migrations, ending in 20261015010000_ticket_purchase_snapshots; the schema has 22 models. [PR #70](https://github.com/ENGGP/thunderstrux/pull/70) adds the 36th, 20261016010000_event_policy (enums and Event columns only). The latest full baseline is T11a executable `da3d1cd` with 398 integration tests in 49 files.

**Local development is activated with all 36 migrations (T10's on 2026-10-15, T11a's on 2026-10-16); hosted activation remains unverified.** Each activation took a verified dump first and restarted only the app container: tmp/dev-before-t10-20261015.dump (SHA-256 624056e28105e649395dcbe8bb4b9ec58e30674a7774e828078e67312aa2f03e) and tmp/dev-before-t11a-20261016.dump (SHA-256 f07f0df86a0a1b48e127c40b1b9c66b0e20235041ecbbc74df15b12bf908b584), both with matching .list files and owner-only ACLs. Earlier archives (tmp/dev-before-package3-20261012.dump and older) are retained. The development app serves the working tree, so keep its checkout on the T11a branch until PR #70 merges: older code cannot create events or orders against this schema. The notification key lives in ignored .env with a separate Windows-user-only backup. [[Troubleshooting]] and [[Production Operations]] own backup and rollback procedure.

## Active Contracts

- Canonical tenant authority is Event.organisationId for event-owned records. Live OrganisationStaff authority grants management access; OrganisationMember is join state only. Stripe remains payment truth and production fulfilment is webhook-driven.
- Verification, reset and email-change links use purpose-bound digests, explicit POST redemption and private encrypted notifications. Signup and recovery responses conceal account existence; old sessions cannot upgrade their authVersion through cookie refresh. [[Authentication and Dashboard Access]] and [[API Reference]] own the contracts.
- Closure is irreversible through the app and anonymises login and editable profile while retaining business, attendance, audit and buyer-capture records. It is not deletion of all personal information.
- Owner handover clears the legacy accountUserId pointer permanently; it is never transferred or restored.
- Asset rollout needs both PostgreSQL metadata and object bytes backed up. [[Society Profiles and Assets]] owns quotas, sanitisation and reference-gated delivery.
- **Purchase facts (T10):** every order records `paymentKind` (required, no default), the purchased ticket name, seller and Stripe account, currency, fee and fee policy version, and the buyer contact with provenance `purchase`. Free orders keep the compatible `paid` status, so money queries filter on `paymentKind`. Tickets carry `validity`; only active tickets admit. [[Payment Lifecycle]] owns the contract.
- **Event policy (T11a, in review):** events have capacity, visibility, a sales close time, open/closed sales and a version. `lib/events/event-readiness.ts` is the only place that decides publication and which ticket types can be bought; create always drafts; publish and sales changes are explicit, idempotent and version-checked. [[Event Lifecycle]] owns the contract.
- Tunnel preview: APP_PORT=3080 maps loopback host port 3080 to container port 3000; ignored .env uses https://thunderstrux.mistayu.com for auth/public/trusted origins and cf-connecting-ip for client addresses; `proxy.ts` picks the secure session cookie from the Auth.js public URL. Evidence is in [[Project Handover 2026-10-15]]; preview reachability does not resolve production release gates.
- Validation follows the risk table in [[Engineering Delivery Workflow]]: local evidence recorded in each PR, GitHub test checks not required (VALID-001), documentation-only changes use docs and diff checks only.

## This Session: T10–T46 Delivery

**Plan.** The maintainer's working plan `docs/MVP_DELIVERY_PLAN_T10_T46.md` (deliberately not committed) sets the order, PR boundaries, shared building blocks and design system for T10 to T46; the [[../MVP_READINESS_PLAN|Readiness Plan]] stays the acceptance authority. Decisions recorded with it on 2026-10-15/16:

- A wave is a batch of tasks, never one PR: each task is its own PR, fully validated and merged before the next. The original nine waves were split into twelve of two to five PRs: 1a (T10, T11a, T12, T14a, T14b), 1b (T11b, T13, after design round A), 2a, 2b, 3, 4, 5, 6a, 6b, 7, 8, 9.
- T10 shipped as one PR (writes and reads together); T14a runs before T13 so free checkout reuses checkout attempts; F1 (AUTHZ-001) lands before T18; T17 before T15.
- The ten section 9 decisions in the plan (design rounds before UI waves, a 10-ticket cap per order, one checkout page, one Memberships nav item, no event cover images, Explore events at `/events`, legacy unknowns stay null, provider choices) run on the recommended defaults until the maintainer changes them; they first matter at T11b, T13, T15 and T22.

**Delivery ledger.**

| Item | PR | Status and evidence |
| --- | --- | --- |
| T10 purchase snapshots and ticket validity | [#68](https://github.com/ENGGP/thunderstrux/pull/68) | Merged as `aa391be`. Executable `1de32d5`: baseline `p216-f01ddee677d417e29253abee` (build, typecheck, 391/391 integration tests in 48 files, clean audit); browser `p216-6151e21b649dfcb8d4b39d36` (3 MFA, 24 desktop/mobile, 7 webhook checks); operations `p217-ci-398c891326` (35 migrations on seeded data, workers, snapshot/ticket-number restore, assets). An earlier baseline caught a real defect: compensation after the fulfilment claim left `fulfilledAt` set; fixed with a regression. |
| Design-system re-sync follow-up | [#69](https://github.com/ENGGP/thunderstrux/pull/69) | Merged. The "Thunderstrux UI" project carries 11 primitives (Icon, Skeleton, ListSkeleton added; Notice with its action slot), the redesigned styles and the updated visual spec; `.design-sync/` previews and notes match. |
| T11a event policy, readiness and explicit publish | [#70](https://github.com/ENGGP/thunderstrux/pull/70) | In review. Executable `da3d1cd`: baseline `p216-0df2cacd43b0da094d89d92c` (398/398 integration tests in 49 files, clean audit); browser `p216-77ee3d5d176e0dfc2ad507f6` (3 MFA, 24 desktop/mobile, 7 webhook checks); operations `p217-ci-0cd7a77c28` (36 migrations, event policy restore). Closes EVT-003; narrows API-001 to ticket types, orders, tickets, Connect and checkout. T11 stays unchecked until T11b. |

Every run above reports cleanup complete with zero run-owned containers, volumes or networks.

**Development activations.** T10 (2026-10-15): 27 orders (12 paid), 32 tickets, 14 users and 14 events unchanged; every order backfilled as Stripe, every paid order has `fulfilledAt`, every ticket active with a unique number; integrity audit 0 violations across 19 checks; orders, order detail, overview, attendees, My tickets and member overview checked at 1280, 768 and 390px. T11a (2026-10-16): counts unchanged, every event closes sales at its start, 0 violations; events list, event, edit and public pages load at 1280 and 390px. Old drafts whose start has passed show "Move the sales close time into the future before publishing."; moving their start forward on the Edit page fixes it, because a close time never set separately follows the start. Setting a different close time, capacity or visibility from the dashboard arrives with the T11b builder.

**Cleanup (2026-10-16).** Merged local and remote branches were deleted after checking each PR head matched the branch; the finished design-sync follow-up session was archived and its clean worktree removed. Stale run logs, PR drafts, draft folders and about 115 completed run folders were removed from `tmp/` (40 MB to under 1 MB); database dumps, the notification key backup and the tunnel and Package 3 activation logs cited in the history notes were kept. Docker images were not pruned.

## Next Safe Actions

1. Review and merge [PR #70](https://github.com/ENGGP/thunderstrux/pull/70) (T11a); the development database already carries its migration.
2. Continue Wave 1a from refreshed main: T12 (inventory and capacity locks), T14a, T14b. Wave 1b (T11b builder, then T13 free tickets) follows design round A. Paid memberships, merchandise and T15 anonymous event details remain later waves.
3. Confirm or change the delivery plan's section 9 decisions before T11b.
4. Before activating account lifecycle, obtain independent security and migration review, provision and separately back up the notification key, and verify reliable Redis and real email acceptance.
5. Choose hosting and satisfy the release gates below. T43 still owns standalone images, immutable publication, SBOM/provenance and image-size work.

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

Use only run-owned disposable test databases with simple names ending in _test. Never reset development or real-user data. Preserve retained backups (including tmp/thunderstrux-before-p319-20260921.dump), failed-run recovery manifests and unrelated caches/resources until their retention or recovery decision is explicit. Take a verified dump before the development app applies a new migration. Local Obsidian workspace state is ignored and must not be committed. Closure anonymisation is not reversed by code rollback; pause account mutations and buyer contact/ticket delivery before rolling back to incompatible older code.
