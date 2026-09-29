---
status: living
last-reviewed: 2026-09-29
owner: engineering
---

# Issue And Defect Register

This is the canonical register for open defects, accepted technical debt, external release gates, deferred improvements, and resolved defects. Historical handovers may describe issues that are now resolved; this register owns current status.

Statuses: `open`, `accepted-risk`, `external-gate`, `blocked`, `resolved`, and `superseded`. Resolve an item only with a linked fix and regression or direct verification evidence.

## Open Product And Engineering Issues

| ID | Severity | Area | Status | Last verified | Issue and impact | Evidence or workaround | Owner / next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API-001 | Medium | API errors | open | 2026-09-29 | Central safe error mapping covers representative routes, while remaining route families still use manual catch blocks. Clients may receive inconsistent shapes. | Cross-tenant event/order/ticket and Connect behavior is tested. | Engineering: survey all routes, migrate remaining families without changing disclosure rules, and add contract coverage. |
| AUD-001 | High | Audit | open | 2026-09-29 | The sensitive-action audit survey is incomplete. Existing event, refund, attendance, email requeue, MFA, and staff actions are audited, but every checkout-setting and administrative mutation has not been formally accounted for. | Use `AuditLog` action search and route inventory. | Engineering/security: publish a route-to-audit matrix and add missing actor-attributed entries transactionally. |
| DATA-001 | Medium | Ownership drift | accepted-risk | 2026-09-29 | Denormalized organisation IDs can drift from canonical event ownership. Runtime authorization avoids trusting them, and repair tooling is manual. | Run `pnpm db:integrity:audit` and dry-run `pnpm db:organisation-drift:repair`. | Data/operations: schedule integrity checks or design database enforcement after production-copy review. |
| PERF-001 | Medium | Indexes | accepted-risk | 2026-09-29 | Composite indexes are implemented, but production-scale `EXPLAIN ANALYZE`, write overhead, and redundant-index usage are unverified. | Checkout remains correct; local plain `EXPLAIN` showed usable plans. | Data/operations: review representative plans and `pg_stat_user_indexes` before removing indexes. |
| PERF-002 | Low | Analytics | open | 2026-09-29 | Some analytics aggregate by loading matching paid orders into application memory. Large tenants may see avoidable latency and memory use. | Current MVP data is bounded operationally. | Engineering: replace with database aggregation or bounded series queries when representative scale requires it. |
| LOG-001 | Low | Logging | accepted-risk | 2026-09-29 | Some older reconciliation internals still use legacy console output. | Critical paths also emit structured redacted events. | Engineering: migrate opportunistically without changing payment semantics. |
| PAY-001 | Low | Webhook diagnostics | open | 2026-09-29 | A repeated compensation webhook with mismatched metadata may report the existing compensation state without a distinct mismatch event. It does not issue tickets or mutate a paid order. | Existing compensation remains safe and idempotent. | Payments: add a focused mismatch log branch and regression test. |
| TEST-001 | Low | Payment tests | open | 2026-09-29 | Missing direct regressions remain for local-order lookup with absent metadata, reservation quantity mismatch release, and non-paid completed sessions avoiding compensation. | Broader reconciliation suites cover adjacent behavior. | Payments: add focused integration cases when payment reconciliation next changes. |
| UI-001 | Low | Public availability | accepted-risk | 2026-09-29 | Displayed availability can change between page load and checkout. | Checkout transaction remains authoritative. | Product/engineering: consider refresh/realtime behavior only when demand justifies it. |
| UI-002 | Low | Server rendering | accepted-risk | 2026-09-29 | Public event detail server-fetches the app's own API route, adding internal HTTP coupling. | Current behavior works and retains the public API. | Engineering: call the shared read service directly in a focused future refactor. |

## External Production Gates

