# Thunderstrux PRD Fulfilment and MVP Readiness Plan

Status: proposed plan, not a release approval. Reviewed: 2026-10-04. Repository baseline: `0976a97` (`main` after PR #24).

## How to use this plan

The [PRD](THUNDERSTRUX_PRD.md) describes the intended whole product; it does not define a minimum release boundary. This plan proposes a focused first release and records the remaining PRD work separately. The founder must approve that boundary and update the PRD or a versioned product scope before anyone calls the MVP complete. If every PRD feature is required for launch, complete the post-MVP track below **before** launch instead.

This is a repository and documentation assessment, not a fresh hosted production audit. `Implemented` means the relevant code exists, not that it has passed the final release campaign. Re-check each row against the release candidate, current provider state, and actual user journeys. The [issue register](obsidian/Non-Blocking%20Issue%20Register.md), [production readiness ledger](obsidian/Production%20Readiness%20Verification%202026-09-22.md), and [current handover](obsidian/Current%20Handover.md) own live risk and evidence status.

## Proposed first-release promise

An organisation can onboard named staff, configure Stripe Connect, publish a paid event, sell a ticket to a signed-in member, inspect orders, check in the attendee, and recover safely from payment or email failures. A visitor can browse public events and organisation information but must sign in to buy. This is a **ticketing MVP**, not fulfilment of the entire PRD.

Proposed exclusions for this release require an explicit product decision and honest UI/marketing copy: guest checkout; paid membership products; merchandise sales; OpenClaw; QR scanning; rich organisation branding; and broad member-engagement analytics. Basic join/leave membership is already present and should not be described as paid membership. If any excluded capability is part of the promised pilot, move its acceptance work into the MVP steps.

## PRD coverage at the assessed baseline

| PRD area | Current repository evidence | Remaining decision or work |
| --- | --- | --- |
| 6.1 Accounts and dashboards | Email/password signup, member and legacy organisation roles, member profile, named staff, permissions, MFA, and role-aware dashboards exist in `app/`, `lib/auth/`, and `prisma/schema.prisma`. | Finish staff rollout; decide whether public signup needs email verification and password recovery before launch. The [codebase map](obsidian/Thunderstrux%20Codebase%20Map.md) records both as absent. |
| 6.2 Organisation profiles | `app/(public)/organisations/[orgSlug]/page.tsx` shows name, slug, and upcoming events. | Description, branding, and a meaningful editable public profile are absent from the `Organisation` model and public page. |
| 6.3 Events | Draft/publish/unpublish, dates, location, descriptions, and ticket types exist in `lib/events/event-lifecycle.ts`. | `Event` has no explicit capacity or visibility field. Publishing checks ticket types and remaining quantity, but not all public-sale readiness conditions; decide and enforce the launch contract. |
| 6.4 Discovery | Public list/detail reads and pages exist in `lib/events/public-events.ts` and `app/(public)/events/`. | Confirm unpublished/invalid/sold-out presentation and mobile clarity with users. Public detail is visible without login; purchase redirects unauthenticated visitors to login. |
| 6.5 Ticketing and 6.6 orders | Reservations, webhook-driven fulfilment, tickets, order statuses, wallet, organiser orders, and check-in exist. `Order.unitPrice` and totals preserve purchase price. | The wallet currently reads the **current** `TicketType.name`; persist and display the purchased name so later edits cannot rewrite historical order detail. Re-run payment, inventory, and failure-path acceptance. |
| 6.7 Connected payments | Stripe Connect state and Checkout exist; `lib/stripe/fees.ts` calculates a 10% platform fee. | Show and validate fee/payout disclosure in the buying and organiser journeys; complete the live provider and production gates below. |
| 6.8 Check-in | Organiser ticket list, check-in/check-out routes, timestamp state, and audit coverage exist. | Test an event-day flow with staff, denied users, retries, and poor connectivity expectations. QR scanning is not implemented. |
| 6.9 Memberships | `OrganisationMember` and member search/join/leave exist. | No paid membership product, term/status lifecycle, pricing, or member entitlement system is present. |
| 6.10 Merchandise | No merchandise models, routes, or purchase flow were found in `prisma/schema.prisma` or `app/`. | Build as a later coherent product vertical unless included in the agreed MVP promise. |
| 6.11 Analytics | Event sales/revenue views and a basic organisation dashboard exist. | Check-in rates, member engagement, and broader order/performance trends are incomplete. [PERF-002](obsidian/Non-Blocking%20Issue%20Register.md) records an aggregation scaling risk. |
| 6.12 OpenClaw | No OpenClaw assistant or approved-action interface was found in `app/`, `lib/`, or the schema. | Defer or design separately with permission, confirmation, audit, and payment boundaries. |
| 8-11 Access, records, UX, reliability | Tenant-aware services, protected routes, lifecycle history, workers, and tests provide a foundation. | Close or explicitly accept the relevant API/audit/data/performance items in the issue register; verify accessibility, mobile usability, and hosted reliability on the release candidate. |

## Ordered steps to reach the proposed MVP

### 1. Approve a testable release contract

- [ ] Choose the initial customer and operating model: pilot societies, jurisdiction/currency, support owner, whether ticket sales are paid or test-only, and whether signup is public or invite-controlled.
- [ ] Decide explicitly whether the proposed exclusions above are acceptable. Resolve guest checkout in particular: the PRD allows it *where supported*, while the current checkout API requires a member account. Document the sign-in requirement publicly if retained.
- [ ] Define success and stop criteria: a society can complete the organiser and buyer journeys; paid orders either issue the correct tickets or enter an actionable compensation path; no tenant leak; no unresolved critical release gate. Record who may approve a production launch.
- [ ] Update the PRD/scope and release copy to match this contract. Do not describe deferred memberships, merchandise, AI, or guest purchase as available.

### 2. Complete the promised product journey

- [ ] Make a society's public profile useful: at least an editable description, accurate organiser identity, and published events. Add branding only if the launch promise includes it. Test public/private field separation.
- [ ] Decide whether event capacity is the sum of ticket-type quantities or a separate limit. Implement the selected rule, and make draft, published, sold-out, past, and payment-unavailable states unambiguous. Block publication or clearly block checkout when required sale conditions fail.
- [ ] Snapshot the purchased ticket-type name in the order line/history and render that snapshot in organiser and member views. Migrate additively; decide how to label older orders that lack a snapshot. Keep the existing price snapshot and canonical event ownership rules.
- [ ] Surface the ticket price, any platform fee, refund/support policy, and the seller/payout context before payment. Confirm that UI amounts and Stripe amounts agree, including rounding and zero-price handling.
- [ ] Walk through signup, organisation creation/staff invite, Stripe onboarding, event creation/publishing, discovery, login-gated checkout, ticket wallet/email, organiser order review, and check-in on desktop and mobile. Fix confusing empty/error states and run an accessibility review of these journeys.
- [ ] Decide how a real user recovers a lost password and how unverified email addresses are handled. Implement and test the chosen controls before broad self-service signup, or keep the pilot invite-controlled with a documented support recovery procedure.

### 3. Close money, authority, and data release blockers

- [ ] Finish [AUD-001](obsidian/Non-Blocking%20Issue%20Register.md): inventory sensitive management and checkout-setting routes, require actor-attributed audit records, and prove cross-tenant and revoked-staff denial. Resolve [API-001](obsidian/Non-Blocking%20Issue%20Register.md) or accept its exact client impact with contract tests.
- [ ] Enrol every active staff identity in TOTP, retain recovery access safely, set `MFA_ENFORCEMENT_MODE=enforce`, and set `LEGACY_ORGANISATION_ACCESS_MODE=deny` after shared-account migration. Verify direct URL and API denial, not only hidden navigation.
- [ ] Re-run signed Stripe webhook, replay/concurrency, reservation expiry, sold-out, duplicate fulfilment, refund, and failed-email scenarios on the final code. Keep Stripe as payment/refund truth and browser success pages non-authoritative. Complete the real Stripe test-mode success, decline, cancellation/expiry, and automatic/manual compensation campaign described in [E2E and Staging Payments](obsidian/E2E%20and%20Staging%20Payments.md). Do not enable `automatic_full` until its worker, refund webhook, alerts, and campaign pass.
- [ ] Run the database integrity and ownership-drift audits on a production-like copy. Review discrepancies against `Event.organisationId`, test the full migration chain and restore, and review representative query plans before production data migration. Never reset non-disposable data.

### 4. Build and rehearse the hosted operating system

- [ ] Select a host and deploy an immutable release image with HTTPS, secret management, managed or deliberately operated PostgreSQL/Redis, reviewed resource limits, and a one-shot migration job before app rollout. Complete the remaining image provenance/SBOM work if required by the chosen release policy; see [Docker Architecture Assessment](obsidian/Docker%20Architecture%20Assessment%202026-09-29.md).
- [ ] Configure exact trusted origins and an edge-overwritten client-IP header; enable Redis-backed rate limiting. Prove readiness fails safely when database, Redis, MFA configuration, or migration state is bad.
- [ ] Schedule and monitor compensation, email-outbox, and stale-order workers. Activate signed Checkout/Connect/refund webhooks, provider email, structured log aggregation, alerts, and an external health check. Test failure paging and an operator response, not only a local log line.
- [ ] Enable encrypted off-machine backups and perform a hosted restore drill into a separate `_restore_test` database. Record recovery objective, rollback compatibility, retained secrets, and who can execute recovery.
- [ ] Run the required latest-head PR checks and the final release-image smoke, integration, E2E, operations, security audit, and provider acceptance evidence. A historical green PR or local Docker run does not approve a later image.

### 5. Run a controlled pilot and make the release decision

- [ ] Have at least one real society operator and one member complete the full journey using pilot-safe payment settings. Include another organisation/member account to demonstrate cross-tenant isolation, plus a sold-out and a failed-payment path.
- [ ] Observe support tickets, abandoned onboarding/checkout, payout clarity, email delivery, check-in usability, and operator workload. Record findings as defects or explicit scope decisions; do not infer readiness from test automation alone.
- [ ] Review the [issue register](obsidian/Non-Blocking%20Issue%20Register.md) and production gates with dated evidence. Block unrestricted paid launch on any critical open gate, failed provider campaign, missing backup/restore, or unenforced staff authority. Record the exact release image, migration state, feature flags, owner, rollback path, and launch decision.
- [ ] After launch, monitor payment/compensation, workers, email, readiness, security alerts, and support closely; retain a tested rollback/incident path and reconcile Stripe with local orders.

## Track to fulfil the entire PRD after the ticketing MVP

These items remain PRD requirements unless the PRD is formally narrowed. Deliver each as a separate product increment with its own tenant, payment, audit, UX, and acceptance coverage.

1. **Society identity and member relationships:** full public profile and branding; join/follow choices; paid membership products, terms, status, entitlements, renewal/expiry, and member/organiser views.
2. **Merchandise:** product catalogue, images, variants/stock policy, checkout, order history, fulfilment/refund operations, and organisation-level reporting.
3. **Broader analytics:** attendance/check-in rates, order trends, membership engagement, organisation performance, bounded queries, and privacy-safe presentation.
4. **OpenClaw:** start with read-only navigation/summaries; add approved actions only through existing server-side permission and tenant checks, explicit confirmation, audit, idempotency, and provider-safe workflows.
5. **Optional access and event extensions:** guest checkout, QR check-in, richer visibility/capacity controls, and improved communications only when chosen in the product contract.

Full PRD fulfilment requires demonstrated end-to-end acceptance of these increments, not merely models or placeholder navigation. Keep this plan, the PRD, the living references, and the issue register aligned as decisions and evidence change.
