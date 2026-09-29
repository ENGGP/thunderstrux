---
status: current
last-reviewed: 2026-09-29
owner: engineering
---

# Current Handover

## Snapshot

Thunderstrux is a Docker-first Next.js 16 App Router SaaS for student societies. As verified on 2026-09-29, the latest public `main` before this documentation branch was `4919703`.

- [PR #18](https://github.com/ENGGP/thunderstrux/pull/18) merged the production-readiness verification work, compensation refunds, strict origin/session-bound CSRF, official Redis client, failed-email requeue, ownership drift tooling, failed-order constraint, staff MFA, and production legacy-access switch.
- [PR #20](https://github.com/ENGGP/thunderstrux/pull/20) updated CI Node 22 from 22.23.2 to 22.23.3.
- [PR #19](https://github.com/ENGGP/thunderstrux/pull/19) updated the pinned `pnpm/action-setup` digest.
- All five latest-head checks passed for PR #18 and for the two dependency PRs: static validation, integration, production build, browser E2E, and operations validation.
- [PR #21](https://github.com/ENGGP/thunderstrux/pull/21) contains the documentation-governance refresh on `codex/documentation-governance-refresh`. Its latest-head checks must pass before merge.
- PR #21 head `6d7b4c5` passed all five required jobs on 2026-09-29. The subsequent documentation-only evidence commit must also receive green latest-head checks before merge.

Read [[Documentation Index]], [[Engineering Delivery Workflow]], [[Non-Blocking Issue Register|Issue and Defect Register]], and [[Handover 2026-09-29 Production Readiness and Documentation Refresh]] before new implementation work.

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
- Production uses a built non-root image. `pnpm ops:deploy` runs the one-shot `migration` service before starting the candidate app. `docker/entrypoint.sh` only executes its supplied command.
- `/api/health` is liveness. `/api/health/ready` checks database/schema, required migrations, enabled Redis, MFA configuration, and legacy-access configuration with bounded failures.
- The migration chain contains 26 migrations. The newest are:
  - `20260628010000_staff_accounts_foundation`
  - `20260921010000_formal_payment_lifecycle`
  - `20260922010000_failed_order_timestamp_constraint`
  - `20260922020000_staff_mfa`
  - `20260927010000_compensation_refunds`
- `package.json` pins production and development dependencies. CI uses Node 22.23.3; the Docker image currently uses the mutable `node:20-bookworm-slim` major-version base tag.

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

- Review [PR #21](https://github.com/ENGGP/thunderstrux/pull/21) and confirm the documentation-only evidence commit retains all five green latest-head CI checks before merge.
- Local documentation acceptance passed on 2026-09-29: 40 documentation files checked, all 24 runner tests passed by direct file execution, and `git diff --check` passed. Independent review findings were applied. Clean-environment typecheck/build remain PR CI evidence because the host dependency directory lacks the Next binary.
- [[Docker Architecture Assessment 2026-09-29]] records the container-boundary review, observed local runtime, production gaps, and recommended managed startup topology. Its findings do not change the existing production release gates.
- Do not commit `docs/obsidian/.obsidian/workspace.json`; it contains a user-local Obsidian workspace change.
- After documentation merges, choose a production hosting platform and implement the external release gates above before enabling unrestricted payments.
- Use the canonical open items in [[Non-Blocking Issue Register]] rather than historical session gap lists.

## Safety Rules

- Integration tests may only reset a disposable database whose name contains `_test`.
- Do not run `docker compose down -v` unless intentionally deleting local database and Redis volumes.
- Do not trust client-supplied tenancy data or denormalized organisation fields as authority.
- Do not infer Stripe payment or refund truth from local flags.
- Preserve unrelated workspace changes and verify ancestry before deleting branches.