| ID | Severity | Area | Status | Last verified | Required outcome | Owner/next action |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-001 | Critical | Workers | external-gate | 2026-09-29 | Schedule compensation, email-outbox, and stale-cleanup workers and monitor backlog/failures. | Hosting owner configures one-minute schedules and alert thresholds. |
| OPS-002 | Critical | Observability | external-gate | 2026-09-29 | Route structured logs and critical events to external aggregation, dashboards, and paging; monitor health and migration failures. | Hosting owner selects and verifies alert transport. |
| OPS-003 | Critical | Recovery | external-gate | 2026-09-29 | Enable encrypted off-machine backups and complete a hosted restore drill with an agreed recovery objective. | Operations owner uses [[Production Operations]]. |
| SEC-001 | Critical | Staff MFA | external-gate | 2026-09-29 | Enroll all active staff, enforce MFA, and deny legacy shared access. | Security/operations follows [[Production Readiness Verification 2026-09-22]]. |
| SEC-002 | High | Edge security | external-gate | 2026-09-29 | Enable Redis rate limiting and configure an edge-overwritten trusted client-IP header and exact trusted origins. | Security/operations verifies release-image readiness and hosted mutations. |
| PAY-002 | Critical | Stripe refunds | external-gate | 2026-09-29 | Subscribe refund webhooks and pass real Stripe test-mode automatic and manual compensation campaigns. | Payments/operations follows [[E2E and Staging Payments]] before `automatic_full`. |
| DEP-001 | Medium | Dependency operations | external-gate | 2026-09-29 | Capture a genuine eligible security-update PR and maintainer receipt of a real Security Audit failure notification. | Engineering/operations must not manufacture vulnerabilities or registry failures. |

## Resolved Defect History

| ID | Resolved | Defect and root cause | Fix and evidence |
| --- | --- | --- | --- |
| DEF-001 | 2026-09-27 | `/mfa` exposed a Prisma error because the `UserMfa` table migration was not applied. | Required migration added to readiness/schema contract; route error boundary and doctor guidance added. [PR #18](https://github.com/ENGGP/thunderstrux/pull/18) and MFA tests. |
| DEF-002 | 2026-09-27 | A named Docker dependency volume masked the rebuilt image, causing `@redis/client` resolution failure. | `scripts/recreate-dev-app.mjs` replaces only the labelled dependency cache while preserving database/Redis data. [PR #18](https://github.com/ENGGP/thunderstrux/pull/18) and runner tests. |
| DEF-003 | 2026-09-27 | Recreated dependencies lacked the generated Prisma Client. | Recreation now generates Prisma Client and applies migrations before starting Next. [PR #18](https://github.com/ENGGP/thunderstrux/pull/18) and schema/doctor tests. |
| DEF-004 | 2026-09-20 | Windows checkout converted `docker/entrypoint.sh` to CRLF and broke Linux container startup. | `.gitattributes` enforces LF; fresh migration containers and operations rehearsal passed. [PR #12](https://github.com/ENGGP/thunderstrux/pull/12). |
| DEF-005 | 2026-09-20 | Operations CI inherited an unintended database environment. | Isolated disposable operations database environment and regression coverage. [PR #11](https://github.com/ENGGP/thunderstrux/pull/11). |
| DEF-006 | 2026-09-19 | Logout used a hard-coded localhost target and failed on isolated E2E ports. | Redirect uses the current site origin; isolated browser logout coverage passed. [PR #10](https://github.com/ENGGP/thunderstrux/pull/10). |
| DEF-007 | 2026-09-21 | Concurrent webhook replay surfaced PostgreSQL serialization/deadlock conflicts through more than Prisma `P2034`. | Whole-transaction retries recognize reviewed SQLSTATE/Prisma conflict forms; concurrency and signed replay tests passed. [PR #13](https://github.com/ENGGP/thunderstrux/pull/13). |
| DEF-008 | 2026-09-21 | Compensation lifecycle evidence recorded an inaccurate reservation after-state. | Lifecycle persistence reads the reconciled result and regression coverage verifies it. [PR #13](https://github.com/ENGGP/thunderstrux/pull/13). |
| DEF-009 | 2026-09-28 | Production rehearsal did not explicitly deny transitional legacy organisation access. | Production E2E/operations configuration sets legacy mode to `deny`; latest-head checks passed. [PR #18](https://github.com/ENGGP/thunderstrux/pull/18). |

## Register Procedure

1. Search this file before creating an entry. Reopen a resolved ID if the same root cause recurs.
2. Record confirmed evidence, user impact, safe workaround, and next action. Do not paste secrets or personal/provider payloads.
3. Fix an unrelated finding during a task only when it blocks or invalidates that task; otherwise register it without widening scope.
4. On resolution, add the root cause, fix, regression/direct verification, date, and PR or commit. Update affected troubleshooting and living-reference documents.
