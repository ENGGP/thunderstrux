---
status: current
last-reviewed: 2026-10-04
owner: engineering
---

# Current Handover

## Snapshot

Thunderstrux is a Docker-first Next.js 16 App Router SaaS for student societies. As verified on 2026-10-04, PRs #24–#27 are merged; the starting main commit for T01 baseline verification is `598f922`.

- [PR #18](https://github.com/ENGGP/thunderstrux/pull/18) merged the production-readiness verification work, compensation refunds, strict origin/session-bound CSRF, official Redis client, failed-email requeue, ownership drift tooling, failed-order constraint, staff MFA, and production legacy-access switch.
- [PR #20](https://github.com/ENGGP/thunderstrux/pull/20) updated CI Node 22 from 22.23.2 to 22.23.3.
- [PR #19](https://github.com/ENGGP/thunderstrux/pull/19) updated the pinned `pnpm/action-setup` digest.
- All five latest-head checks passed for PR #18 and for the two dependency PRs: static validation, integration, production build, browser E2E, and operations validation.
- [PR #21](https://github.com/ENGGP/thunderstrux/pull/21) merged the documentation-governance refresh as `0b7024e`.
- [PR #22](https://github.com/ENGGP/thunderstrux/pull/22) merged Docker foundation hardening as `8d5c754`. All five latest-head checks passed: static validation, integration, production build, browser E2E, and operations validation.
- [PR #23](https://github.com/ENGGP/thunderstrux/pull/23) merged handover consolidation as `fce7c04`, leaving this file as the only current handover.

Read [[Documentation Index]], [[Engineering Delivery Workflow]], and [[Non-Blocking Issue Register|Issue and Defect Register]] before new implementation work, followed by the living reference for the affected subsystem.

## Product And Architecture State

- `Organisation` is the tenant boundary; `Event.organisationId` is canonical ownership for event-owned orders, tickets, and reservations.
- Organisation management uses active named `OrganisationStaff` authority. `OrganisationMember` is member join state and grants no management access.
- Legacy organisation-account access remains a controlled migration fallback and can be denied with `LEGACY_ORGANISATION_ACCESS_MODE=deny`.
- Staff roles, invites, live revocation, TOTP MFA, recovery codes, login-bound grants, and actor-attributed audit records are implemented.
- Public event reads are read-only. Public availability subtracts active unexpired reservations; checkout remains authoritative.
- Stripe Checkout fulfilment is webhook-driven and idempotent. Paid sessions that cannot issue tickets enter durable compensation review/refund handling.
- Ticket email is outbox-backed. Compensation refunds, email delivery, and stale-order cleanup use bounded workers.
- Order lifecycle history is append-only and tenant-scoped. Historical pre-migration orders are explicitly incomplete.
- Protected mutation routes use trusted-origin and session-bound CSRF checks. High-abuse routes use Redis-backed rate limits.
- Route adapters retain transport and security checks; application services own domain transactions and provider composition.

## Runtime And Schema

- Development uses `docker-compose.yml` plus `docker-compose.dev.yml`. Development startup generates Prisma Client, deploys migrations, and starts Next dev.
- Production uses a built non-root image. `pnpm ops:deploy` runs the one-shot `migration` service before starting the candidate app. The hardened overlay adds a read-only root filesystem, dropped capabilities, no-new-privileges, PID/CPU/memory limits, and reviewed writable temporary paths.
- `/api/health` is liveness. `/api/health/ready` checks database/schema, required migrations, enabled Redis, MFA configuration, and legacy-access configuration with bounded failures.
- The migration chain contains 26 migrations. The newest are:
  - `20260628010000_staff_accounts_foundation`
  - `20260921010000_formal_payment_lifecycle`
  - `20260922010000_failed_order_timestamp_constraint`
  - `20260922020000_staff_mfa`
  - `20260927010000_compensation_refunds`
- Node is aligned on 22.23.3 across the package engine, Docker, E2E, and CI. Runtime images are digest pinned and Renovate submits reviewed digest updates without automerge.

## Production Release Gates

Repository implementation is not hosted production activation. Unrestricted production payments and broad staff rollout remain blocked until:

1. Every staff identity is enrolled and `MFA_ENFORCEMENT_MODE=enforce` is verified.
2. Legacy shared access is migrated and `LEGACY_ORGANISATION_ACCESS_MODE=deny` is active.
3. Redis rate limiting and the exact trusted proxy header are configured at the edge.
4. Compensation, email-outbox, general-notification and stale-cleanup workers are scheduled and monitored; the notification key is provisioned for app/worker and separately backed up with recovery proven.
5. Stripe refund webhooks and external alert delivery are active.
6. Automatic and manual compensation pass a new real Stripe test-mode campaign.
7. Encrypted off-machine backups, external health monitoring, and a hosted restore drill are complete.
8. Sensitive-action audit coverage and remaining API error normalization are surveyed and closed or explicitly accepted.
9. Query plans and index usage are reviewed with representative production-scale data.

See [[Production Readiness Verification 2026-09-22]] and [[Production Operations]] for evidence and procedures.

## Current Work And Next Safe Actions

- [PR #27](https://github.com/ENGGP/thunderstrux/pull/27) is merged: feature branches start from refreshed local `main` in the primary folder. It also installs patched Debian `libpcre2-8-0` after the base-image PCRE2 finding. All checks passed before merge; no active development or hosted stack was redeployed. See DEF-012.
- [PR #26](https://github.com/ENGGP/thunderstrux/pull/26) merged the PRD-to-code implementation plan in [MVP_READINESS_PLAN](../MVP_READINESS_PLAN.md). [PR #28](https://github.com/ENGGP/thunderstrux/pull/28), `codex/t01-baseline-verification`, qualifies T01: shared disposable-database guards, full-schema reset proof, occupied-port refusal and isolated baseline/E2E/recovery evidence. It also fixes operations cleanup omitting profiled workers (DEF-014). See the plan's evidence ledger for final qualification; PR #28 is merged; T02 is the next implementation task. Later product tasks remain incomplete.
- [PR #24](https://github.com/ENGGP/thunderstrux/pull/24) merged the five-stage solo-maintainer workflow and ignore hygiene; PR #25 merged the earlier MVP plan, since replaced by PR #26. Preserve protected main, latest-head checks, run-owned cleanup and local-only Obsidian workspace state.
- Local cleanup on 2026-10-02 removed generated build/tool caches, obsolete helper artifacts, and 33 completed E2E run directories. Three E2E directories missing `runtime.env`, operational evidence, and retained database backups remain intentionally; the development stack was rebuilt without deleting volumes and passed `/api/health`, with PostgreSQL now bound to loopback only.
- Standalone web/operations targets, dual-image release evidence, SBOM/provenance publication and the image-size budget remain T43 in the readiness plan; implement them when its dependencies are complete.
- [[Docker Architecture Assessment 2026-09-29]] records the implemented foundation controls and remaining immutable-release and hosted activation work.
- `docs/obsidian/.obsidian/workspace.json` is local ignored state; do not force-add it.
- Choose a production hosting platform and implement the external release gates above before enabling unrestricted payments.
- Use the canonical open items in [[Non-Blocking Issue Register]] rather than old session gap lists.

## Safety Rules

- Integration tooling requires a PostgreSQL URL with one simple database name ending in `_test`. The name alone does not establish disposability: use a run-owned test database, never development or real-user data.
- Do not run `docker compose down -v` unless intentionally deleting local database and Redis volumes.
- The ignored local archive `tmp/thunderstrux-before-p319-20260921.dump` is the verified pre-P3.19 development backup. Keep it until its retention decision is explicit; it is not generic cache.
- Do not trust client-supplied tenancy data or denormalized organisation fields as authority.
- Do not infer Stripe payment or refund truth from local flags.
- Preserve unrelated workspace changes and verify ancestry before deleting branches.

## Active Account Lifecycle Work

T02 is in progress on `codex/t02-notification-foundation`, based on refreshed main `d852c4e`. Acceptance: additive encrypted general notification outbox, bounded/fenced delivery, private security jobs and scoped business requeue; retain ticket semantics. High risk: full integration/browser/operations, failure/concurrency, migration/reset/restore, typecheck/build/audit/docs and latest-head five checks are required. The user authorised committing the deleted root remediation document; the cached historical copy remains unchanged. T03 and T04 (recovery/settings, email changes, closure) remain required. No production activation or development migration is implied.

[PR #31](https://github.com/ENGGP/thunderstrux/pull/31) implements T02 at executable revision `f4fc1ae`. Local baseline passed 261 integration tests, typecheck/build/audit; three complete local E2E runs and the operations deployment/restore/rollback rehearsal passed with cleanup. All five CI checks and three repeat CI browser runs passed on this revision; final documentation-head validation remains. Failed operations diagnostics and database backups are retained. Exact run IDs and limitations are in the readiness-plan evidence ledger. Next safe action: complete PR final-head checks/merge, refresh main, then implement T03; T04 has accepted a/b/c definitions for recovery/settings, email changes and permanent closure.
