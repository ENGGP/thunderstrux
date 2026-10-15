---
status: historical
last-reviewed: 2026-10-16
owner: engineering
related: ["[[Project Handover]]", "[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Non-Blocking Issue Register]]", "[[Project Handover 2026-10-12]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover 2026-10-15

**Archived 2026-10-16 when the session that began on 2026-10-15 at main `33e84ce` replaced it. [[Project Handover]] is the current handover; the content below is the handover as it stood at `33e84ce`, retained unchanged as dated evidence and no longer maintained. "This session" below means the session that began on 2026-10-12. The design-system re-sync completed afterwards is recorded in the current handover.**

This was the only current handover. It covers the session that began on **2026-10-12 at main `b82198d`**: the specification-alignment refactor described below. Delivery from PR #31 to PR #53, with its run IDs and qualification evidence, is retained in [[Project Handover 2026-10-12]]. Start at [[Documentation Index]]; use [[Engineering Delivery Workflow]] for delivery and [[Non-Blocking Issue Register]] for open risks.

## Current State

**Packages 1, 2 and 3 (T01–T09) are implemented and locally qualified.** Completion does not establish full MVP or hosted production readiness. See [[../MVP_READINESS_PLAN|Readiness Plan]] for dependencies and detailed evidence.

| Package | Tasks | Delivered capability | Evidence |
| --- | --- | --- | --- |
| 1. Account lifecycle | T02–T04 | Encrypted notifications, verification, recovery, private settings, email change, permanent closure | PRs #31–#33, #36–#38 |
| 2. Staff and permissions | T05–T06 | Live permissions, explicit personal/staff context, private invitations, atomic owner handover | PRs #42–#44 |
| 3. Society profiles and discovery | T07–T09 | Sanitised tenant assets, public profiles and resumable setup, anonymous directory, verified free affiliation | PRs #47–#49 |

Repository pins: Node 22.23.3, pnpm 10.34.6, Next.js 16.3.8 and Prisma client/CLI 6.19.3. The migration chain has 34 migrations, ending in 20261011020000_society_profiles; the schema has 22 models. The latest full baseline recorded before this session is T09 executable `15a1e4b` with 354 integration checks; the archived handover holds every run ID.

**Local development is activated with all 34 migrations (2026-10-12); hosted activation remains unverified.** The pre-activation archive tmp/dev-before-package3-20261012.dump (SHA-256 7977c8df5b377e4a9e03ad41fefda02d5045a1aed0b21bf21d9f6a765e192f10) and the earlier tmp/dev-before-context-refresh-20261009.dump are retained. The notification key lives in ignored .env with a separate Windows-user-only backup. [[Troubleshooting]] and [[Production Operations]] own backup and rollback procedure.

## Active Contracts

Tunnel origin configured and checked on 2026-10-13: APP_PORT=3080 maps loopback host port 3080 to unchanged container port 3000. Ignored .env uses https://thunderstrux.mistayu.com for auth/public/trusted origins and cf-connecting-ip for Cloudflare client addresses. Local readiness/login/societies return 200; callbacks use the public origin, trusted anonymous mutations reach 401 and foreign origins return 403. The live public hostname also returns 200 for readiness/login/societies and correct callbacks (tmp/tunnel-live-public-smoke.log). A public asset check reproduced Next dev's 403; allowedDevOrigins now includes only thunderstrux.mistayu.com, and JavaScript/CSS return 200 while foreign API origin stays 403 (tmp/tunnel-public-assets-smoke.log). Isolated Docker typecheck, template Compose mapping and docs/diff checks pass; all data/dependency volumes are preserved. Cloudflare service target is http://127.0.0.1:3080. No schema or business/auth code changes; preview reachability does not resolve wider production release gates.

- Canonical tenant authority is Event.organisationId for event-owned records. Live OrganisationStaff authority grants management access; OrganisationMember is join state only. Stripe remains payment truth and production fulfilment is webhook-driven.
- Verification, reset and email-change links use purpose-bound digests, explicit POST redemption and private encrypted notifications. Signup and recovery responses conceal account existence; old sessions cannot upgrade their authVersion through cookie refresh. [[Authentication and Dashboard Access]] and [[API Reference]] own the contracts.
- Closure is irreversible through the app and anonymises login and editable profile while retaining business, attendance, audit and buyer-capture records. It is not deletion of all personal information.
- Owner handover clears the legacy accountUserId pointer permanently; it is never transferred or restored. Invitation activation requires migration 20261009010000_private_staff_invites before app and workers.
- Asset rollout needs both PostgreSQL metadata and object bytes backed up. [[Society Profiles and Assets]] owns quotas, sanitisation and reference-gated delivery.
- Validation follows the risk table in [[Engineering Delivery Workflow]]: local evidence recorded in each PR, GitHub test checks not required (VALID-001), documentation-only changes use docs and diff checks only.

Authenticated tunnel follow-up (2026-10-13): the earlier anonymous PR #59 checks did not exercise a secure login cookie. Actual credential login reproduced dashboard/account/event redirects alternating with login. `proxy.ts` now chooses the secure cookie from the Auth.js public URL while preserving live account/version checks. After restarting only the app, 48 live HTTPS route checks (24 each for seeded member and organisation accounts) settle without loops, including current/legacy dashboard routes, account settings, login callbacks, society pages, tickets and event views. Anonymous protected routes reach login and a foreign-origin mutation still returns 403. Evidence: `tmp/tunnel-auth-live.log`, `tmp/tunnel-auth-anonymous.log` and `tests/integration/proxy-session-cookie.test.ts`. [[Authentication and Dashboard Access]] owns the cookie contract; [[Troubleshooting]] owns the app-only restart procedure. No data/schema/secret changes or production qualification are implied.

Executable/test commit `2863542` passes the Docker production build/typecheck, 379 integration tests and clean dependency audit in baseline `p216-d383878c7e75516f34af6eba`; full browser campaign `p216-88cc9f12bd19a3a9345f0ba0` passes 30 MFA/browser/webhook checks. Both manifests record success/cleanup, and container/network/volume inventories confirm zero run-owned resources remain. Docs/diff checks pass; subsequent changes record evidence only. Independent security review and wider hosted/provider release gates remain separate from this preview fix.

Redis client qualification (2026-10-13): [PR #52](https://github.com/ENGGP/thunderstrux/pull/52) was merged externally as `eff2184` while qualification was underway. The additional real Redis regression and Docker/manual-CI fixture wiring are in [PR #61](https://github.com/ENGGP/thunderstrux/pull/61), left open for maintainer review and merge. Source/test/fixture inputs `8231530` pass frozen Docker installation, production build/typecheck, 380 integration tests/45 files and clean audit in `p216-a888af193938da9ec374a603`; browser run `p216-52c2ade796d1a95ea4ad118a` passes 30 checks and the runner safety suite passes 30. Both test images report installed client 6.3.0. The new regression proves atomic 429 limits, TTL/Retry-After, shared connection, bounded failure, sensitive-policy 503 and recovery after interrupting only its own TCP path. All completed and interrupted/failed run resources were cleaned up and zero labeled containers/networks/volumes remain. The development dependency cache was not refreshed by this work. [[Dependency Automation]] and [[Development Workflow]] own qualification/rollout and the required isolated INTEGRATION_REDIS_URL. Next action: review PR #61; hosted activation and independent production review gates remain separate.

## Specification-Alignment Refactor (this session)

**Purpose.** Make the code match the [PRD](../THUNDERSTRUX_PRD.md), [UX Specification](../THUNDERSTRUX_UX_USER_FLOW_SPEC.md), [Database Specification](../THUNDERSTRUX_DATABASE_ARCHITECTURE_AND_SCHEMA_SPEC.md) and [Visual Design](../THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md) for everything owned by T01–T09, with the visual system applied to every existing screen. No T10+ feature is built, no schema migration is added, and domain, security and payment behaviour is unchanged.

**Maintainer decisions (2026-10-12).**

- The design system is rolled out to all existing screens. Screens owned by T10+ (event builder, orders, check-in, wallet, Stripe settings, success/cancel) receive presentation only.
- Public society pages move to `/societies` and `/societies/[orgSlug]`; `/organisations` paths redirect permanently. `/api/orgs/*` and `/dashboard/organisations` do not move.
- DM Sans and Space Grotesk load through next/font and are served by the app.
- Delivery is five phased PRs merged by the maintainer.

**Constraints the refactor keeps.**

- Guard call order in the route adapters listed in tests/integration/domain-service-boundaries.test.ts is unchanged; payment reconciliation, reservations, webhooks, compensation, outbox internals, lock orders and rate-limit policies are not touched.
- Shells are composed inside each page after its guards. No root or dashboard loading.tsx is added: it would stream a 200 where pages currently answer with a redirect or a concealed 404. Data read after the guards streams inside `<Suspense>` with a skeleton, and integration tests render pages through `renderPage` so they still see the content.
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
| 1 | codex/session-handover | This handover; previous handover archived | Merged 2026-10-12 as `9476b29` ([PR #54](https://github.com/ENGGP/thunderstrux/pull/54)). Docs and diff checks pass |
| 2 | codex/server-read-services | Server pages and T01–T09 route adapters call lib services; shared formatters; narrowed API-001 sweep; one auth-secret resolver; dead code removal | Open: [PR #55](https://github.com/ENGGP/thunderstrux/pull/55), executable `c00f66e`. Baseline `p216-29daafbc7a5f149f4053b52a` passes build/typecheck, 370 integration tests and clean audit; browser campaign `p216-98b497b67f0ea0156e4da45a` passes 30 MFA/browser/webhook checks. Cleanup complete for both |
| 3 | codex/design-system-shells | Tokens, fonts, Button/field/Card primitives, header/footer, personal and organisation shells with a server-fed context switcher, `/societies` routes with redirects, shared 404 and error pages | Open: [PR #56](https://github.com/ENGGP/thunderstrux/pull/56), executable `9f43e83`. Baseline `p216-7bf3f461a84ba8768aa25431` passes build/typecheck, 370 integration tests and clean audit; browser campaign `p216-1373b699a5bbb1ce9b0436f5` passes 30 checks. Cleanup complete for both |
| 4 | codex/public-personal-screens | Home, society directory and profile, auth, account settings, personal dashboard and joined societies on the design system, with Notice, StatusBadge, ConfirmDialog, AuthShell, EventCard and SocietyCard; presentation for event detail, wallet and payment return | Open: [PR #57](https://github.com/ENGGP/thunderstrux/pull/57), executable `7b9a509`. Baseline `p216-62ac619d9d64f23914abd430` passes build/typecheck, 370 integration tests and clean audit; browser campaign `p216-0266190e074f3b9c3aaccb17` passes 30 checks. Cleanup complete for both |
| 5 | codex/organisation-screens | Organisation overview with setup tasks, create-society step, society settings (timezone list, conflict choices, finish checklist), staff (confirmations, invitation history); presentation for events, orders, check-in, payments and notifications; legacy style classes removed; final documentation pass | Open: [PR #58](https://github.com/ENGGP/thunderstrux/pull/58), executable `c012753`. Baseline `p216-65b1e89f86fba4f4852da5fa` passes build/typecheck, 373 integration tests and clean audit; browser campaign `p216-8b8685e25604aa4973056306` passes 30 checks. Cleanup complete for both |

**Rebase note.** After #54 and the Renovate change #51 merged, PRs 2 to 5 were rebased onto main `f753ba9` on 2026-10-12. The revisions named in the rows above are the commits that were tested before the rebase; `git diff` between each tested commit and its rebased equivalent contains only the four `.github/workflows` files changed by #51, so the recorded runs still cover the PR heads.

**Findings registered rather than changed.** PR 2 records the six copies of the active-staff-or-legacy-owner predicate (AUTHZ-001), four cursor implementations (PAG-001) and the remaining manual error mapping in event, order, ticket, Connect and payment routes (API-001) in [[Non-Blocking Issue Register]]. They are security- or payment-sensitive and belong to focused changes. PR 2 also fixes DEF-023: one `AUTH_SECRET` resolver for auth.ts and proxy.ts, and legacy `/dashboard/[orgSlug]` links that check live permissions.

**Claude Design sync (2026-10-13).** The eight `components/ui/` primitives are published to the claude.ai/design project "Thunderstrux UI" (project ID 6075c42a-6f43-4f56-8d3c-6554004a550a). Sync inputs live in `.design-sync/` (config, previews, conventions, `build-css.mjs`); `.design-sync/NOTES.md` holds the repo quirks and re-sync risks. It does not touch application code, and only the visual design spec from `docs/` is uploaded. Re-sync after changing `components/ui/*` or the `--ts-*` tokens in `app/globals.css`, and re-check `.design-sync/conventions.md` names.

## UX Redesign (from 2026-10-14)

The maintainer approved a Claude Design redesign (canvas "Thunderstrux redesign": rounds 1 and 2 plus a status colour system) and its plan: four PRs with no URL, permission, guard or API changes, skeletons only after guards (never a root or dashboard `loading.tsx`), and sold/remaining as the only new events data.

- **PR1** (`codex/redesign-foundations`, PR #63): society sidebar regrouped (Overview, Events, Orders; Settings: Society profile, Staff, Payments, Email delivery), `Workspace` switcher label, one `h1` per dashboard page, status colour tokens with redesigned `Notice` and `StatusBadge`, and a dismissible verify-email banner that never changes verification. [[UI Architecture Rules]] records the current rules.
- **PR2** (`codex/redesign-events-workspace`): events list rebuilt on the server (views with counts, title search, sold and left, Publish, Edit and a More menu with confirmed Unpublish and Delete), event workspace header and tabs on Summary, Attendees, Edit and the event's Orders, the Overview `Finish setting up` checklist with linked events and orders, and Suspense skeletons. `listOrganisationEventLinks` and `components/events/events-list.tsx` are gone.
- **PR3** (`codex/redesign-organiser-screens`): organiser screens. The society shell owns the page container; orders list (status tabs, event filter, one table, pending rows unlinked), order detail (summary, manage card, confirmed refund record), attendees, event form, Payments (status badge, confirmed disconnect, skeleton), Email delivery, Staff and handover, and Society profile notices.
- **PR4** (`codex/redesign-member-public-screens`): member, public and sign-in screens. Account settings (section links, signed-in summary, authenticator row only for eligible people), member overview (profile prompt instead of an inline form), My tickets (cards, short references, skeleton), the event buy box (one choice, one quantity, `Buy tickets`, verify prompt), signup order, staff authenticator setup, notices across the sign-in and account forms, skeletons for home and the public loading states. `scripts/staging-driver.mjs` now uses a verified buyer and the new button name.
- **PR5** (`codex/redesign-specs-and-design-sync`): `THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC.md` section 16 and `THUNDERSTRUX_UX_USER_FLOW_SPEC.md` section 24 record the implemented redesign and its deviations (status colours, navigation, components, feedback and loading rules, event workspace tabs); part of T34's navigation landed early. `.design-sync/` inputs now cover `Skeleton`, `ListSkeleton`, `Icon` and the `Notice` action slot.
- **Next:** the maintainer runs `/design-sync` to push the updated primitives and the visual spec to the "Thunderstrux UI" design-system project; the sync tool runs only inside that user-started skill.
- Defects found during the audit and kept out of the redesign are EVT-001, EVT-002, EVT-003, PUB-001 and ORD-001 in [[Non-Blocking Issue Register]].

## Next Safe Actions

1. Merge the remaining refactor PRs in order: #55, #56, #57, #58. They are stacked, so each PR's diff shrinks to its own commits once the one before it merges. Each carries one isolated baseline and one browser campaign on its final head with run-owned cleanup. If a PR is squash-merged, rebase the next branch onto main before merging it.
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
