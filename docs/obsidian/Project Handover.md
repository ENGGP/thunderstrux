---
status: current
last-reviewed: 2026-10-12
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Non-Blocking Issue Register]]", "[[Project Handover 2026-10-12]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover

This is the only current handover. It covers the session that began on **2026-10-12 at main `b82198d`**: the specification-alignment refactor described below. Delivery from PR #31 to PR #53, with its run IDs and qualification evidence, is retained in [[Project Handover 2026-10-12]]. Start at [[Documentation Index]]; use [[Engineering Delivery Workflow]] for delivery and [[Non-Blocking Issue Register]] for open risks.

## Current State

**Packages 1, 2 and 3 (T01–T09) are implemented and locally qualified.** Completion does not establish full MVP or hosted production readiness. See [[../MVP_READINESS_WORK_PACKAGES|Work Packages]] and [[../MVP_READINESS_PLAN|Readiness Plan]] for dependencies and detailed evidence.

| Package | Tasks | Delivered capability | Evidence |
| --- | --- | --- | --- |
| 1. Account lifecycle | T02–T04 | Encrypted notifications, verification, recovery, private settings, email change, permanent closure | PRs #31–#33, #36–#38 |
| 2. Staff and permissions | T05–T06 | Live permissions, explicit personal/staff context, private invitations, atomic owner handover | PRs #42–#44 |
| 3. Society profiles and discovery | T07–T09 | Sanitised tenant assets, public profiles and resumable setup, anonymous directory, verified free affiliation | PRs #47–#49 |

Repository pins: Node 22.23.3, pnpm 10.34.6, Next.js 16.3.8 and Prisma client/CLI 6.19.3. The migration chain has 34 migrations, ending in 20261011020000_society_profiles; the schema has 22 models. The latest full baseline recorded before this session is T09 executable `15a1e4b` with 354 integration checks; the archived handover holds every run ID.

**Local development is activated with all 34 migrations (2026-10-12); hosted activation remains unverified.** The pre-activation archive tmp/dev-before-package3-20261012.dump (SHA-256 7977c8df5b377e4a9e03ad41fefda02d5045a1aed0b21bf21d9f6a765e192f10) and the earlier tmp/dev-before-context-refresh-20261009.dump are retained. The notification key lives in ignored .env with a separate Windows-user-only backup. [[Troubleshooting]] and [[Production Operations]] own backup and rollback procedure.

## Active Contracts

- Canonical tenant authority is Event.organisationId for event-owned records. Live OrganisationStaff authority grants management access; OrganisationMember is join state only. Stripe remains payment truth and production fulfilment is webhook-driven.
- Verification, reset and email-change links use purpose-bound digests, explicit POST redemption and private encrypted notifications. Signup and recovery responses conceal account existence; old sessions cannot upgrade their authVersion through cookie refresh. [[Authentication and Dashboard Access]] and [[API Reference]] own the contracts.
- Closure is irreversible through the app and anonymises login and editable profile while retaining business, attendance, audit and buyer-capture records. It is not deletion of all personal information.
- Owner handover clears the legacy accountUserId pointer permanently; it is never transferred or restored. Invitation activation requires migration 20261009010000_private_staff_invites before app and workers.
- Asset rollout needs both PostgreSQL metadata and object bytes backed up. [[Society Profiles and Assets]] owns quotas, sanitisation and reference-gated delivery.
- Validation follows the risk table in [[Engineering Delivery Workflow]]: local evidence recorded in each PR, GitHub test checks not required (VALID-001), documentation-only changes use docs and diff checks only.

## Specification-Alignment Refactor (this session)

**Purpose.** Make the code match the [PRD](../THUNDERSTRUX_PRD.md), [UX Specification](../THUNDERSTRUX_UX_USER_FLOW_SPEC.md), [Database Specification](../THUNDERSTRUX_DATABASE_ARCHITECTURE_AND_SCHEMA_SPEC.md) and [Visual Design](../THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) for everything owned by T01–T09, with the visual system applied to every existing screen. No T10+ feature is built, no schema migration is added, and domain, security and payment behaviour is unchanged.

**Maintainer decisions (2026-10-12).**

- The design system is rolled out to all existing screens. Screens owned by T10+ (event builder, orders, check-in, wallet, Stripe settings, success/cancel) receive presentation only.
- Public society pages move to `/societies` and `/societies/[orgSlug]`; `/organisations` paths redirect permanently. `/api/orgs/*` and `/dashboard/organisations` do not move.
- DM Sans and Space Grotesk load through next/font and are served by the app.
- Delivery is five phased PRs merged by the maintainer.

**Constraints the refactor keeps.**

- Guard call order in the route adapters listed in tests/integration/domain-service-boundaries.test.ts is unchanged; payment reconciliation, reservations, webhooks, compensation, outbox internals, lock orders and rate-limit policies are not touched.
- Shells are composed inside each page and stay synchronous, because integration tests render page output directly. No root or dashboard loading.tsx is added: it would stream a 200 where pages currently answer with a redirect or a concealed 404.
- Navigation lists only destinations that exist. `/events/[eventId]`, `/tickets` and the email-link pages keep their URLs.

**Specification conflicts resolved for this work.**

| Conflict | Resolution |
| --- | --- |
| Three token naming schemes in Visual Design §2 | The `--ts-*` contract is the single source; status washes and warm paper are added to it |
| `#4C22AF` named both hover and pressed | Hover is `#4C22AF`; pressed is `#2A1550` |
| Control radius 9px versus button 10px | One control radius, 9px |
| `Intl.NumberFormat('en-AU')` versus `A$` in examples | The mandated formatter wins; amounts render as `$8.00` |
| UX ORG-02 six-step wizard with chosen slug versus T08 | T08's tested four steps and automatic slug stay; Team and Payments are rows of the Finish checklist |
| UX §3.2 dashboard URLs versus live routes | Live routes stay; navigation labels become Payments, Staff and Settings |
| Visual Design §13.1 component folders | Existing components/layout and components/ui locations stay; [[UI Architecture Rules]] owns them |

**Delivery ledger.** Update the status and evidence as each PR merges.

| PR | Branch | Scope | Status |
| --- | --- | --- | --- |
| 1 | codex/session-handover | This handover; previous handover archived | Open |
| 2 | codex/server-read-services | Server pages and T01–T09 route adapters call lib services; shared formatters; narrowed API-001 sweep; one auth-secret resolver; dead code removal | Planned |
| 3 | codex/design-system-shells | Tokens, fonts, UI primitives, header/footer and shells, `/societies` routes with redirects | Planned |
| 4 | codex/public-personal-screens | Home, society directory and profile, auth, account settings, personal dashboard; presentation for event detail, wallet and payment return | Planned |
| 5 | codex/organisation-screens | Organisation overview, onboarding, society settings, staff; presentation for events, orders, check-in, Stripe settings; final documentation pass | Planned |

**Findings registered rather than changed.** The six copies of the active-staff-or-legacy-owner predicate, slug and asset lookups that run before authentication, and error mapping in event, order, ticket, Connect and payment routes are recorded in [[Non-Blocking Issue Register]] when PR 2 lands. They are security- or payment-sensitive and belong to focused changes.

## Next Safe Actions

1. Deliver refactor PRs 2–5 in order. Each needs one isolated baseline and one browser campaign on its final head, with run-owned cleanup, recorded in the PR.
2. After PR 5 merges, start Package 4 ticket foundations (T10 -> T11 -> T12 -> T13) from refreshed main. Paid memberships, merchandise and T15 anonymous event details remain later packages.
3. Before activating account lifecycle, obtain independent security and migration review, provision and separately back up the notification key, and verify reliable Redis and real email acceptance.
4. Choose hosting and satisfy the release gates below. T43 still owns standalone images, immutable publication, SBOM/provenance and image-size work.

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

Use only run-owned disposable test databases with simple names ending in _test. Never reset development or real-user data. Preserve retained backups (including tmp/thunderstrux-before-p319-20260921.dump if present), failed-run recovery manifests and unrelated caches/resources until their retention or recovery decision is explicit. Local Obsidian workspace state is ignored and must not be committed. Closure anonymisation is not reversed by code rollback; pause account mutations and buyer contact/ticket delivery before rolling back to incompatible older code.
