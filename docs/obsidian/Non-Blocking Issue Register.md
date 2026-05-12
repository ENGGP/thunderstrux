# Non-Blocking Issue Register

This register tracks non-blocking risks found during production-readiness and P0 remediation reviews. These are not blockers for the current P0.4 compensation-review commit, but they should be considered before production payments or broader rollout.

## P0.4 Compensation Review Follow-Ups

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| Checkout reconciliation | A compensation-required failed order with no active reservation returns `compensation_required` before revalidating the incoming completed-session metadata. | A later mismatched webhook may be reported as the existing compensation state rather than logging the new mismatch. It does not create tickets, send email, or mutate paid orders. | Add a narrow test and log branch for duplicate compensation webhooks with mismatched `session.id` or metadata. |
| Checkout reconciliation | Natural retry recovery is only possible when an active unexpired reservation still exists. Most unsafe failure paths release, expire, or lack such a reservation. | Operators may expect retries to recover more cases than the current reservation model allows. | Document operational expectation and consider a future explicit repair/refund workflow instead of reservation restoration. |
| Tests | Missing explicit coverage for missing required metadata when the local order is found by `stripeSessionId`. | Current behavior is intended, but the edge case is not directly pinned. | Add integration coverage for paid missing metadata plus local order lookup fallback. |
| Tests | Missing explicit coverage for reservation quantity mismatch compensation behavior. | Active reservation release on quantity mismatch is not directly pinned. | Add integration test asserting compensation state and released reservation. |
| Tests | Missing explicit coverage that non-paid completed sessions remain ordinary failed orders without compensation review. | Existing successful and compensation tests imply this, but the branch is not explicit. | Add a small integration test for `payment_status != paid`. |

## Security And Abuse Controls

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| Trusted origin guard | Compatibility mode allows mutation requests with no `Origin` and no `Referer`. | Some cross-site or non-browser mutation attempts may not be blocked until compatibility mode is tightened. | Observe production logs, then move missing-origin/missing-referer policy to fail closed where safe. |
| CSRF | No token-based CSRF defence yet; current mitigation is trusted-origin validation. | Origin validation is useful but not a complete browser mutation defence. | Add CSRF/double-submit token once origin-compatibility risk is understood. |
| Rate limiting | Redis limiter is intentionally simple fixed-window logic with custom TCP/RESP implementation. | Less battle-tested than an official Redis client or managed limiter. | Replace with a production Redis client or managed limiter before higher-risk scale. |
| Rate limiting | IP bucket quality depends on trusted proxy header hygiene. | Misconfigured proxies can collapse users into one bucket or allow spoofed buckets. | Define trusted proxy configuration and sanitize forwarding headers at the edge. |
| Auth model | Organisation accounts are shared by committee members for MVP. | No individual accountability, offboarding, MFA, or least-privilege controls. | Implement named staff users, staff invites, MFA, audit logs, and per-user roles. |

## Payments, Orders, And Email

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| Email delivery | Automatic ticket email is sent inline after webhook reconciliation. | Slow/failing provider calls can delay webhook response and retries are not durable. | Move delivery to an `EmailOutbox` with retry/backoff and worker processing. |
| Refund/review workflow | Compensation-required orders have durable state and organiser visibility but no formal operator workflow. | Operators must manually inspect Stripe and communicate/refund outside the app. | Add an operator playbook first; later add controlled admin/review tooling. |
| Payment lifecycle | Order, payment, reservation, ticket, email, manual refund, and compensation state are spread across fields. | Future lifecycle changes can introduce invalid transitions. | Introduce explicit transition helpers or a formal payment lifecycle model after P0 work. |
| Real webhook testing | Integration tests mock Stripe sessions and do not exercise real signed Stripe delivery. | Raw signature transport and Stripe event payload drift are under-tested. | Add staging/test-mode webhook E2E with real signed payloads. |
| Manual refund flag | `isManuallyRefunded` is local bookkeeping only. | Users/operators may mistake it for Stripe refund truth. | Keep UI copy explicit; later integrate real Stripe refund status if needed. |

## Data Integrity And Scalability

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| Public availability | Public event detail can show raw remaining ticket quantity rather than reservation-aware availability. | Users may see availability that checkout later rejects because active reservations are excluded only at checkout. | Return `availableQuantity = quantity - activeReservedQuantity` on public detail. |
| Pagination | Orders, member ticket wallet, and public discovery still have unbounded reads in several paths. | Large datasets can become slow and memory-heavy. | Add cursor pagination using stable `(createdAt, id)` ordering and matching indexes. |
| Pagination tests | Event ticket pagination lacks same-`createdAt` collision and malformed `limit`/`direction` coverage. | Cursor edge cases could silently regress. | Add focused hardening tests. |
| DB constraints | Core invariants such as positive quantities/prices and valid event date ranges are mostly app-enforced. | Bugs, scripts, or future routes can create invalid financial/inventory data. | Add database check constraints after auditing current data. |
| Denormalized ownership | `Order.organisationId` and `Ticket.organisationId` are denormalized; most access uses event ownership, but cleanup still has denormalized scopes. | Historical drift can affect lifecycle operations or reporting. | Harden cleanup and reporting around `event.organisationId`; add consistency checks/repair tooling. |
| Indexes | Several high-volume query shapes lack composite indexes. | Orders, cleanup, public discovery, and member wallet queries can degrade at scale. | Add indexes after `EXPLAIN ANALYZE` on representative data. |
| Request-time cleanup | Stale pending cleanup runs from normal reads. | Read latency and write amplification increase with traffic. | Move broad cleanup to a worker/cron; keep checkout-local cleanup authoritative. |

## API, Observability, And Operations

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| API errors | Error shapes and tenant-disclosure behavior are not fully standardized across routes. | Clients handle errors inconsistently and some object existence signals may differ. | Centralize domain error mapping and disclosure rules. |
| Logging | Logging is mostly `console.*` with inconsistent payloads. | Harder incident triage, redaction assurance, metrics, and alerting. | Add structured logger with redaction policy. |
| Metrics/alerts | No first-class metrics or alerting for payment failures, webhook failures, email failures, or compensation states. | Operators may miss high-severity incidents. | Add counters/timers and alerts for paid-but-unfulfilled, webhook signature failures, email retry exhaustion, and checkout failures. |
| CI/CD | No visible CI/CD pipeline, deployment healthcheck, backup/restore, or migration rollback process. | Production changes rely on manual validation and migration safety is harder to guarantee. | Add CI stages, app health endpoint, backup/restore runbook, and migration deployment job. |
| Dependencies | Some package versions use `latest`. | Future installs/upgrades can drift unexpectedly despite lockfile protection. | Pin explicit ranges and add Renovate/Dependabot with CI. |
| Architecture | Route handlers still combine transport, auth, validation, persistence, external I/O, and domain decisions. | Complex changes are harder to review safely. | Extract small domain use-case services incrementally after production blockers. |

## Documentation Notes

- [[Stripe Payments and Connect]] documents current payment, compensation, reservation, and email behavior.
- [[Database and Multi Tenancy]] documents the order compensation fields and tenancy rules.
- `docs/production-readiness-remediation-plan.md` remains the broader remediation roadmap.
