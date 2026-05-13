# Non-Blocking Issue Register

This register tracks non-blocking risks found during production-readiness and P0 remediation reviews. These are not blockers for the current P0 remediation commits, but they should be considered before production payments or broader rollout.

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
| CSRF | No token-based CSRF defence yet; current mitigation is trusted-origin validation. | Origin validation is useful but not a complete browser mutation defence. | Produce the dedicated CSRF design covering token generation, storage, validation, client/server integration, exemptions, rollout, exact routes, and tests before coding. |
| Rate limiting | Redis limiter is intentionally simple fixed-window logic with custom TCP/RESP implementation. | Less battle-tested than an official Redis client or managed limiter. | Replace with a production Redis client or managed limiter before higher-risk scale. |
| Rate limiting | IP bucket quality depends on trusted proxy header hygiene. | Misconfigured proxies can collapse users into one bucket or allow spoofed buckets. | Define trusted proxy configuration and sanitize forwarding headers at the edge. |
| Auth model | Organisation accounts are shared by committee members for MVP. | No individual accountability, offboarding, MFA, or least-privilege controls. | Implement named staff users, staff invites, MFA, audit logs, and per-user roles. |

## Payments, Orders, And Email

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| Email outbox operations | Ticket delivery is now durable, but failed jobs are terminal and require future explicit requeue/operator handling. | Provider outage or bad configuration can leave paid orders with unsent tickets until a human intervenes. | Add monitoring for failed jobs plus an explicit, audited requeue tool. |
| Email outbox operations | Production email delivery depends on an external scheduler running `pnpm email:outbox:process` every 1 minute. | Paid orders can be fulfilled and ticket rows issued while buyers do not receive ticket email if the worker is not scheduled. | Add deployment scheduler configuration and alert when due pending jobs or stale processing jobs exceed threshold. |
| Refund/review workflow | Compensation-required orders have durable state and organiser visibility but no formal operator workflow. | Operators must manually inspect Stripe and communicate/refund outside the app. | Add an operator playbook first; later add controlled admin/review tooling. |
| Compensation alerts | First-time compensation transitions now emit `paid_but_unfulfilled_compensation_required` through structured console alerting only. | Console alerts can be missed unless production log aggregation routes them to an alert channel. | Wire operational alerts into the P1 logging/metrics/alerting system and page operators on paid-but-unfulfilled events. |
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
| Indexes | P1.10 added the planned composite indexes, but `Order(eventId)` and `Order(userId)` now overlap with the left-most prefixes of the new order composites. | Extra indexes add write overhead and storage cost. This is not a correctness issue and was kept intentionally to avoid risky index removal in the P1.10 slice. | Review production `pg_stat_user_indexes` and query plans after traffic, then remove redundant single-column indexes only with evidence. |
| Indexes | `TicketReservation(orderId)` and the unique `TicketReservation(orderId)` backing index are redundant with each other. | Extra write/storage overhead on reservation writes. This predates P1.10 and was not introduced by the composite-index slice. | Evaluate removing the non-unique `TicketReservation(orderId)` index in a later DB hygiene slice if no query plan depends on it. |
| Indexes | On small datasets PostgreSQL may still prefer sequential scans, and competing valid indexes can be chosen depending on data distribution. | Developers may misread local plans as proof that indexes are unused or overfit future indexes around tiny data. | Use representative production/staging data and plain `EXPLAIN` before adding/removing future indexes; reserve `EXPLAIN ANALYZE` for safe/dev datasets. |
| Request-time cleanup | Stale pending cleanup runs from normal reads. | Read latency and write amplification increase with traffic. | Move broad cleanup to a worker/cron; keep checkout-local cleanup authoritative. |

## API, Observability, And Operations

| Area | Issue | Risk | Suggested Follow-Up |
| --- | --- | --- | --- |
| API errors | Error shapes and tenant-disclosure behavior are not fully standardized across routes. | Clients handle errors inconsistently and some object existence signals may differ. | Centralize domain error mapping and disclosure rules. |
| Logging | Logging is mostly `console.*` with inconsistent payloads. | Harder incident triage, redaction assurance, metrics, and alerting. | Add structured logger with redaction policy. |
| Metrics/alerts | Compensation has a structured console alert, but there is still no first-class metrics or alerting for webhook failures, email retry exhaustion, checkout failures, or rate-limit abuse. | Operators may miss high-severity incidents unless logs are actively watched. | Add counters/timers and alerts for webhook signature failures, email retry exhaustion, checkout failures, and abuse spikes. |
| CI/CD | No visible CI/CD pipeline, deployment healthcheck, backup/restore, or migration rollback process. | Production changes rely on manual validation and migration safety is harder to guarantee. | Add CI stages, app health endpoint, backup/restore runbook, and migration deployment job. |
| Dependencies | Some package versions use `latest`. | Future installs/upgrades can drift unexpectedly despite lockfile protection. | Pin explicit ranges and add Renovate/Dependabot with CI. |
| Architecture | Route handlers still combine transport, auth, validation, persistence, external I/O, and domain decisions. | Complex changes are harder to review safely. | Extract small domain use-case services incrementally after production blockers. |

## Documentation Notes

- [[Stripe Payments and Connect]] documents current payment, compensation, reservation, and email behavior.
- [[Database and Multi Tenancy]] documents the order compensation fields and tenancy rules.
- `docs/production-readiness-remediation-plan.md` remains the broader remediation roadmap.
