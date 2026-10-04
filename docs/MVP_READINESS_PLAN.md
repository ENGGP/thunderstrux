# Thunderstrux PRD-Complete Technical Implementation Plan

Status: implementation queue, not feature acceptance or release approval. Assessed 2026-10-04 against b2ef999bd4ef266d0150917cf8c0ba76eb11e161 (main after PR #25).

## 1. Objective and execution protocol

Take the current codebase to the maximum [PRD](THUNDERSTRUX_PRD.md)-complete state that can be implemented and verified before hosting for real-user MVP testing. This replaces the previous ticketing-only readiness roadmap. Memberships, merchandise, branding, free ticketing, guest purchases, analytics and OpenClaw are pre-hosting work. The organisation calendar is an explicitly requested extension, not an explicit PRD feature.

The PRD owns product requirements. Current code/schema/configuration own implementation facts. Documentation and historical test counts do not override either. Initial defaults are Australia/AUD, controlled Stripe test-mode testing, and founder-supported pilot sessions; these do not approve real payments or narrow the PRD. Guest ticket/merchandise purchase is included even though the PRD makes guest checkout conditional. Fixed-term memberships and pickup-only merchandise are the smallest complete implementations chosen here; subscriptions, carrier shipping, QR scanning and recurring event automation are not required by this PRD.

### Inspection evidence

Read the complete PRD, previous MVP plan, relevant Second Brain references and current implementations: Prisma schema/26 migrations, auth.ts, proxy.ts, staff/access/permission helpers, account and organisation routes, event lifecycle/public services, reservations, checkout/reconciliation/refunds, ticket email/outbox, attendance, order history, member/organisation dashboards, browser/integration fixtures, Docker/Compose, package scripts and CI.

Relevant references:

- [Documentation Index](obsidian/Documentation%20Index.md), [Current Handover](obsidian/Current%20Handover.md), [Engineering Delivery Workflow](obsidian/Engineering%20Delivery%20Workflow.md), [Issue Register](obsidian/Non-Blocking%20Issue%20Register.md).
- [Codebase Map](obsidian/Thunderstrux%20Codebase%20Map.md), [Architecture](obsidian/Architecture%20Overview.md), [Database and Multi Tenancy](obsidian/Database%20and%20Multi%20Tenancy.md), [Authentication](obsidian/Authentication%20and%20Dashboard%20Access.md), [Event Lifecycle](obsidian/Event%20Lifecycle.md).
- [Stripe Payments](obsidian/Stripe%20Payments%20and%20Connect.md), [Payment Lifecycle](obsidian/Payment%20Lifecycle.md), [Email Delivery](obsidian/Email%20Delivery%20Implementation.md), [UI Rules](obsidian/UI%20Architecture%20Rules.md).
- [Development Workflow](obsidian/Development%20Workflow.md), [E2E and Staging Payments](obsidian/E2E%20and%20Staging%20Payments.md), [Production Operations](obsidian/Production%20Operations.md), [Docker Assessment](obsidian/Docker%20Architecture%20Assessment%202026-09-29.md).

Verified documentation discrepancies: proxy.ts currently redirects anonymous event-detail pages to login; attendance routes use tickets:check_in and write actor audits; staff capabilities come from rolePermissions, not a stored arbitrary per-user permission array. Fix affected living references in their implementation PRs. No hosted/provider state was audited for this assessment.

### Responding to “Continue with the next incomplete step”

1. Read this plan, Current Handover and delivery workflow. Refresh origin/main and inspect the current task implementation; preceding PRs may have superseded this baseline.
2. Select the lowest-numbered unchecked T task with completed dependencies; where ordered substeps are specified, execute its next dependency-ready unchecked substep. Never rebuild code that now satisfies it: verify its acceptance tests and record evidence instead. If blocked, record the exact missing input and select another dependency-ready task.
3. Follow Engineering Delivery Workflow in the primary repository folder: switch to main, fetch/prune origin, fast-forward main to origin/main, then create codex/<task-description> from that updated main. Preserve unrelated changes; resolve any unsafe switch/update with the user rather than discarding work. Write an acceptance note: outcome, exclusions, risk, tests, migration/rollback compatibility and external evidence.
4. One numbered task is a focused PR target. If necessary, split a large task into ordered a/b substeps with separate definitions of done before coding. The parent stays incomplete until all substeps pass.
5. Check a task only after its definition of done and latest-head checks pass. Append evidence: date, PR/merge, tested executable revision, migration IDs, test commands/results, limitations and retained resources. Update relevant living references/issue statuses; material current state goes in Current Handover, not a new handover.

**Evidence ledger:** Checked tasks below link their implementation and verification evidence. Unchecked tasks remain required work. Baseline/tooling acceptance does not establish acceptance of new product features; add completion entries as each task is delivered.

### Inherited delivery and testing requirements

Every task inherits sections 3–4 contracts. Schema, auth, tenancy, payments, workers, dependencies and operations are High risk; ordinary UI/query logic is Standard; documentation alone is Low. Follow the risk matrix in Engineering Delivery Workflow rather than inventing a parallel process.

- Always run focused regression/direct verification, git diff --check, and pnpm docs:check when documentation changes.
- Standard: denial cases, typecheck, production build, affected integration/browser coverage.
- High: applicable full integration/E2E, concurrency/idempotency/failure, migration/integrity/backup/restore, audit, provider campaign or operations rehearsal.
- Development is Docker-first. Integration resets only disposable databases whose names contain _test. Test containers/networks/ports/volumes must be run-owned. Never wipe development volumes or blanket-delete tmp/backups.
- Existing entrypoints: pnpm typecheck, pnpm build, pnpm test:integration, pnpm test:e2e, pnpm test:e2e:guards, pnpm security:audit, pnpm ops:test, pnpm db:integrity:audit and pnpm db:organisation-drift:repair. Run builds in disposable images/environments, never inside an active next start container.
- Deliver through protected-main PRs. Require static-validation, integration-tests, production-build, e2e-tests and operations-tests on the latest head. Cleanup task-owned runs before merge; preserve interrupted-run recovery manifests. Independent review is required before high-risk production activation.

## 2. PRD-to-codebase gap analysis

**COMPLETE** means a capability exists with concrete test evidence; affected regressions still run. **PARTIAL** means the listed remainder needs implementation. **MISSING** means no end-to-end capability was found. **NEEDS VERIFICATION** means fresh checks are needed, not that a defect is assumed. **REQUIRES HOSTED/STAGING ENVIRONMENT** describes actual environment-dependent evidence. A real provider test runnable locally is not automatically a hosted dependency.

The requirement-level matrix in section 8 supplies the finer classification. This initial analysis identifies current evidence and exact gaps before the implementation queue.

| Capability | Current status | Evidence and exact remainder |
| --- | --- | --- |
| Credentials signup/login/logout and account types | COMPLETE | auth.ts, signup validator/route and real Auth.js/browser tests; preserve bcrypt and member/organisation roles. |
| Verification, recovery, account security settings | MISSING | No verification/reset/auth-version fields or flows. Add single-use tokens, transactional emails and session revocation. |
| Member onboarding | PARTIAL | PATCH /api/me/profile and member form exist; finish editable settings, live completion state and verification gating. |
| Organisation onboarding | PARTIAL | POST /api/orgs creates one tenant and active owner staff; profile/branding/readiness wizard missing. |
| Named staff, MFA, revocation | PARTIAL | Staff/invite/MFA models, live guards and denial tests exist; invitation token UI, acceptance race protection and complete audit/handover UX remain. Actual staff enrollment is hosted activation. |
| Tenant/origin/CSRF/rate controls | COMPLETE | Event.organisationId authority, session CSRF, trusted-origin, Redis and denial tests exist. Extend them to all new surfaces; AUD-001/API-001 remain open. |
| Public society identity and private settings | PARTIAL | Profile shows name/slug/events; Organisation lacks description, branding, support/refund context. |
| Organisation discovery/join/leave | PARTIAL | Authenticated member search and idempotent joins exist; public discovery and clear paid-membership distinction missing. |
| Event lifecycle | PARTIAL | Draft/edit/publish/unpublish/delete service exists; create accepts published status, publish checks only ticket inventory; no capacity/visibility/sales-window policy. |
| Public discovery/detail | PARTIAL | Anonymous public APIs and cursor listing exist; proxy blocks anonymous HTML detail; API self-fetch, filters and sale-state presentation need completion. |
| Ticket types/history | PARTIAL | Multiple types, cents, remaining quantities, unitPrice/total snapshots exist; purchased names/seller/fee snapshots and locked sold edits missing. |
| Reservations and paid fulfilment | COMPLETE | 30-minute holds, serializable retries, locked inventory, signed webhook, atomic tickets/outbox and replay tests. Extend capacity, locked quotes and uncertain Session creation; don't replace reconciler. |
| Free acquisition | MISSING | Validators allow zero price; checkout rejects total <= 0 and requires Stripe. |
| Guest checkout/private access | MISSING | Checkout requires member; nullable Order.userId is not guest authentication. |
| Orders and buyer history | PARTIAL | Scoped organiser orders/lifecycle and paid wallet exist; buyer pending/recovery/refund states and commerce purchases absent. |
| Connect, destination charges, platform fee | PARTIAL | Lifecycle and 10% fee helper exist; payout distinction, disclosures, safe disconnect/account history correlation remain. |
| Replay/compensation/email lease fencing | COMPLETE | Existing reconciliation, compensation, outbox and lifecycle suites. PAY-001/TEST-001 direct regressions and new real campaign remain. |
| Refunds of fulfilled purchases | PARTIAL | Local manual marker is bookkeeping; compensation refunds cover unfulfilled paid orders only. Add provider-verified ordinary refunds/validity changes. |
| Tickets/check-in/check-out | PARTIAL | Cursor list, conditional attendance and actor audit exist; void/refund-review validity, guest access, search and uncertain retry UX remain. QR optional. |
| Paid memberships | MISSING | OrganisationMember is join state only; no products, paid terms, renewal/expiry or entitlements. |
| Merchandise | MISSING | No catalogue, variants, stock holds, purchase or collection workflow. |
| Email/notifications | PARTIAL | Fenced ticket outbox/Resend/resend/requeue exist; auth/invite/membership/merch/refund/change notifications missing. |
| Dashboards/calendar | PARTIAL / MISSING | Basic member and society summaries exist; full navigation/purchases/settings/commerce/AI missing; calendar absent. |
| Analytics | PARTIAL | Paid ticket group aggregates and UTC series exist; some series/monthly dashboard load orders in memory. Refund/free/attendance/member/merch metrics absent. |
| OpenClaw | MISSING | No action registry, assistant, model adapter, confirmation or execution receipt. |
| Audit/history | PARTIAL | Append-only OrderLifecycleEvent and sensitive audits exist; AUD-001 incomplete; historical names/terms/catalogue facts absent. |
| Accessibility/mobile/usability | NEEDS VERIFICATION | Mobile/overflow tests exist; full keyboard, forms, screen-reader, contrast and new journeys unverified. |
| Local Docker/testing | COMPLETE | Isolated runners, _test guards, schema checks, Docker dev and five CI jobs exist. Extend fixtures/cleanup for new features. |
| Repository operations/recovery | PARTIAL | Non-root hardened runtime, migrations, readiness, workers, backup/restore exist; immutable release split/publication and new worker/alert/recovery coverage remain. |
| Actual ingress, schedules, monitoring, encrypted recovery, payouts | REQUIRES HOSTED/STAGING ENVIRONMENT | OPS/SEC/PAY external gates require activated environment evidence; their code/runbooks are pre-hosting work. |

## 3. Shared implementation contracts

### 3.1 Ownership, services, APIs and retention

Route adapters keep input/transport, trusted origin/CSRF, authentication, live staff/MFA/capability, tenant and rate checks. Application services own domain transactions/recovery/provider composition. Event.organisationId remains canonical for ticket-owned orders/tickets/reservations. New membership/merchandise records derive their tenant through Organisation/product relations; every referenced line/grant/asset must match that owner. OrganisationMember or paid membership never grants staff authority.

Keep accountRole member/organisation; named member staff can manage through an explicit staff context and return to personal views. A selected society, header, JWT role, browser price, email or AI argument is input, never independent authority.

New interfaces use selected DTOs, integer AUD cents, UTC ISO timestamps, stable cursor ordering, default 25/max 100 list bounds, strict schemas, safe field errors and typed results. Preserve tested existing guard ordering. Use 401 no identity, 403 no broad capability, concealed identical 404 missing/foreign target, 409 stale/conflicting transition, 400 validation, 429 Retry-After and safe 503 required dependency failure. Server pages call shared read services, not private API self-fetch. Apply safeReturnPath and existing CSRF retry behavior.

Retain purchased snapshots and financial/attendance/history records. Archive referenced products/types/terms; do not silently recalculate history. Migrations are additive: audit legacy data, nullable expansion first, backfill known facts only with provenance, enforce new-write invariants and document rollback. Every schema PR updates readiness/schema-contract tests, reset helpers, seed and restore verification. Unknown historical names/fees/capacity stay labelled unknown.

### 3.2 Ticket truth, transitions and concurrency

**Authority:** Stripe owns external charges/refunds/transfers/payout state. Order/lifecycle are the local projection. Free fulfilment is a server business event, not a fabricated Stripe payment. Browser success pages and AI output never establish payment truth.

**Compatibility:** Preserve OrderStatus pending/paid/failed/expired initially. Add paymentKind=stripe|free and fulfilledAt. For free orders existing paid means fulfilled compatibility; paidAt stores local completion to satisfy the existing constraint, while every DTO/UI/metric distinguishes Free using paymentKind. New financial queries must not infer cash revenue from paidAt/status alone.

**Inventory:** TicketType.quantity stays remaining inventory. Active holds reduce sellable quantity without decrementing stock. Fulfilment decrements exactly once. Optional Event.capacity is a separate ceiling, not the sum of remaining quantities. Occupancy = valid issued tickets + active unexpired holds. Sellable = max(0, min(type remaining - type holds, capacity - occupancy)); omit the second limit when capacity is unknown/unset.

**Lock order:** Event, TicketType IDs sorted, Order, then reservation/refund/outbox/history rows. Apply consistently to checkout, fulfilment, edits, refund and cleanup paths that share these resources. Candidate discovery may precede a transaction; mutation revalidates after locks. Use existing bounded serializable conflict retries, never suppress unrelated errors. Reload price/name/state/window/entitlement under lock and snapshot there. Changed browser quote returns 409 and requires review.

**Paid creation:** Transaction creates pending order/snapshots, active 30-minute hold, durable operation record and lifecycle. Stripe creation is outside the DB transaction with a stable operation key. A second fenced transaction attaches its Session. Provider timeout or success-before-DB-attachment becomes uncertain, not a blind new checkout or ordinary failure. Recover the original Session by stable key/verified bounded lookup; never replace a different existing binding.

**Paid webhook:** Verify raw-body signature, exact order/Session/owner/currency/amount/metadata/provider destination/payment status. Under inventory/order locks revalidate hold and stock/capacity. Atomically mark fulfilment, confirm hold, decrement once, create unique ticket units, append lifecycle and insert automatic ticket outbox. Outbox insertion failure rolls back local fulfilment; provider email failure later does not. Exceptions before commit remain retryable non-2xx. Signed unhandled types return 200.

**Failure/replay:** Already fulfilled replay has zero business effects. Signed paid but unfulfillable becomes durable compensation review with no tickets/receipt and actual reservation result. Late paid after expiry/release uses compensation. Existing safe natural recovery is blocked after refund processing starts. Expiry only affects pending orders/active holds, never paid/terminal state.

**Free:** One synchronous inventory-locked transaction completes local order/tickets/history/outbox with no Stripe and no persistent abandoned reservation. Request idempotency applies equally.

**History:** Snapshot ticket name, unit price, seller identity, buyer, currency, total, fee/policy and purchased entitlement policy. Live event date/location remains separately editable/audited with attendee-change notices. Preserve all historical check-in facts after refund.

### 3.3 Commerce, memberships, merchandise and refunds

Keep proven ticket Order/TicketReservation relations. Add CommerceOrder/CommerceOrderLine for membership|merchandise; one organisation and one kind per order, no mixed cart. Reuse provider/security/retry/lease/idempotency primitives through domain adapters, not copied divergent reconciler code or a risky whole-ticket-schema rewrite.

CommerceOrder stores member or verified guest identity (merch only), buyer/seller snapshots, currency/totals/fees, paymentKind, pending/paid/failed/expired projection, fulfilledAt, provider identity and compensation/refund state. Lines store positive quantity, price/total/name/variant/product snapshots and membership terms. Provider Sessions/operation keys are unique; typed domain dispatch rejects conflicting metadata/session identities. CommerceLifecycleEvent has unique per-order sequence and safe facts.

Membership is a one-off fixed-term product, not a subscription. Product defines startsAt/endsAt/price/versioned entitlements. Grant binds verified member, society and fulfilled line; unique purchase/term and locked member+society checks prevent duplicates/disallowed overlap. Effective upcoming/active/expired/revoked derives from [start,end) UTC and revokedAt, independent of scheduled email timing. Renewal buys the next non-overlapping term. Leaving a free join doesn't erase a paid grant. Confirmed full refund revokes its grant. Member-price/access checks are server-side; hold-time grant/policy/price is snapshotted.

Merchandise products have publication/archive state, safe images and variants with remaining stock and optional size/colour. Cart maximum 10 lines/10 units per line, one society, duplicate variants merged. Holds last 30 minutes; lock all variants sorted, then order. Commit all line decrements/hold confirmations/order history/receipt together on verified fulfilment. Pickup-only: location/instructions disclosed before payment; ready/collected states are separate from finance.

RefundRequest links one ticket or commerce purchase, provider identity, amount/currency, actor/reason, operation key, processing lease and history. Initiate full whole-order refunds only in this increment. External partial refunds are projected accurately and flagged for reviewed resolution, not automatically treated as full. Disputes create a distinct review/validity hold. Ordinary refund and compensation share a purchase-level financial fence.

Provider refund calls occur outside DB transactions with stable keys; uncertain outcomes are polled before retry. Confirmed full refund atomically projects provider truth, voids ticket validity/revokes grant or marks commerce refund, and queues notification. Do not erase attendance. Do not auto-restock merchandise or reopen tickets: an audited return/stock-adjustment action can apply reviewed quantities once, under holds/capacity checks. Collected goods may not have returned.

### 3.4 Guest, email and controlled actions

Guests browse and buy public/unlisted tickets and merchandise; paid memberships require a verified member. Verify email ownership before checkout hold creation. A typed email alone doesn't grant previous-order access. Purpose-bound expiring tokens are hashed in storage; raw-token delivery payloads must be encrypted at rest and never logged. Redeem via POST into HttpOnly Secure/SameSite access sessions and clean redirects; GET/prefetch doesn't consume tokens. Guest grants are purchase-scoped; Session/order IDs alone reveal nothing.

Keep existing ticket EmailOutbox and automatic-order partial unique index. Add NotificationOutbox for non-ticket triggers rather than breaking its required order relation. Both use tested provider/lease helpers. Business transaction inserts intent; provider I/O follows commit. Unique event+recipient+templateVersion dedupes; manual resend uses a new audited operation. Rotating lease tokens fence stale workers; bounded retries end in visible failed state. Provider acceptance is not proof of inbox delivery.

AI proposes typed actions only. Registry maps actor, tenant, strict schema, live permission/MFA, preview and normal application-service execution. Model never executes SQL/code/arbitrary URL tools/secret reads/Stripe calls. Every mutation requires explicit confirmation bound to actor/tenant/action/normalized arguments/state version/expiry, and reauthorization at execution. Refunds, staff/owner authority, Stripe disconnect, deletion and paid-state mutation stay human workflow links, not autonomous tools.

## 4. Dependency-ordered pre-hosting tasks

Every T task is required before claiming the candidate feature-complete. Credentials may block verification but do not defer implementable code. Shared contracts above cover recurring security/transactions/API conventions; task-specific differences below override only where stated.

### Foundation and identity

#### T01 — Verify baseline and safe developer workflow
- [x] Complete. **Dependencies:** none. Evidence: T01 ledger below and [PR #28](https://github.com/ENGGP/thunderstrux/pull/28); merge only its latest green head.
- **Current/goal:** Docker runners, guards and CI already exist; establish fresh evidence, don't rebuild them.
- **Code:** Verify package scripts, docker-compose.dev.yml, run-integration-tests/run-e2e/operations runners, tests/helpers/test-data.ts and db-reset.ts. Inventory routes/tests/issues. Extend fixtures/reset/cleanup as each later schema lands; keep synthetic seed and public reads separate.
- **Tests/definition of done:** Isolated full integration/E2E/operations, typecheck/build/audit/docs pass with actual counts/revisions; non-_test refusal, occupied-port and run-owned cleanup checks pass. No development reset, real user data or cache files committed.

**T01 implementation/evidence ledger — 2026-10-04 (implemented and qualified):**

- Acceptance: verify the current baseline and fix confirmed test-tooling gaps; preserve product routes/services/schema, provider business logic and unrelated work. Branch `codex/t01-baseline-verification` starts at refreshed main `598f922`. Test reset tooling is High risk; no runtime rollout or database migration is needed.
- Shared integration URL validation requires PostgreSQL, one simple database name ending in `_test`, and refuses malformed paths before reset/truncate. Existing variable precedence and E2E's stricter exact target remain intact. Runner regressions cover unsafe suffixes, paths, malformed inputs, secret-safe errors and actual occupied-port refusal before resources are created.
- A new integration regression seeds every current Prisma model, including MFA, email, compensation and unlinked refund records, checks reset removes all rows, and repeats reset. It passed for all 18 models; existing CASCADE behavior is retained.
- Pre-test inventory: development app/db/Redis containers `22a775b9a8a4`, `eea5ff5f14b2`, `e745fe68dac1`; development liveness HTTP 200. Database/Redis/dependency volumes and the unrelated `personal_website_postgres_data` volume must survive. Docker 29.8.0/Compose 5.5.1; host Node 22.18.0 is orchestration only, qualified application/tests use pinned Node 22.23.3 and pnpm 10.34.5.
- Primary-folder documentation check is affected by the pre-existing deleted tracked remediation plan and untracked `docs/cache/`. Preserve both; validate intended tracked documentation in a temporary snapshot and CI, and record this workspace limitation without weakening the checker.
- Unchanged baseline at `598f922`: run `p216-b6cc47e799b8879fd9db34b8` passed 247 integration tests. Revised integration/reset content at `2c17aee`: run `p216-ffdce4baee62a6b0c3b52ae0` passed 249 tests in 30 files, typecheck, production build and dependency audit (no known vulnerabilities). Both passed cleanup. All 30 runner regressions passed again under pinned Node on final executable revision `f5cab84`.
- Operations run `p217-ci-089550e84f` passed its functional rehearsal but final inventory found three created workers left behind. DEF-014 fixes profile-aware cleanup and adds a real zero-resource assertion to the rehearsal; final run `p217-ci-86f2620c60` exited successfully after deploy, hardening, worker execution, backup/restore, dependency recovery, rollback, migration-failure blocking and verified cleanup. The previous three owned containers were verified and removed individually. Five operations guard tests passed.
- Both pinned Hadolint checks passed; the production image scan returned zero fixable HIGH/CRITICAL findings with CI-equivalent Trivy flags. The tracked documentation snapshot passed (30 files). The deliberate second-pass review found no route/service/schema/lockfile or production activation changes; no migration or data rollback is needed for this tooling-only change.
- Final E2E/CI and cleanup qualification is recorded below. Earlier runs on `2c17aee` are not counted after the cleanup change. Synthetic checks do not claim actual Stripe/email/hosted acceptance.

Final executable qualification revision: `f5cab84` ([PR #28](https://github.com/ENGGP/thunderstrux/pull/28)). Three consecutive complete local E2E runs passed unchanged executable/test/configuration content, each with 2 enforced-MFA, 9 desktop/mobile and 6 signed-webhook tests, no failures/skips/timeouts/interruption:

1. `p216-81080d656b7694702add8430`
2. `p216-4d2a0877049b0abecb29b8ea`
3. `p216-b99dba70aec488754956db2b`

Each manifest records `passed=true` and `cleanupComplete=true`. Explicit repeated cleanup succeeded for all eight task-owned baseline/E2E runs. Final Docker inspection exactly matched the initial three development container IDs, four volumes and four networks; development liveness remained HTTP 200. The operations run's zero-resource assertion passed. Manifests/reports remain ignored local evidence; unrelated user files and backup archives are preserved.

CI E2E qualification on `f5cab84` passed [attempt 1](https://github.com/ENGGP/thunderstrux/actions/runs/37188274919/attempts/1), [attempt 2](https://github.com/ENGGP/thunderstrux/actions/runs/37188274919/attempts/2) and [attempt 3](https://github.com/ENGGP/thunderstrux/actions/runs/37188274919/attempts/3). [Static validation, integration and production build](https://github.com/ENGGP/thunderstrux/actions/runs/37188274958) and [operations validation](https://github.com/ENGGP/thunderstrux/actions/runs/37188274918) also passed. The final evidence-only commit requires fresh [all five PR checks](https://github.com/ENGGP/thunderstrux/pull/28/checks) before merge; it does not restart executable qualification. After merge and refresh of main, continue with T02.

| Existing capability | Regression evidence required for T01 | Known remainder stays in later tasks |
| --- | --- | --- |
| Auth/onboarding/account contexts | auth-access, dependency-security, member-features; real browser login/signup/callbacks | Verification/reset/settings and full context UX: T03–T05 |
| Staff/MFA/live permissions | staff-mfa, management-page-access, organisation-tenancy; enforced MFA/browser revocation | Invitation/handover improvements: T06 |
| Events/public discovery | event-lifecycle, public-safe-pages, pagination-cursor; browser/mobile | Anonymous detail, publication/capacity policy: T11–T15 |
| Checkout/inventory | checkout-reservations, pending-cleanup, database-constraints | Free/guest/uncertain creation: T12–T16 |
| Payment fulfilment/history | webhook-reconciliation, payment-lifecycle, signed HTTP webhook E2E | PAY-001/TEST-001 and ordinary refunds: T18 |
| Connect/disclosure | stripe-connect-service, organisation-connect-disclosure, Connect HTTP webhook | Fee/payout/disconnect improvements: T17 |
| Tickets/check-in/order views | ticket-check-in, orders-api, dashboard-orders-page, buyer/browser history | Guest/validity/full history UX: T19 |
| Email/compensation/fencing | email-outbox, compensation-refunds, lifecycle tests | General notifications/commerce: T02, T20–T30 |
| Origins/CSRF/rate/error controls | trusted-origin-guard, client-csrf-retry, rate-limit, api-error-mapper; real Redis in isolated E2E/operations | Remaining survey: T39 |
| Docker/schema/recovery | all runner tests, schema contract, isolated operations deployment/restore/rollback | Immutable release and hosted activation: T41–T46, H01–H06 |


#### T02 — General notification outbox and templates
- [x] Complete. **Dependencies:** T01. Implementation/browser qualification passed; final evidence-head CI is required before merge.
- **Current:** Ticket outbox/Resend/fencing exists; auth/commerce notifications absent.
- **Schema/backend:** NotificationOutbox with optional tenant/user, unique eventKey+recipient+templateVersion, validated/encrypted payload, status/attempts/due time/lease/provider acceptance/safe error; due/lease indexes. New lib/email/notification-outbox.ts, templates.ts and bounded process-notifications command; factor transport/lease utilities without changing ticket semantics.
- **Rules/UI:** Escaped HTML+text, first-party links, no secrets in diagnostics; auth jobs private from tenant operators. Failed business-job view/requeue requires live scoped permission. Expired/obsolete security-token jobs cancel.
- **Tests/done:** Atomic enqueue rollback, duplicate intent, concurrent/stale claims, provider accepted+DB failure, bounded retry/exhaustion, safe requeue/injection and Docker mail capture pass; existing ticket tests retained.

T02 acceptance (2026-10-04): PR #31 adds additive encrypted intents, immutable bounded delivery and scoped business recovery; security jobs stay private. High risk validation covers full integration/E2E/operations, failure/concurrency, migration/reset/restore, typecheck/build/audit and latest-head checks. Provision and back up the app/worker key before rollout; retain schema/key and pause the worker on rollback.

T02 verification evidence: executable revision `f4fc1ae`, [PR #31](https://github.com/ENGGP/thunderstrux/pull/31), migration `20261004010000_notification_foundation`. Baseline `p216-b62b4e22dc5f00d1f43873d2` passed 261 integration tests in 31 files, typecheck, production build and dependency audit (no known vulnerabilities); the only subsequent executable change corrected the E2E seed import. Reset proves all 19 models clear. Thirty runner regressions and the 31-file documentation check passed. Operations `p217-ci-c40438e960` passed deployment/readiness, worker startup/hardening, database notification-row restore, failed candidate rollback and migration-failure shutdown; run-owned containers/volumes were removed and its backup archive retained. Key decryption after restore and real provider/inbox delivery are not claimed.

Three complete consecutive local E2E runs on unchanged executable/test/configuration content passed, each with 2 enforced-MFA, 9 desktop/mobile and 7 signed-webhook/notification tests and successful cleanup: `p216-85a0bbf9796a07c5f09b16a0`, `p216-87f75555c2a38cee81071541`, `p216-57198ef9bc36d91246072135`. Earlier failed runs were corrected and cleaned; operations failure diagnostics and backups remain intentionally. The development database/Redis volumes remain intact. CI browser qualification passed [attempt 1](https://github.com/ENGGP/thunderstrux/actions/runs/37201794317/attempts/1), [attempt 2](https://github.com/ENGGP/thunderstrux/actions/runs/37201794317/attempts/2) and [attempt 3](https://github.com/ENGGP/thunderstrux/actions/runs/37201794317/attempts/3) on `f4fc1ae`. [Static/integration/build](https://github.com/ENGGP/thunderstrux/actions/runs/37201794314) and [operations](https://github.com/ENGGP/thunderstrux/actions/runs/37201794318) passed. Final documentation-head CI is required before merge. Independent review and hosted key/scheduling/monitoring activation remain release gates.

#### T03 — Email verification and secure signup
- [ ] Complete. **Dependencies:** T02.
- **Schema/backend:** Add User.emailVerifiedAt/authVersion/disabledAt and hashed AuthToken(purpose, user, expiry, consumedAt); lib/auth/account-lifecycle.ts and /api/auth/verification/request/confirm. Signup transaction inserts user/token/outbox. Confirmation conditionally consumes once; resend supersedes old token. Legacy users aren't silently verified.
- **UI/authority:** Verification pending/resend page. Login/profile allowed unverified; purchases/joins/tenant bootstrap/invite acceptance require live verified identity. Anonymous requests use trusted origin and fail-closed IP/email limits, generic enumeration-safe response; POST redemption and safe callback.
- **Tests/done:** Normalized duplicate/racing signup, expiry/replay/wrong purpose/resend, disabled users, outbox rollback and actual browser verification pass. Session fields aid UX; server checks remain authoritative.

#### T04 — Recovery, account settings and stale-session invalidation
- [ ] Complete. **Dependencies:** T03.
- **Code:** Password-reset request/confirm and authenticated change services; /forgot-password, /reset-password, /account/settings; auth.ts, access.ts, proxy.ts, safeReturnPath and auth forms. Profile remains private and cannot change role/staff authority.
- **Transactions/security:** Consume reset token, bcrypt update, authVersion increment, MFA-grant deletion and security notice in one transaction. No automatic login after reset; enrolled MFA remains. JWT carries login-established version; every protected service reloads user/version and rejects deleted/disabled/stale identities. Token refresh cannot upgrade a stale session.
- **Tests/done:** Generic reset requests, parallel redemption, password validation, old JWT read/mutation denial, fresh login/MFA, profile edits and safe callbacks/keyboard errors pass.

##### Accepted T04 substeps (2026-10-04)

The user expanded settings to email changes and permanent closure. Deliver these ordered substeps through separate focused PRs. T04 stays incomplete until all pass.

- **T04a - Recovery/settings:** generic reset requests, purpose-bound 30-minute tokens, current-password authenticated change, enrolled login MFA recheck, private live account/profile DTO and accessible forms. Atomically consume token, hash password, increment authVersion, remove login grants and queue security notice. Preserve MFA enrollment, invalidate every old session without refresh upgrade, and require fresh login. New passwords have at least 8 characters and at most 72 UTF-8 bytes. Acceptance includes parallel redemption, replay/expiry, stale-session reads/mutations and browser recovery/settings.
- **T04b - Email change:** authenticated request/confirm/cancel with current password and enrolled MFA. Keep the old email until a 30-minute token verifies the new address; bind token to original email/account/version and recheck address uniqueness and authority at confirmation. Notify the old address on request and both on completion. Atomically verify the new email and revoke sessions/tokens/grants; never reassign historical records by email. Acceptance includes racing changes, cancellation/replay/stale tokens, uniqueness and browser confirmation.
- **T04c - Permanent closure:** current password, enrolled MFA and acknowledgement. Block ownership until handover and pending orders/unresolved compensation/upcoming paid tickets until resolved. Fence closure against purchase/join/tenant/staff creation. Disable the retained user ID, anonymise editable profile/login credentials, revoke staff/session/grants/tokens and remove free joins atomically; notify the former email. Preserve business/attendance/audit records and necessary buyer identity with honest current-account capture provenance. No self-service reversal or attaching old records to a new signup. Acceptance includes eligibility, concurrency, revocation, retained records and browser closure.

Each substep is High risk and inherits full regression/migration/operations and latest-head checks. Lifecycle issuance is generic with enabled fail-closed Redis limits (25/IP/hour and 3/email/hour); redemption is 50/IP/10 minutes and 10/token/10 minutes; authenticated security changes are 5/user/hour. Tokens use 32 random bytes, digest-only storage, fragment delivery, explicit POST and safe callback paths. Verification expires after 24 hours. Private security events use a separate ledger because tenant audit rows require an organisation.

#### T05 — Permissions and explicit personal/staff context
- [ ] Complete. **Dependencies:** T04.
- **Code:** Extend lib/permissions/index.ts and auth/access/page-access. Add organisation:settings, members:read/manage, memberships:manage, merchandise:manage/fulfil, analytics:read, orders:refund, audit:read, openclaw:use.
- **Policy/UI:** Owner/admin management; event manager events/attendance/nonfinancial event analytics; finance financial reads/refunds/analytics; check-in staff attendance only. Personal/staff mode and selector use live authorized societies; no member bootstrap tenant. Separate profile settings from stripe:manage; nav capability-filtered but APIs independently checked.
- **Tests/done:** Every role/action, fake headers/join roles, multi-society selection, same-session revoke/downgrade, MFA and foreign concealment pass. Named member staff can return to personal tickets.

#### T06 — Staff invites and committee handover
- [ ] Complete. **Dependencies:** T02, T03, T05.
- **Current/code:** Reuse lib/staff/invites.ts, staff routes/management UI; replace raw token display with transactional invite email, /staff/invites/accept verified-user flow, revoke/resend and owner handover.
- **Concurrency:** Lock invite before conditional consumption and owning organisation before owner-count updates; two revocations can't remove last active owner. Reject expired/revoked/mismatched email; same accepted identity safely reports prior result. Resend invalidates old invite version.
- **Tests/done:** Parallel accept/final-owner revoke, expired/wrong user, resend, live authority and audit pass. Rehearse MFA enforce/legacy deny locally; no shared-password committee workflow required.

### Identity, assets and discovery

#### T07 — Safe branding/product image assets
- [ ] Complete. **Dependencies:** T05.
- **Schema/API:** Asset(owner/uploader/key/type/bytes/dimensions/hash/state); lib/assets storage interface with local Docker object-store and configured hosted adapter; scoped asset POST/delete. Ready same-tenant assets only.
- **Rules:** JPEG/PNG/WebP, <=5 MB input, <=4096x4096 dimensions, decode/re-encode/strip metadata; reject SVG/HTML/polyglots/traversal/decompression bombs and arbitrary remote fetch. Opaque object keys; fail-closed upload limits/quotas, MFA+management permission. Delete only unreferenced assets; delayed orphan GC.
- **Tests/done:** Malicious content, tenant association/deletion, interrupted upload, object loss, persistence and cleanup pass. Public delivery safe content/cache headers; credentials server-only; local adapter works before hosting.

#### T08 — Editable society profiles and onboarding
- [ ] Complete. **Dependencies:** T06, T07.
- **Schema:** Organisation description<=5000, logo/cover Asset refs, public support/contact email, refund/pickup policy, IANA timezone default Australia/Brisbane, onboardingCompletedAt/profileVersion.
- **Backend/UI:** Extract bootstrap/profile services into lib/organisations; scoped PATCH /api/orgs/[orgSlug]/profile and public DTO. Profile/settings wizard, public branding/description/events and later membership/merch tabs. Slug stable; completion requires name/description/contact; paid-sale readiness separate.
- **Authority/rules:** organisation:settings, optimistic version conflicts, escaped content and owner asset validation. Existing one primary tenant/active named owner bootstrap remains atomic and audited.
- **Tests/done:** Bootstrap/slug races, second tenant denial, stale edit, member denial/public leakage and branded/empty/mobile/keyboard profile flows pass.

#### T09 — Society discovery, profile and join relationships
- [ ] Complete. **Dependencies:** T03, T08.
- **Code/API:** Bounded lib/organisations/public-organisations, /api/public/organisations/search; extend existing org search/join/leave, organisation-search/member-organisations-list and profile settings.
- **Rules:** Anonymous public-safe society search; verified member joins only OrganisationMember. Leave deletes only caller relationship; paid grants remain. Joined badge != paid active membership; no staff authority or private roster exposure. Bounded q and cursor searches.
- **Tests/done:** Anonymous search/escaped inputs, join/leave concurrency/replay, no cross-user deletion, fresh onboarding state and later paid-grant survival pass.

### Event and ticket completion

#### T10 — Purchase snapshots and ticket validity
- [ ] Complete. **Dependencies:** T05, T08.
- **Schema:** Nullable purchasedTicketTypeName/sellerName/buyerEmail/name/currency/feeAmount/feePolicyVersion/paymentKind/fulfilledAt/snapshotVersion on Order; Ticket validity active|void|refund_review/reason/time. Add unique new issue units (orderId, issueSequence) after audited legacy backfill.
- **Code/UI:** Checkout/reconciliation, grouped-orders/order-detail, ticket-delivery, wallet/attendance/timeline use snapshots. Old unknown name shows current label plus Historical label unavailable, never fabricated snapshot. Live schedule separate from purchase facts.
- **Tests/done:** Rename/reprice/fee rounding/new free classification/legacy rendering, invalid ticket filtering, integrity and expanded-schema compatibility pass across organiser/member/email views.

#### T11 — Common publication/readiness and event policy
- [ ] Complete. **Dependencies:** T10.
- **Schema/API:** Event.capacity nullable positive, visibility public|unlisted|members_only, salesCloseAt default startTime, saleState open|closed, version. Shared lib/events/event-readiness used by create/edit/publish/public/checkout.
- **Rules/UI:** Always create draft; explicit target-status/version publish replaces replay-unsafe toggle. Require details/times/types/future sales/stock; paid types require charge readiness, free-only doesn't. Mixed event can offer free types while paid unavailable. Close sales independently of unpublish; existing order-backed delete/unpublish restrictions retained. Block members_only publication until T24 exists.
- **Tests/done:** Direct published-create bypass, missing tickets/details, past/closed/free/mixed/not-ready, protected edits and capacity below commitments pass with clear blocker messages; no fake capacity backfill.

#### T12 — Inventory/capacity locks and sold-edit safety
- [ ] Complete. **Dependencies:** T11.
- **Code:** Apply section 3.2 lock hierarchy consistently in event-lifecycle, reservations, checkout-creation, checkout-reconciliation and stale-orders. Reload locked price/name/window/owner/policy; return quote-version conflict before reserving changed amount.
- **Rules:** Quantity remains remaining stock; edits cannot shrink below holds or capacity below issued+holds. Used types can't delete; event owner immutable. Hold predicate active and expiresAt > DB time. Fulfilment validates event ceiling and type quantity once.
- **Tests/done:** Two types compete for final seat; edit/reprice/close/refund/expiry versus checkout/webhook; sorted locks/bounded conflict retry; no oversell/negative quantity. Existing replay/cleanup suites remain green.

#### T13 — Provider-free ticket acquisition
- [ ] Complete. **Dependencies:** T12.
- **Backend:** lib/payments/free-ticket-issuance, existing checkout adapter dispatches by locked price. Verified member initially; stable request key, maximum 10 units/request. Atomically free Order/snapshots, stock decrement, unique tickets, history/outbox; no Stripe or long-lived hold.
- **UI/API:** Typed free fulfilled receipt response versus existing paid redirect URL compatibility; Get free tickets, Free receipt/wallet/metrics. Zero total never calls fee helper requiring positive cents.
- **Tests/done:** Replay/content-mismatch/last-seat concurrency, no configured keys/provider calls, members-only denial, enqueue rollback/provider-email failure pass; free acquisition doesn't inflate revenue.

#### T14 — Idempotent paid creation and uncertain Session recovery
- [ ] Complete. **Dependencies:** T12.
- **Schema/backend:** CheckoutAttempt unique actor-or-guest+operation+key with canonical payload hash/order/session/state/due time. Same key+payload returns same result; different payload 409. Existing checkout creation uses stable provider key; bounded recovery command in scripts and operations profiles.
- **Rules:** Timeout after provider success remains uncertain with hold pending reconciliation/expiry; recover original Session by stable key/verified lookup. No blind new order/charge, ordinary failure of unknown outcome or replacing Session binding. Handle webhook-before-attachment/response safely.
- **Tests/done:** Double click, lost response, DB attachment failure, worker crash, late/early webhook and expiry during recovery produce one purchase and actionable terminal/compensation state.

#### T15 — Anonymous public pages and honest availability
- [ ] Complete. **Dependencies:** T09, T11, T13, T14.
- **Code/UI:** proxy permits anonymous event details, dashboard stays protected; remove accountRole-only public redirect so authorised manager can inspect public preview. Public page calls public-events service directly. Add bounded q/date/society filters, organiser link and per-type sale status/quote.
- **Rules:** Public list excludes unlisted/member-only/drafts; member-only read concealed unless entitled. Show Free/Sold out/Closed/Payment unavailable/sign-in verification, price/total/AUD/support/refund. Public stock advisory; checkout authoritative, no writes from read paths.
- **Tests/done:** Anonymous HTML not just API, visibility concealment, price/availability race, login callback, invalid filters, empty/error and mobile overflow pass.

#### T16 — Verified guest purchase and private access
- [ ] Complete. **Dependencies:** T02, T03, T13, T14, T15.
- **Schema/API:** GuestIdentity/GuestAccessGrant with purpose/hash/expiry/email verification and purchase scope; /api/guest/email/request/confirm, guest checkout/session-CSRF cookie and receipt recovery. Origin and fail-closed IP/email acquisition/token limits.
- **Rules/UI:** Verify email before hold; guest public/unlisted free/paid ticket only, no paid memberships/member discounts. POST token redemption to clean URL; no Session/order-ID access. Explicit verified member claim transaction, not matching submitted emails. No token/referrer/cookie secrets logged; no-store private views.
- **Tests/done:** Wrong/stolen/replayed/expired token, GET prefetch, guessed order, changed recipient, concurrent claim, cookie expiry/CSRF/rate failure and guest free/paid recovery journey pass.

#### T17 — Connect safety and fee/payout disclosure
- [ ] Complete. **Dependencies:** T05, T08, T14.
- **Code:** Preserve connect lifecycle and fees.ts; audit Connect mutations/settings, verify platform/account/mode/destination and snapshot provider account per order. Block disconnect while unresolved financial obligations depend on it; never delete provider account.
- **UI/rules:** Charges ready != payouts enabled; show flags and next action separately. Existing 10% fee deducted from society gross, rounded once/order; buyer pays displayed total, no invented surcharge. Snapshot policy/cents; Stripe processing cost unknown until verified.
- **Tests/done:** Permission denial before provider call, wrong account/test mode, reconnect with historical refund, amount/rounding parity and local Connect test flow pass.

#### T18 — Customer refunds and compensation fencing
- [ ] Complete. **Dependencies:** T10, T12, T14, T17.
- **Schema/API:** RefundRequest per section 3.3; lib/payments/purchase-refunds, /api/orders/[id]/refunds with orders:refund/MFA/reason/confirmation. Keep refund-manual explicitly bookkeeping. Dispatch signed refund events by verified identity to ordinary or existing compensation workflows.
- **External changes:** Add signed charge.dispute.created/updated/closed handling and provider reconciliation for dashboard-created refunds. Store unique provider event IDs and dispute IDs/state; verify the charge belongs to the recorded purchase before changing its financial-review projection. A dispute is not a successful refund. Preserve tickets and historical attendance; block further automated financial actions while reviewed, and resolve validity only through an explicit audited policy. Unknown charge events cannot mutate another purchase.
- **Rules:** Full-order request, amount/currency/charge/destination/dispute checks; financial fence prevents ordinary+compensation double refund. Provider calls outside DB with stable keys; reverse destination/application fee per disclosed snapshot policy. Partial/external/unknown outcome review; full verified refund voids tickets, preserves attendance, no auto-restock.
- **Tests/done:** Concurrent refund/recovery/late fulfilment, provider pending/fail/response loss, out-of-order/duplicate/partial/wrong charge, audit and verified confirmation pass. Include PAY-001 mismatch diagnostic and TEST-001 missing direct cases.

#### T19 — Purchases, wallet and reliable attendance
- [ ] Complete. **Dependencies:** T13, T16, T18.
- **Code/UI:** /purchases and protected order-status read; guest grant equivalent. success/cancel displays actual projection and never claims success from URL or fulfils in production. Wallet valid fulfilled units; history pending/failed/expired/compensation/refunds.
- **Attendance:** Extend check-in service/page/button with scoped ticket/name/email search, validity checks, actor history and server-state refresh on uncertain network outcome; retain conditional check-in/out.
- **Tests/done:** Foreign buyer/guest receipt denial, delayed webhook/email failure, duplicate admission/out, void/refund-review arrival, check-in-only staff and timeout/retry pass. No offline success promise.

### Commerce and memberships

#### T20 — Additive commerce orders and history
- [ ] Complete. **Dependencies:** T02, T05, T10, T14, T17.
- **Schema/services:** CommerceOrder/Line/Lifecycle per section 3.3; numeric constraints, owner/kind checks, immutable snapshots, unique provider IDs; lib/commerce/orders/lifecycle, finance/buyer DTOs and /api/commerce/orders/[id]. Shared compensation/refund adapters, not ticket schema replacement.
- **Transactions:** Lines/arithmetic/owner validated in order transaction; sequence locking and no duplicate business events; references archived not erased.
- **Tests/done:** Fresh/populated migrations/restore, mixed-kind/cross-tenant line rejection, snapshot durability, concealed foreign targets, cursor ties and ticket regression pass.

#### T21 — Commerce payment dispatcher and compensation
- [ ] Complete. **Dependencies:** T20.
- **API/backend:** /api/payments/checkout/membership and /merchandise, lib/commerce/checkout/reconciliation. Stable operations/session binding, signed webhook routing by unique known purchase identity, amount/currency/fee/destination verification, domain locked fulfilment hook.
- **Rules:** Stripe I/O outside DB; free branch where relevant. Paid-but-no-grant/stock becomes durable compensation/refund job. No browser fulfilment; no fallback dispatch to another family from mismatched metadata. Expiry/uncertain-attempt workers extended.
- **Tests/done:** Raw-body signatures, missing/ambiguous/wrong-domain metadata, provider timeout/replay/concurrency/expiry and compensation for each domain pass; no ticket regressions.

#### T22 — Membership products and fixed terms
- [ ] Complete. **Dependencies:** T08, T20.
- **Schema/API:** MembershipProduct(owner/name/description/price/start/end/publication/archive/entitlement version); MembershipGrant(user/society/line/term snapshots/revocation). lib/memberships/products and tenant product CRUD/publish/public listing.
- **Rules/UI:** memberships:manage, members:read separate. Nonnegative cents, end>start, future purchasable term; one society-wide tier per term initially. Sold terms/entitlements immutable; next term new product version; archive not delete. Product creation UI supports semester/year terms.
- **Tests/done:** Invalid term/price, foreign edit, sold term mutation, published/private DTO, archive/history and concurrent publish pass.

#### T23 — Membership fulfilment, renewal and roster
- [ ] Complete. **Dependencies:** T03, T09, T21, T22.
- **Services:** lib/memberships/fulfilment/entitlements and member/scoped roster queries. Verified member quantity=1; member+society locking and term claim uniqueness prevent concurrent duplicate/overlap.
- **Rules:** Grant only from verified paid webhook or server free completion. Time derives effective state; reminder worker never grants/extends. Renew next non-overlapping term. Leave join preserves grant; full provider refund revokes. Exceptional admin revoke reason/audit plus separate financial review, not fabricated refund.
- **Tests/done:** Exact start/end, future/expired/revoked, double checkout/webhook, next-term renewal, refund/revoke race and atomic grant/receipt pass; member/organiser can inspect bounded status roster.

#### T24 — Membership UI and ticket entitlements
- [ ] Complete. **Dependencies:** T12, T15, T19, T23.
- **Schema/UI:** TicketType.memberPrice optional cents; reservation/order quote stores grant/policy/price. Society offers, member purchase/renew/status, organiser product/roster; complete members_only access and public member pricing.
- **Rules:** Free join is not entitlement; guest denied. Check live grant when hold starts; normal expiry during valid 30-minute hold preserves quote. Refunded/revoked grant before fulfilment uses reviewed failure/compensation policy, not unauthorized issue. Never reprice issued history.
- **Tests/done:** Join-only/guest/future/expired denial, price edits, refund/expiry/checkout race, member-only read and fee parity pass with desktop/mobile flows.

### Merchandise

#### T25 — Catalogue, images and variants
- [ ] Complete. **Dependencies:** T07, T08, T20.
- **Schema/API:** MerchandiseProduct(owner/name/description/draft-published-archived/pickup text), image Assets, MerchandiseVariant(tenant-unique SKU/size/colour/price/remaining/version/archive). lib/merchandise/catalogue, tenant CRUD/publish.
- **Rules/UI:** merchandise:manage; safe owner assets; available variant/context required to publish; no shipping claim. Nonnegative stock/cents, archive referenced items, historical names/price preserved.
- **Tests/done:** SKU duplicates, asset owner, invalid stock, sold archive, draft concealment and variant/catalogue form pass.

#### T26 — Public merchandise and quoted cart
- [ ] Complete. **Dependencies:** T15, T16, T25.
- **API/UI:** Society merch tab/product detail, safe public queries, variant selection/cart; /api/merchandise/quote computes totals/fee/availability/pickup/refund policy. Max 10 lines/10 units each, duplicate variant merge, no cross-society or mixed-kind cart.
- **Rules:** No client price/discount/stock authority; quote version prompts review after repricing; verified member or guest for purchase. Safe asset delivery; keyboard variants, support/instructions before payment.
- **Tests/done:** Empty/duplicate/foreign/archived/changed-price/sold-out cart, total equality and mobile errors pass.

#### T27 — Merchandise holds, free/paid sale and stock
- [ ] Complete. **Dependencies:** T21, T26.
- **Schema/backend:** MerchandiseReservation(order/variant/quantity/status/expiry), unique order+variant. lib/merchandise/reservations/fulfilment. Sorted variant locks, then order; 30-minute active holds subtract availability.
- **Rules:** Webhook atomically confirms all lines/decrements once/history/receipt. Free total synchronously local. Expiry/failure releases holds; late/uncertain paid uses compensation. Stock edits cannot go below holds; price snapshot taken locked.
- **Tests/done:** Last unit, opposite cart lock order, multi-line rollback, amount tamper, free/paid duplicate, expiry/payment/stock adjustment and crash recovery pass with no negative stock.

#### T28 — Pickup, returns and refunds
- [ ] Complete. **Dependencies:** T18, T27.
- **Schema/API/UI:** Independent pending/ready/collected with actor/time/version; scoped collection/returns routes, merchandise:fulfil. Ordinary refund adapters use provider truth; unique returned-line effect applies reviewed restock once.
- **Rules:** Only fulfilled non-review orders collect. Refund doesn't prove return; collected history survives. Ready/collected emails triggered by committed transitions. No manual paid edits, automatic stock return or hidden partial-refund assumptions.
- **Tests/done:** Parallel collect/return, foreign staff, refund after collect, partial review, return retry and ready-email replay pass; local operator pickup workflow complete.

#### T29 — Unified purchase and organiser order views
- [ ] Complete. **Dependencies:** T19, T23, T28.
- **Code/UI:** /purchases and organiser Orders Tickets/Memberships/Merchandise tabs, typed per-family detail/lifecycle/refund/receipt. Preserve ticket URLs; no generic unscoped ID lookup. Guest merchandise grant access, memberships member-only.
- **Permissions:** Finance sees money; collection staff get minimum pickup data. DTO source discriminator and stable cursors prevent family/tenant confusion.
- **Tests/done:** All families/statuses, cursor ties, revoked staff/foreign other-family IDs, archived products and buyer refund/recovery history pass.

### Notifications, analytics and dashboards

#### T30 — Complete transactional email workflows
- [ ] Complete. **Dependencies:** T06, T19, T24, T29.
- **Code:** Implement section 5 flow table through ticket outbox/T02. Material event edits create versioned change and bounded resumable recipient fanout/cursors; event-version+purchase+recipient dedupe. Add account preferences for optional renewal/engagement notices.
- **Rules:** Mandatory auth/security/invite/receipt/refund/material change notices are transactional. Authorized resend/requeue with new operation; exhausted jobs visible to operator. No raw tokens/HTML/personal payload in logs.
- **Tests/done:** Every table trigger/recipient/template/dedupe has tests; HTML/link/token expiry and fanout crash/retry pass. Captured local mail evidence distinct from actual provider acceptance and inbox delivery.

#### T31 — Authoritative metrics and bounded queries
- [ ] Complete. **Dependencies:** T18, T24, T29.
- **Code:** lib/analytics implements section 6; replace in-memory series/monthly dashboard aggregation in event-analytics/dashboard. Parameterized SQL/Prisma groupBy, max 366-day ranges, day/week/month buckets, timezone boundaries/zero fill.
- **Permissions/performance:** analytics:read, finance required for money; event-manager attendance-only DTO. Add measured indexes; EXPLAIN ANALYZE on representative synthetic _test data, don't remove old overlaps without usage evidence.
- **Tests/done:** Refund/free/failed/compensation, duplicate units, join vs paid, zero denominator, month/DST and foreign filter metrics pass. PERF-002 fixed; PERF-001 gets local plan evidence with hosted index observation separate.

#### T32 — Practical analytics UI
- [ ] Complete. **Dependencies:** T31.
- **UI:** /dashboard/analytics and event panels, ranges/definitions/timezone, accessible underlying tables then charts. Gross/refunded/net, free/paid tickets, check-in, order trends, membership/engagement and merch collection.
- **Rules:** Unknown processing costs/payouts not invented; no profit label. Same bounded source DTO for charts/tables; financial data omitted server-side for unauthorized role.
- **Tests/done:** Chart/table parity, filter totals, empty/loading/error, keyboard/mobile and permissions pass.

#### T33 — Organisation calendar and timezone handling
- [ ] Complete. **Dependencies:** T05, T11, T24.
- **Code/API:** /dashboard/calendar, /api/orgs/[orgSlug]/calendar; range<=93 days and overlapping events start<rangeEnd/end>rangeStart, live tenant/permission. Agenda/month/week controls link existing events, not duplicate models.
- **Rules:** UTC storage/org IANA display; forms handle DST ambiguous/missing local times. Managers see drafts; attendance-only staff see published operation information, no finance. Membership dates only with roster permission; no recurrence engine.
- **Tests/done:** Multi-day/midnight/month/DST, invalid range/foreign draft, mobile agenda and keyboard navigation pass.

#### T34 — Full personal and organisation dashboards
- [ ] Complete. **Dependencies:** T09, T24, T29, T32, T33.
- **Code/UI:** dashboard page/shell/navbar: permission-filtered active nav, accessible mobile menu, explicit personal/staff society selector. Member: upcoming valid tickets, joins, memberships, events, purchases/settings. Society: readiness, events/calendar/orders/payments/memberships/merch/analytics/settings/staff/AI entry.
- **Rules:** Shared scoped services/defined metrics, calendar month vs last-30-days explicitly labelled, no failed/pending counts as completed buys. No member/staff onboarding loop or inaccessible role links.
- **Tests/done:** All roles/modes, revocation/multi-society, active/mobile nav, honest counts and useful empty/error states pass.

### OpenClaw controlled product actions

#### T35 — Typed action registry shared with normal services
- [ ] Complete. **Dependencies:** T05, T11, T24, T28, T31, T34.
- **Code:** lib/actions registry strict schemas/permissions/tenant resolver/read-or-mutate/preview/execute. Actions: find_society_information, list_events, summarize_event_sales, summarize_orders, explain_readiness, create_event_draft, update_event_draft, publish_event, mark_merchandise_ready.
- **Rules:** Same normal application service/actor/live MFA/tenant validation as UI. Summary minimizes buyer PII and obeys finance permissions. Refunds/authority/disconnect/delete/paid truth link human workflow, never model-direct provider/SQL.
- **Tests/done:** Every action input/output/permission/foreign/revoked test passes; equivalent UI/action effects and audit. No privileged AI service-account bypass.

#### T36 — Durable previews and confirmation receipts
- [ ] Complete. **Dependencies:** T35.
- **Schema/API:** ActionProposal(actor/tenant/action/argument hash/state version/10-minute expiry/status), ActionExecution unique proposal/operation. /api/actions/preview and /[proposalId]/confirm/cancel with origin/CSRF/MFA/limits.
- **Transactions:** Show exact changes; altered state/args require new preview. Reauthorize on confirm. DB mutation+audit+execution receipt commit atomically; provider work only through durable operation/job. After crash return stored result, not execute again.
- **Tests/done:** Foreign actor/tenant, changed params, expiry, double confirm, revoke-after-preview, timeout-after-commit and rollback produce at most one attributable effect.

#### T37 — Guided OpenClaw UI and real model adapter
- [ ] Complete. **Dependencies:** T35, T36.
- **Backend/UI:** lib/openclaw bounded provider interface returns validated action proposal/explanation; deterministic test adapter plus one real provider adapter; /dashboard/openclaw starters/source-linked summaries/preview/Confirm/Cancel. Guided deterministic actions work during outage.
- **Integration checkpoint:** Before implementing the real adapter, record founder-approved provider/model/data-retention/cost settings; if unavailable, implement remaining UI/registry and mark only real-adapter verification blocked. Credentials/provider choice aren't silently deferred until hosting.
- **Safety:** No arbitrary URL/code/SQL tools; context/input/output/call/time limits, server-only secrets, untrusted descriptions treated as data, schema reject hallucinated IDs. Minimal personal data; audit receipt, not raw private prompt. Never say Executed until receipt.
- **Tests/done:** Real UI action, unauthorized summaries/injection/ambiguous intent/invalid provider output/outage/replay pass; real provider smoke runnable locally with supplied credentials.

### Audit and pre-production qualification

#### T38 — Sensitive-action audit survey and handover history
- [ ] Complete. **Dependencies:** T06, T18, T29, T30, T36.
- **Code/UI:** Route/action-to-audit matrix, scoped /dashboard/history. Complete AUD-001 for bootstrap/profile/assets/events/types/settings/stock/membership/collection/refunds/staff/MFA/AI. Safe actor/target/version/reason/before-after facts in business transaction.
- **Rules:** Preserve order journals and explicit incomplete legacy baseline; history cursors, no raw payload/token/email HTML. Archive/reference controls preserve business records.
- **Tests/done:** Every sensitive mutation audit accounted, rollback no audit/replay no duplicate business transition, foreign/PII denial and committee handover view pass.

#### T39 — Security, errors and abuse contract closure
- [ ] Complete. **Dependencies:** T04, T16, T29, T37, T38.
- **Code:** Complete API-001 via central safe mapper; inventory each route/action for guard ordering/authority/tenant/body bounds/audit/rate policy. New reset/guest/upload/AI issuance fails closed; don't change legacy fail-open policies without review.
- **Rules:** Integer multiplication overflow/total/quantity bounds; secure cookies/CSP/security headers tested with Stripe/images. Reject live keys in pilot/local campaign; no credentials/tokens/raw payloads logged. Token cleanup bounded; private data no-store.
- **Tests/done:** Real Redis outage/spoofed IP chain/origin null or missing/CSRF refresh, enumeration/XSS/SSRF/asset limits, stale sessions, role/foreign matrix and dependency audit pass without unaccepted high/critical issues.

#### T40 — Responsive and accessible journey remediation
- [ ] Complete. **Dependencies:** T19, T24, T29, T32, T33, T34, T37.
- **UI:** WCAG 2.2 AA engineering target: labels/errors/focus/dialogs/landmarks/contrast/touch/reduced-motion/live status/table alternatives. Fix duplicate heading/active nav/overflow.
- **Tests/done:** Automated scans in Docker browser runner plus manual keyboard/screen-reader spot checks at 390/768/1280 and 200% zoom; all discovery/auth/cart/checkout/wallet/terms/calendar/check-in/AI confirmation flows reviewed. Record findings; scans alone don't prove real-user usability.

#### T41 — Integrity, migration, restore and scale rehearsal
- [ ] Complete. **Dependencies:** T38, T39.
- **Code:** Extend integrity audit/drift/restore tooling for guest/free/snapshots/ticket validity/refund amounts/commerce arithmetic/grants/stock holds/outbox/action receipts. Add reviewed constraints only after legacy audit; cross-row audit checks explicit.
- **Tests/done:** Full fresh chain, populated baseline upgrade, deliberate invalid writes, rollback compatibility/worker drain and restore pass in disposable DB; zero unexplained drift/double fulfilment/stock/grant issues and representative plans. No fake history repair or canonical owner derived from denormalized fields.

#### T42 — Worker/alert/recovery contracts
- [ ] Complete. **Dependencies:** T30, T38, T41.
- **Code:** Bounded commands/Compose for notifications, token cleanup, membership reminders, commerce expiry/uncertain Session and ordinary refunds; reuse existing workers where safe. One-minute schedules/nonoverlap/leases/timeouts/backlog and oldest-age metrics. Alert transport with local capture receiver.
- **Recovery:** Pause writers/jobs, separate restore without provider writes, reconcile Stripe/refunds/outbox before resume; backup MFA/storage/provider identity secrets. Readiness includes current schema/enabled dependencies, liveness remains minimal.
- **Tests/done:** Worker pause/crash/reclaim/outage/restore/exhaustion, missed webhook/reconciliation and alert receipt rehearsal pass. Runbooks state thresholds/response owner; startup never migrates implicitly.

#### T43 — Immutable release artifact pair
- [ ] Complete. **Dependencies:** T42.
- **Current/change:** Keep foundation hardening; complete Docker Assessment second slice: standalone web, operations image with Prisma/all jobs, development image; web/ops immutable digest manifest with revision/migration checksum; CI build once/scan/SBOM/provenance/publish.
- **Rules:** Adapt hosted Compose to artifact pair; retain non-root/read-only/resources/file secrets, validate Prisma/static/provider/asset modules. Initial measured uncompressed budgets web<=600 MiB/ops<=1 GiB; exceptions require measured justification/owner, not deleting needed code.
- **Deployment code before hosting:** Record the selected pilot hosting provider and implement its versioned deployment/configuration adapters, one-shot migration order, worker scheduling, ingress/secret/storage contracts and rollback commands in this task. Validate configuration and rehearse the rollout locally or with provider dry-run facilities. If provider selection/credentials are unavailable, record the precise blocked adapter or publication subtask; H01 only provisions and executes the prepared deployment, rather than authoring missing rollout logic.
- **Tests/done:** Exact images migrate/web/workers/readiness/shutdown/rollback locally; registry publication needs supplied credentials but can happen before hosting and stays blocked explicitly if missing.
- **Ordered PR-sized substeps (parent requires all):**
  - [ ] **T43a:** Web/ops/development image split and digest/schema manifest. Done when the exact locally built pair passes migration, runtime, every worker and shutdown/rollback smoke tests.
  - [ ] **T43b (after T43a):** Selected-provider configuration/deployment adapters and documented migration/worker/rollback contracts. Done when configuration validation and a dry-run/rehearsal demonstrate deployment ordering; absent provider selection is an explicit blocker.
  - [ ] **T43c (after T43a):** CI artifact build-once, scan, SBOM/provenance and immutable publication. Done when a supplied registry accepts the manifest-linked image pair and CI consumes the same digests; absent registry credentials block publication evidence only.

#### T44 — Complete production-mode journey qualification
- [ ] Complete. **Dependencies:** T37, T40, T41, T42, T43.
- **Tests:** Implement every section 7 row in tests/e2e/integration with synthetic accounts, signed webhooks, captured mail/object-store/AI; production release images, enforced MFA/legacy deny; separate real Redis safety tests. Extend fixtures and run cleanup.
- **Done:** Existing qualification requirements apply to changed executable content: three consecutive complete local E2E runs and required CI qualification/final head evidence, no critical skips, no success fallback. All five checks current; run-owned cleanup confirmed.
- **Ordered PR-sized substeps (parent requires all):**
  - [ ] **T44a:** Add guest/member authentication, public discovery, free/paid tickets and membership journey fixtures/assertions. Done when their section 7 happy paths and denials pass against the release images.
  - [ ] **T44b (after T44a):** Add merchandise/collection, organisation/bootstrap/handover, calendar and permission-matrix journey coverage. Done when their section 7 scenarios pass with two tenants and enforced MFA.
  - [ ] **T44c (after T44b):** Add finance/refund/recovery and OpenClaw confirmation journeys; provider outage/replay and restored-job fencing. Done when their section 7 scenarios pass without duplicate business or external effects.
  - [ ] **T44d (after T44c):** Run the complete combined qualification, three consecutive local passes and latest-head CI, then cleanup. Done when the retained evidence ties every scenario to the exact image/schema pair and all five required checks pass.

#### T45 — Observed provider acceptance before hosting
- [ ] Complete. **Dependencies:** T44.
- **Code/tests:** Extend staging-driver/staging-payments for free/paid/member/guest tickets, memberships, multi-line merch and full/compensation refund cases. Preserve test-key refusal/platform identity/run-owned manifests; add real email/storage/model adapter smoke with credentials.
- **Done:** Observed Stripe success/decline/cancel attestation/forced expiry/destination/fees/refund/recovery projections match images, event/listener HTTP/app correlation retained. Campaigns run locally via CLI forwarding; missing credentials blocked, not automatically hosted-only. Captured mail != provider acceptance != inbox delivery. Cleanup sessions/assets or preserve failed recovery manifests.

#### T46 — Final PRD audit and pre-hosting candidate packet
- [ ] Complete. **Dependencies:** T01–T45.
- **Deliverable:** Reconcile section 8 against current code; update docs/issue states/Current Handover, honest public feature/privacy/support/refund copy. Candidate records artifact pair, schema digest, flags/jobs, tests/provider evidence, support owner, rollback and H gates.
- **Done:** No locally implementable PRD feature omitted/placeholder/deferred. Disclose AUD/fee/term/pickup/AI policies, no live payout/hosting/certified accessibility claim. Founder fee/value review uses sample buyer/seller amounts; competitive market pricing not asserted without actual evidence.

## 5. Required event-to-email specification

T02 builds infrastructure; owning services insert intent atomically; T30 completes this matrix. Every message has text/escaped HTML, safe first-party links, bounded retry and template version. Provider idempotency uses immutable job ID. Token payloads encrypted/private; provider acceptance is separately recorded from delivery.

| Trigger | Recipient and template | Dedupe/intent | Required behavior |
| --- | --- | --- | --- |
| Signup/verification resend | Account email; verify account | Token version | Old token invalidated; generic issuance response; cancel expired job. |
| Password reset request | Existing account email; reset | Token version | Single-use POST; no outward enumeration; expired job suppressed. |
| Password/security change | Account email; security notice | User authVersion/event | Never include password or recovery codes; independent retry. |
| Staff invite/resend | Invite email; society/role/expiry | Invite version | Matching verified user; no public token list. |
| Paid/free ticket fulfilment | Buyer snapshot; receipt | Existing automatic order key | Purchased name/amount/Free label, current schedule, valid IDs/support and protected guest link. |
| Manual ticket resend | Authorized same buyer | Audited resend operation | New job, same payment/tickets unchanged. |
| Paid/free membership fulfilment | Member; term/receipt/entitlements | Fulfilled line/grant | No pending/unpaid grant promise. |
| Membership nearing expiry | Member; renewal reminder | Grant/7-days-before-end/version | Optional preference; daily catchup sends once, not term extension. |
| Membership expiry/revocation | Member; status/reason | Grant transition/version | Actual state time/revocation-driven even if worker late. |
| Merchandise fulfilment | Buyer; items/receipt/pickup | Order fulfilled | Variant/quantity/amount snapshots and purchase-scoped guest link. |
| Ready/collected merchandise | Buyer; pickup/confirmation | Collection version | Only committed transitions, retry buttons don't duplicate. |
| Confirmed refund | Buyer; amount/result | Verified refund/state | Never say Refunded for request/pending/bookkeeping flag. |
| Paid-but-unfulfilled | Buyer; processing/support; operator alert | Compensation transition | No valid entitlement claim; no raw provider payload. |
| Material event schedule/location change | Valid holders; old/new summary | Event version/purchase/recipient | Bounded resumable fanout, no marketing to unrelated users. |
| Exhausted job | Authorized operator support queue | Job/exhaustion transition | Local alert sink before hosted paging; no secrets/PII in generic logs. |

Preferences control optional engagement/renewal mail, not essential security/receipt/refund/change notices. No bulk marketing platform is required. Link redemption must survive mail security scanning; GET must not mutate credentials or invite/grant ownership.

## 6. Authoritative analytics specification

Define/query these metrics in T31 before charts in T32. All queries scope canonical owner, avoid joins that multiply totals, use parameterized database aggregation and bounded ranges, expose timezone/as-of/inclusion policy.

| Metric | Authoritative data and calculation |
| --- | --- |
| Gross paid ticket revenue | Positive stripe-kind fulfilled Order.totalAmount by fulfilledAt; pending/failed/expired/compensation/free excluded. |
| Refund amount | Verified successful provider refund cents by provider timestamp; local marker excluded. |
| Net ticket sales | Gross less verified refunds. Distinguish refund-date series from purchase-cohort net; don't mix periods. |
| Platform fee/seller net | Snapshot fee minus verified application-fee reversals; gross-refunds-net fee. Unknown processing cost/payout is not profit or payout balance. |
| Issued/valid/free units | Actual Ticket rows on fulfilled orders; valid excludes void/refund_review; free identified by paymentKind; keep historical issued count. |
| Remaining/held/sellable | Remaining quantity, active unexpired holds and section 3.2 event ceiling; read-time advisory. |
| Attendance/check-in rate | Valid checked-in Ticket count / valid issued count; zero denominator Not applicable. Refunded historical admissions separate. |
| Order trends | Distinct purchase counts per domain by createdAt/state; success by fulfilledAt, not Session/event count. |
| Free joins | OrganisationMember creation/current relationship; not paid membership/staff. |
| Membership states | Grant term/revocation at as-of UTC, distinct members; unpaid attempts excluded. |
| Renewals/engagement | Consecutive nonoverlapping fulfilled grants; distinct members buying/attending society events and overlap with join/grant cohorts. Label observed purchase/attendance, not untracked visits/clicks. |
| Merchandise | Fulfilled lines/totals, verified refunds, stock/holds and independent pickup states. |
| Society performance | Sum separate ticket/membership/merch aggregates; no ticket-unit join multiplication. |

Financial data requires finance plus analytics capability; event managers get attendance/inventory-only data; members only personal facts. Use day/week/month buckets, zero fill and DST-correct UTC range bounds. EXPLAIN ANALYZE with representative _test fixtures before declaring scale readiness; live index usage is H05.

## 7. Complete user-journey qualification

T44 implements this matrix; T45 adds actual provider observations. Use two societies, independent members, verified guest, named owner/admin/event/finance/check-in staff and revoked identity. Local users synthetic; H06 actual participants.

| Journey | Required happy path and denial/recovery evidence |
| --- | --- |
| Anonymous visitor | Society/event search, branded profile, date/location/price/organiser, merch; draft/member-only concealed and unlisted absent from lists. |
| Guest attendee | Email verification, free+paid public ticket, private receipt/recovery/email/check-in/refund support; guessed purchase/foreign token denied. |
| Guest merchandise | Verified cart/Stripe/receipt/ready/collection/refund; cross-society/membership purchase denied. |
| Member onboarding/security | Signup/verify/login/profile/join-leave/password reset/settings; stale JWT denied, safe callbacks, correct live profile state. |
| Member attendance | Free/paid/member-price, stock/quote race, decline/cancel/expiry, wallet/email/replay, void-ticket check-in denial. |
| Membership relationship | Free join distinct from term purchase; future/current/renew/expiry/member-only; leave retains paid grant, refund revokes. |
| Buyer purchase history | Tickets/memberships/merch and pending/failed/refund/compensation; no other user's private record. |
| Society bootstrap | Verified organisation creates one tenant, profile/branding/contact/named owner/MFA/Connect; second tenant denied. |
| Committee handover | Matching verified invite acceptance, roles, transfer/revoke/live session; final owner retained under concurrent changes; joins no management. |
| Event operator | Draft/details/types/visibility/capacity, publish blockers, close/edit/calendar/public preview/attendance/history; sold deletion/unpublish denied. |
| Membership operator | Products/current-next terms/roster/renew/revoke/refund/history; cannot invent paid status. |
| Merchandise operator | Images/variants/stock/publish/holds/orders/ready/collect/return/refund; exactly-once stock effects. |
| Finance operator | Connect/charge-payout distinction/fees/refunds/net/compensation/email requeue/reconcile; nonfinance DTO denial. |
| OpenClaw user | Authorized source-linked summary, draft/edit/publish/ready preview/confirm/cancel/receipt; injection/foreign/revoked/stale preview denied. |
| Operations recovery | Stop jobs/writers, separate restore, schema/inventory/grants/history audit, provider reconciliation then fenced restart; no duplicate external effects. |

## 8. PRD traceability matrix

Current status is baseline, not future qualification. COMPLETE capabilities map to verification/extension rather than reconstruction. Expected status is pre-hosting implementation/acceptance; hosted/user evidence explicitly separate.

| PRD requirement | Current status | Implementation task | Verification method | Expected final status |
| --- | --- | --- | --- | --- |
| 1–2 integrated society operating platform | PARTIAL | T08–T09, T20–T37, T46 | Connected section 7 journeys | COMPLETE |
| 3.1 organiser profile/events/settings | PARTIAL | T08, T11–T12, T17, T34 | Society operator E2E | COMPLETE |
| 3.1 sales/orders/check-in/analytics/AI | PARTIAL | T19, T29, T31–T37 | Role-specific integrated E2E | COMPLETE |
| 3.2 member identity/discovery/purchase/services | PARTIAL | T03–T04, T09, T15, T19, T24, T29 | Member journeys | COMPLETE |
| 3.3 guest browse/details/organiser identity | PARTIAL | T08, T15 | Anonymous HTML/API | COMPLETE |
| 3.3 guest purchase when supported | MISSING | T16, T26–T29 | Guest free/paid/merch E2E | COMPLETE |
| 4 society-first/simple/integrated positioning | NEEDS VERIFICATION | T34, T40, T46 | Content/task review | COMPLETE locally; H06 fit |
| 5.1 volunteer/committee-friendly design | NEEDS VERIFICATION | T06, T34, T40 | Handover/local UX; H06 | COMPLETE locally; H06 users |
| 5.2 member/society separation | COMPLETE | T05, T34, T44 | Role/mode/denial matrix | COMPLETE |
| 5.3 trustworthy event/sale states | PARTIAL | T11, T15, T17, T19 | State matrix | COMPLETE |
| 5.4 money integrity/audit/trust | PARTIAL | T12–T14, T18, T38, T45 | Race/provider/history | COMPLETE locally; H03 activation |
| 5.5 handover-friendly continuity | PARTIAL | T06, T38, T42 | Committee/restore drill | COMPLETE |
| 5.6 extensible coherent architecture | PARTIAL | T20–T21, T35 | Service/DTO regressions | COMPLETE |
| 5.7 AI assistant/user control | MISSING | T35–T37 | Preview/confirmation/revoke | COMPLETE |
| 6.1 secure signup/signin | COMPLETE | T03–T04, T39, T44 | Auth.js/browser/token tests | COMPLETE |
| 6.1 account type/dashboard experience | COMPLETE | T05, T34 | Personal/staff/org nav | COMPLETE |
| 6.1 individual member/society account identity | COMPLETE | T04–T06, T08 | Profile/bootstrap schema tests | COMPLETE |
| 6.1 one primary organisation | COMPLETE | T08 | Concurrent second-bootstrap denial | COMPLETE |
| 6.1 member profile onboarding | PARTIAL | T03–T04, T09 | Completion/edit/privacy | COMPLETE |
| 6.1 organisation information onboarding | PARTIAL | T08, T17 | Wizard/readiness | COMPLETE |
| 6.1 role-aware nav/access | PARTIAL | T05, T34 | Mobile/revoked/role tests | COMPLETE |
| 6.2 name/description/branding/public profile | PARTIAL | T07–T08 | Safe assets/profile DTO/E2E | COMPLETE |
| 6.2 display public events | COMPLETE | T08, T15 | Visibility/date filter | COMPLETE |
| 6.2 private admin settings | PARTIAL | T05, T08, T17 | Field separation/denial | COMPLETE |
| 6.2 society identity/events/membership home base | PARTIAL | T09, T24, T26, T34 | Profile tab journeys | COMPLETE |
| 6.3 create/edit/date/time/location/description | COMPLETE | T11–T12, T33 | Existing lifecycle plus lock/time tests | COMPLETE |
| 6.3 draft/publish/unpublish when appropriate | PARTIAL | T11–T12 | Create bypass/replay/order restrictions | COMPLETE |
| 6.3 capacity | MISSING | T11–T12 | Independent seat contention | COMPLETE |
| 6.3 visibility/restricted access | MISSING | T11, T15, T24 | Public/unlisted/member-only | COMPLETE |
| 6.3 types/prices/quantities | COMPLETE | T10–T12 | Sold edits/snapshot/race | COMPLETE |
| 6.3 public page/attendee information | PARTIAL | T15, T30 | Public preview/change notices | COMPLETE |
| 6.3 readiness blockers and invalid states | PARTIAL | T11, T15, T17 | Common readiness matrix | COMPLETE |
| 6.4 public browse/cards/full details | PARTIAL | T08, T15 | Anonymous/filter/mobile | COMPLETE |
| 6.4 purchase options/draft-invalid concealment | PARTIAL | T11–T16 | Draft/closed/free/mixed/sold-out | COMPLETE |
| 6.5 multiple types/safe stock | COMPLETE | T12–T14 | Locks/holds/capacity | COMPLETE |
| 6.5 purchase orders/issued units | COMPLETE | T13–T16 | Free/paid/guest fulfilment | COMPLETE |
| 6.5 sales/check-in/attendee access | PARTIAL | T19, T31–T32 | Finance/attendance/private wallet | COMPLETE |
| 6.5 historical names/prices | PARTIAL | T10 | Rename/reprice/legacy labels | COMPLETE |
| 6.5 charge without tickets recovery | PARTIAL | T18, T42, T45 | Compensation/refund campaign | COMPLETE locally; H03 activation |
| 6.6 checkout clarity/explicit statuses | PARTIAL | T13–T19, T21, T29 | All state journeys | COMPLETE |
| 6.6 unpaid/failed/expired no tickets | COMPLETE | T12, T21, T44 | Signed transport/negative states | COMPLETE |
| 6.6 duplicate avoidance/idempotency | COMPLETE | T14, T18, T21, T27 | Replay/concurrency/crash | COMPLETE |
| 6.6 organiser review/purchase history | PARTIAL | T10, T19, T29, T38 | Tenant/history/snapshot | COMPLETE |
| 6.7 connect payment account | COMPLETE | T17, T45 | Connect regression/local provider | COMPLETE |
| 6.7 readiness/failures clearly shown | PARTIAL | T11, T15, T17 | Charge/payout distinctions | COMPLETE |
| 6.7 only eligible paid checkout | COMPLETE | T12, T17, T21 | Locked provider/quote readiness | COMPLETE |
| 6.7 transparent fees | PARTIAL | T10, T17, T26, T31 | Cents/Session/UI parity | COMPLETE |
| 6.7 actual society payouts | REQUIRES HOSTED/STAGING ENVIRONMENT | H03, H06 | Actual provider approval/settlement | REQUIRES HOSTED/STAGING ENVIRONMENT |
| 6.8 issued list/check-in/status | COMPLETE | T19 | Cursor/conditional attendance | COMPLETE |
| 6.8 useful audit/event-day speed/reliability | PARTIAL | T19, T38, T40, H06 | Actor/network/race and real event | COMPLETE locally; H06 usability |
| 6.9 membership offer/purchase | MISSING | T22–T24 | Product/term/payment E2E | COMPLETE |
| 6.9 free join | COMPLETE | T09 | Idempotence/no authority | COMPLETE |
| 6.9 member and organiser status | MISSING | T23–T24 | Roster/term boundaries | COMPLETE |
| 6.9 society access/pricing/engagement | MISSING | T23–T24, T31 | Grants vs joins/price policies | COMPLETE |
| 6.9 semester/year/team continuity | PARTIAL | T06, T22–T24, T38 | Renewal/handover/history | COMPLETE |
| 6.10 name/description/price/images/availability | MISSING | T07, T25–T27 | Catalogue/assets/variant/stock | COMPLETE |
| 6.10 member and guest merchandise sales | MISSING | T21, T26–T27 | Cart/identity/payment | COMPLETE |
| 6.10 tracked merchandise orders | MISSING | T27–T29 | Pickup/refund/return/history | COMPLETE |
| 6.10 natural society/payment integration | MISSING | T26, T29, T34 | Profile/cart/dashboard | COMPLETE |
| 6.11 event revenue/ticket sales | PARTIAL | T31–T32 | Defined source reconciliation | COMPLETE |
| 6.11 attendance/check-in rates | PARTIAL | T19, T31–T32 | Valid denominator/refund fixtures | COMPLETE |
| 6.11 order trends | MISSING | T31–T32 | Range/state/domain aggregation | COMPLETE |
| 6.11 engagement/society performance | PARTIAL | T23, T28, T31–T32 | Observed member/commerce metrics | COMPLETE |
| 6.11 practical analytics | NEEDS VERIFICATION | T32, T40, H06 | Definitions/tables/operator review | COMPLETE locally; H06 validation |
| 6.12 find information/summarize events/orders | MISSING | T35, T37 | Authorized source-linked tools | COMPLETE |
| 6.12 actions/guidance/navigation | MISSING | T35, T37 | Guided/readiness tasks | COMPLETE |
| 6.12 approved admin actions | MISSING | T35–T36 | Shared service/confirm receipts | COMPLETE |
| 6.12 permission/payment/audit control | MISSING | T35–T39 | Injection/foreign/revoke/replay | COMPLETE |
| 7 member tickets/joins/memberships/events | PARTIAL | T19, T24, T34 | Complete personal journey | COMPLETE |
| 7 member purchases/settings | PARTIAL | T04, T29, T34 | Private settings/history | COMPLETE |
| 7 org events/orders/payments/analytics | PARTIAL | T17, T29, T32–T34 | Management role journeys | COMPLETE |
| 7 org membership/merch/settings/AI | MISSING | T24, T28, T34–T37 | Connected UI/nav/actions | COMPLETE |
| 7 predictable simple navigation | PARTIAL | T05, T34, T40 | Active/mobile/keyboard | COMPLETE |
| 8 public-only information | PARTIAL | T08, T15–T16, T39 | DTO/concealed visibility | COMPLETE |
| 8 members own private information | COMPLETE | T04, T16, T29, T39 | Own-user/guest scope | COMPLETE |
| 8 own society/no tenant leaks | COMPLETE | T05, T20–T29, T39 | Canonical foreign/revoked matrix | COMPLETE |
| 8 server checks beyond UI | COMPLETE | T05, T35–T39 | Direct API/action malicious inputs | COMPLETE |
| 9 users/societies/memberships/events/types retained | PARTIAL | T08, T10, T22–T24, T38, T41 | Archive/FK/history audit | COMPLETE |
| 9 orders/tickets/payments/attendance retained | PARTIAL | T10, T18–T21, T38, T41 | Refund/snapshot/restore | COMPLETE |
| 9 merch/admin records | MISSING | T20, T28, T35–T38 | Actor/replay/restore | COMPLETE |
| 9 edits preserve historical meaning | PARTIAL | T10, T22, T25, T38 | Snapshot/legacy accuracy | COMPLETE |
| 10 responsive and accessible | NEEDS VERIFICATION | T40 | Automated/manual accessibility | COMPLETE locally; H06 users |
| 10 obvious actions/forms/useful errors | PARTIAL | T15, T29, T34, T39–T40 | Invalid/keyboard/retry states | COMPLETE |
| 10 empty states/polish/clear admin UI | PARTIAL | T08, T15, T26, T34, T40 | Empty/error/mobile review | COMPLETE |
| 11 payment/idempotency/inventory correctness | COMPLETE | T12–T14, T18, T21, T27, T44–T45 | Race/provider qualifications | COMPLETE |
| 11 publish/private data correctness | PARTIAL | T11–T12, T24, T39 | Sale/permission matrix | COMPLETE |
| 11 recovery/feedback | PARTIAL | T18–T19, T30, T39, T42 | Outage/requeue/restore | COMPLETE |
| 11 deployed reliability | REQUIRES HOSTED/STAGING ENVIRONMENT | H01–H05 | Actual edge/jobs/alerts/restore | REQUIRES HOSTED/STAGING ENVIRONMENT |
| 12 understandable pricing/fees | PARTIAL | T17, T26, T31, T46 | Disclosure/amount parity | COMPLETE |
| 12 competitive value/reduced admin | NEEDS VERIFICATION | T34, T37, T46, H06 | Fee/value review and user evidence | COMPLETE local design; H06 fit |
| 13 focused boundaries/interoperability | NEEDS VERIFICATION | T17, T35–T37, T46 | No social/LMS/ERP/AI bypass | COMPLETE |
| 14–16 safety/extensibility/alignment/product fit | PARTIAL | T38–T46, H06 | Final traceability/journey/user audit | COMPLETE locally; H06 fit |
| Requested organisation calendar | MISSING | T33 | Range/timezone/role/mobile | COMPLETE |
| Supporting auth/invite/receipt/refund/change emails | PARTIAL | T02–T04, T06, T30 | Section 5 event matrix | COMPLETE locally; H03 delivery |
| Supporting tooling/testing/pre-production | PARTIAL | T01, T39–T46 | Images/schema/CI/recovery evidence | COMPLETE |

## 9. Actual hosted/staging activation tasks

Only the following require the deployed environment. Scripts, adapters, local failure drills and CLI-forwarded provider campaigns are T work and cannot be excused here.

### H01 — Qualified artifact deployment
- [ ] **Depends:** T46. Provision host/registry/database/Redis/object storage/secrets/DNS/HTTPS using T43's prepared adapters. Deploy exact web/ops digests and one-shot migration before web/jobs. Verify non-root/read-only/resources/readiness/schema and compatibility rollback. Local ops:deploy does not prove actual hosted deployment; execute and observe the prepared provider-specific rollout order here.

### H02 — Actual staff authority, private pilot and edge
- [ ] **Depends:** H01. Enroll actual staff/MFA recovery, backed-up MFA key, enforce MFA and legacy deny. Configure founder-approved private pilot access, trusted origin, edge-overwritten single IP header and Redis; test direct URL/API denial, revocation/spoofing. Public signup alone isn't a private pilot restriction.

### H03 — Hosted provider endpoints and delivery
- [ ] **Depends:** H01–H02, T45. Register actual HTTPS Checkout/Connect/refund endpoints; prove signatures/retries/platform mode, asset delivery, mail domain/links/inbox evidence. Repeat focused test-mode journeys on real origin. automatic_full stays off until workers/webhooks/alerts/campaign pass. Real payouts/live money require provider approval and separate founder decision.

### H04 — Actual schedules, monitoring and response
- [ ] **Depends:** H03. Install bounded one-minute jobs/nonoverlap/timeouts/backlog alerts, central logs/external health. Trigger controlled failure and verify real recipient receipt/response. Monitor uncertain/refund/mail queues; local capture/console isn't external paging.

### H05 — Hosted encrypted recovery and scale
- [ ] **Depends:** H01. Activate off-machine encrypted database/assets/secret backups. Pilot RPO<=24 hours/RTO<=4 hours; prove separate _restore_test drill with provider writes disabled, data checks/reconciliation before resume. Observe actual pools/plans/index use/storage restore; never reset active DB.

### H06 — Real-user controlled MVP testing and release decision
- [ ] **Depends:** H02–H05. Real society operator/member/guest plus second-tenant accounts run section 7 in founder-supported Stripe test-mode sessions. Observe accessibility/check-in/terms/pickup/fees/AI trust/support; file/fix defects and rerun. Record candidate/config/owner/stop rules/dated founder decision. Personal participant consent/contact stays outside Git. A paid public launch is never implied.

DEP-001 genuine advisory PR/failure-notification receipt cannot be manufactured; retain as external operational evidence. Legal/commercial/provider approval and real settlement aren't declared solved by code. These facts do not defer any implementable PRD feature.

## 10. Readiness gates and final coverage audit

### PRD feature completeness
- [ ] T01–T46 complete with evidence; each section 8 row maps to usable verified code, not placeholder models/routes.
- [ ] Profiles/branding/accounts/staff/onboarding/events/discovery/free+paid+guest tickets/memberships/merch/calendar/dashboards/analytics/email/OpenClaw work end to end.
- [ ] AUD/fixed-term/pickup/full-refund/capacity/AI defaults documented; no previous ticketing-only exclusions silently retained.

### Data integrity
- [ ] Fresh+populated migration/restore/rollback pass; no unexplained integrity/owner/stock/grant violations.
- [ ] Names/prices/fees/terms/provider identity/attendance/history preserved; legacy unknown facts labelled; no non-disposable reset.

### Permissions/security
- [ ] Route/action guard/rate/audit matrix complete; own-user/guest/foreign/revoked/role tests pass.
- [ ] Verification/reset/stale sessions/MFA/CSRF/origin/real Redis/upload/injection/redaction tests pass; no unaccepted high/critical finding.
- [ ] Private pilot/actual enrollment remains H02 until activated.

### Payment/ticket/inventory correctness
- [ ] Stripe truth/free noncash classification; no browser/model paid-state authority.
- [ ] Locks/capacity/holds/snapshots/keys/replay/crash tests for ticket/membership/merch pass.
- [ ] Uncertain creation/late paid/failed fulfilment/refund/dispute/mail recovery durable; no double charge/issue/grant/restock/negative stock.
- [ ] T45 observed provider campaigns pass or explicitly block candidate qualification; synthetic transport isn't provider evidence.

### End-to-end journeys
- [ ] Every section 7 row passes on exact production-mode artifacts with required qualification/CI and cleanup.
- [ ] Honest buyer statuses and personal/staff modes; no guessed guest or foreign private data.

### UX/accessibility
- [ ] T40 keyboard/labels/contrast/status/focus/mobile/zoom and charts/calendar/cart/AI reviewed.
- [ ] Support/price/fee/term/pickup semantics consistent in UI/Stripe/mail; real usability remains H06, not claimed from scans.

### Operational readiness
- [ ] Immutable pair/schema digest/SBOM/provenance/scan, all jobs/fencing/backlogs/readiness, local alert and recovery/rollback rehearsals pass.
- [ ] Runbooks list schedules/thresholds/retained secrets/provider reconciliation/response owner.
- [ ] Latest-head five CI checks and risk-specific evidence current; task-owned cleanup done, backups/recovery retained.

### Remaining hosted verification
- [ ] H01–H06 evidenced before declaring real-user testing successful: actual ingress/private access/MFA/provider delivery/jobs/paging/off-machine restore.
- [ ] Production money remains blocked until explicit founder approval and applicable critical register/provider gates pass.

**Final PRD-to-plan audit at authorship:** Sections 1–5 audience/purpose/principles, all 6.1–6.12 feature families, 7 dashboards, 8 access, 9 records, 10 UX, 11 reliability, 12 pricing/value, and 13–16 boundaries/alignment/fit have concrete implementation or verification rows. Requested calendar/free/guest/email/recovery/tooling extensions are included. Existing complete features are preserved and verified; partial work has named remaining changes. Only actual deployment/activation/hosted recovery/real-user evidence is H work. No locally implementable PRD feature is omitted or moved to a post-MVP track.
