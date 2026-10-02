---
status: current
last-reviewed: 2026-10-02
owner: engineering
---

# Current Handover

## Snapshot

Thunderstrux is a Docker-first Next.js 16 App Router SaaS for student societies. As verified on 2026-10-02, documentation PRs #21 and #23 and Docker foundation PR #22 are merged on `main`; the current main commit is `fce7c04`.

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
4. Compensation, email-outbox, and stale-cleanup workers are scheduled and monitored.
5. Stripe refund webhooks and external alert delivery are active.
6. Automatic and manual compensation pass a new real Stripe test-mode campaign.
7. Encrypted off-machine backups, external health monitoring, and a hosted restore drill are complete.
8. Sensitive-action audit coverage and remaining API error normalization are surveyed and closed or explicitly accepted.
9. Query plans and index usage are reviewed with representative production-scale data.

See [[Production Readiness Verification 2026-09-22]] and [[Production Operations]] for evidence and procedures.

## Current Work And Next Safe Actions

- Solo-maintainer workflow simplification and repository ignore hygiene are prepared on `codex/simplify-engineering-workflow`. The change reduces routine ceremony to five stages and three risk levels while retaining protected `main`, latest-head CI, and high-risk safeguards; adds a post-CI cleanup gate; excludes local worktrees and build/tool caches from Git and Docker contexts; and makes Obsidian workspace state local-only. Open its PR and require all five latest-head checks before merge.
- Local cleanup on 2026-10-02 removed generated build/tool caches, obsolete helper artifacts, and 33 completed E2E run directories. Three E2E directories missing `runtime.env`, operational evidence, and retained database backups remain intentionally; the development stack was rebuilt without deleting volumes and passed `/api/health`, with PostgreSQL now bound to loopback only.
- Create `codex/docker-immutable-release` from refreshed `origin/main` for standalone web/operations targets, dual-image release evidence, SBOM/provenance publication, and the image-size budget.
- [[Docker Architecture Assessment 2026-09-29]] records the implemented foundation controls and remaining immutable-release and hosted activation work.
- `docs/obsidian/.obsidian/workspace.json` is local ignored state; do not force-add it.
- Choose a production hosting platform and implement the external release gates above before enabling unrestricted payments.
- Use the canonical open items in [[Non-Blocking Issue Register]] rather than old session gap lists.

## Safety Rules

- Integration tests may only reset a disposable database whose name contains `_test`.
- Do not run `docker compose down -v` unless intentionally deleting local database and Redis volumes.
- The ignored local archive `tmp/thunderstrux-before-p319-20260921.dump` is the verified pre-P3.19 development backup. Keep it until its retention decision is explicit; it is not generic cache.
- Do not trust client-supplied tenancy data or denormalized organisation fields as authority.
- Do not infer Stripe payment or refund truth from local flags.
- Preserve unrelated workspace changes and verify ancestry before deleting branches.
