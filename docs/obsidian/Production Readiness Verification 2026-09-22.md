# Production Readiness Verification — 2026-09-22

This is the current evidence ledger for all 19 items in [[../production-readiness-remediation-plan]]. It separates repository behavior from live production activation. A passing local test is not evidence that a hosted scheduler, alert route, backup, or Stripe delivery is active.

| Item | Repository evidence and result | Remaining release gate |
| --- | --- | --- |
| P0.1 Rate limiting | `lib/security/rate-limit.ts` uses Redis policies; `rate-limit.test.ts` covers login, signup, checkout, resend, organisation, attendance, and Connect denial. | Configure trusted proxy headers at the edge; replace or independently validate custom Redis transport before high-risk scale. |
| P0.2 CSRF/origin | This branch fails closed on missing or malformed origin, guards signup, redacts rejected header logs, and binds CSRF tokens to the Auth.js session cookie; isolated browser and signed webhook tests pass. | Deploy with exact `NEXT_PUBLIC_APP_URL`/`TRUSTED_APP_ORIGINS`; retest authenticated mutations on hosted origin. |
| P0.3 Public reads | `lib/events/public-events.ts` and integration tests keep discovery read-only; seed owns demo creation. | Confirm production seed policy. |
| P0.4 Payment compensation | Reconciliation persists compensation review and emits an urgent structured event; replay and mismatch tests cover no duplicate fulfilment. | Route the event to paging and execute the operator refund/review playbook below. No automatic Stripe refund exists. |
| P0.5 Email outbox | Transactional enqueue, fenced worker, retry/exhaustion, and idempotency are tested. This branch adds authenticated, audited requeue of terminal failed jobs. | Schedule the worker every minute; monitor due/stale/failed jobs and verify provider acceptance before requeue. |
| P1.6 Pagination | Bounded cursor pages exist for orders, tickets, and discovery; same-timestamp tests pass. | Inspect plans on representative production data. |
| P1.7 Availability | Public detail subtracts active unexpired reservations; checkout remains authoritative. | None for the documented MVP contract. |
| P1.8 DB constraints | Numeric, event-time, paid, and expired constraints exist. This branch adds `failed => failedAt` and a direct invalid-write regression. | Run integrity audit and verified backup before migration; migration intentionally stops on legacy invalid rows. Cross-row mismatches remain audit-only. |
| P1.9 Ownership | Runtime reads/cleanup use `Event.organisationId`. This branch audits drift and adds a dry-run, event-based repair tool with mismatch refusal and idempotence tests. | Run audit on a production copy, review each mismatch, back up, then apply repair in a controlled window. Cross-row consistency is not a database constraint. |
| P1.10 Indexes | Composite indexes match documented bounded reads and cleanup. | Review `EXPLAIN`/index usage with production-scale data before removing overlaps. |
| P1.11 API errors | Reviewed tenant resource routes use safe 404 behavior with tests. | Central route error mapper and remaining endpoint survey are open. |
| P1.12 Stale cleanup | Bounded worker and narrow checkout cleanup are tested; read paths avoid broad writes. The scheduled worker also deletes expired MFA grants in bounded batches. | Schedule worker every minute and monitor both stale-order and expired-grant backlog. |
| P1.13 Logs/metrics/alerts | Structured, redacted JSON and log-derived metrics exist for covered paths. | External aggregation, dashboards, alert transport, health and migration alerts remain unconfigured. |
| P2.14 Staff accounts | Named staff, roles, invites, live revocation, and initial audit entries exist. This branch adds encrypted TOTP, one-time recovery codes, 12-hour login-bound grants, live management guards, staged enrollment, legacy-session reauthentication, user-bound brute-force limits, and bounded expired-grant cleanup. Enforced browser/HTTP evidence passes. | Enroll every named staff and legacy owner, then set `MFA_ENFORCEMENT_MODE=enforce`. Full sensitive-action audit coverage and legacy shared-login retirement remain open. |
| P2.15 Dependencies | Versions pinned, Renovate controlled update merged, high-severity audit passes locally. | Next real eligible security PR and maintainer notification receipt cannot be manufactured. |
| P2.16 E2E/staging | Isolated browser and signed HTTP webhook suites pass. Prior real Stripe campaign is documented in [[E2E and Staging Payments]]. | Repeat real Stripe test-mode campaign after payment-path changes; this branch does not claim a new real-provider run. |
| P2.17 Operations | CI, one-shot migrations, health/readiness, non-root image, backup/restore and rollback rehearsal exist. | Activate production hosting, schedules, encrypted off-machine backup, external monitoring, and hosted restore drill. |
| P3.18 Domain services | Checkout, events, order operations, attendance and Connect service boundaries are checked by integration tests. | Keep new route adapters thin during future changes. |
| P3.19 Lifecycle | Append-only per-order events cover payment, compensation, refund flag, and email worker; concurrency/fencing tests pass. | Drain old workers during rollout; historical orders are explicitly incomplete. |

## Release decision

**Production payments and broad staff rollout remain blocked.** The enforced MFA browser run passes, but MFA must still be activated for all staff and legacy owners. Sensitive-action audit coverage is incomplete. The production environment also needs active worker schedules, alert delivery, off-machine backups, and a hosted restore drill. Resolve these gates and rerun the relevant Docker, staging Stripe, and latest-head CI acceptance before launch.

## Final local acceptance

- `pnpm typecheck`: passed.
- `pnpm security:audit`: passed with no known vulnerabilities.
- Docker integration suite: 27 files and 231 tests passed against a freshly migrated `_test` database.
- Isolated production E2E run `p216-9dbe96c64a57db34477ce07d`: 2 enforced-MFA tests, 9 desktop/mobile tests, and 6 signed-webhook tests passed; its containers, network, and database volume were removed.
- `pnpm test:e2e:guards`: 13 runner-safety tests passed.
- Final operations rehearsal `p217-ci-5419aa0686`: production image build, 25 migrations, non-root deployment, readiness outage checks, checksum backup/restore, compatibility-gated rollback, and cleanup passed.
- Final reviewer found no remaining PR blocker after the dry-run grant-cleanup regression was added.

## Staff MFA rollout

1. Deploy the additive MFA migration and set a separate, backed-up 32-byte base64 `MFA_ENCRYPTION_KEY`. Enable Redis-backed rate limiting. Readiness fails in `enroll` or `enforce` mode if either is missing; production requires an explicit MFA mode value.
2. Set `MFA_ENFORCEMENT_MODE=enroll`. Direct every active staff member and legacy owner to `/mfa` to enroll an authenticator and save the ten one-time recovery codes. Existing sessions for enrolled users require a fresh challenge.
3. Verify every active management identity has `UserMfa.enabledAt` and an owner can recover with a single-use code in a disposable/staging account. Preserve the encryption key in the secret backup; losing it makes enrolled secrets and recovery hashes unusable. Key rotation is not yet implemented.
4. Set `MFA_ENFORCEMENT_MODE=enforce`. Confirm password-only sessions, direct management links, Stripe Connect, and management mutations are denied until verification. A grant is bound to a random Auth.js login ID in the signed session and expires after 12 hours; cookie refresh preserves the grant, while a new login needs a new challenge. Revocation still uses live staff authority.
5. If a rollout fault requires a temporary downgrade, set `enroll` with an incident record and restore `enforce` after repair. Do not launch unrestricted production payments while enforcement is downgraded.

## Compensation review playbook

1. Page on `paid_but_unfulfilled_compensation_required`. Locate the order and Stripe Checkout Session IDs in the structured event and open the tenant-scoped order timeline.
2. Verify payment status and amount in Stripe, the order's `requiresCompensationReview`, ticket count, reservation state, and any previous refund. Do not infer payment truth from the local manual-refund flag.
3. If the existing reservation is still active and the documented reconciliation preconditions hold, replay the verified signed event once and inspect the resulting lifecycle. Otherwise arrange a Stripe refund through the provider console and contact the buyer; record the provider refund ID in the incident record.
4. Mark local manual refund bookkeeping only after provider refund confirmation. Confirm duplicate webhook delivery did not issue tickets or enqueue email. Keep the incident open until buyer communication and financial reconciliation are complete.

## Failed email recovery

1. Page on `email_outbox_retry_exhausted`; identify the order and job. Check the buyer's ticket wallet, current order state, and the provider's message/idempotency record for `ticket-email/<job-id>`.
2. Fix the provider/environment cause first. A failed local finalization can follow provider acceptance; if provider acceptance is uncertain, investigate before retry to avoid duplicate delivery.
3. An authenticated staff member with `orders:email_resend` can call `POST /api/orders/<order-id>/email-jobs/<job-id>/requeue` with JSON `{"reason":"<review reason>"}`, trusted origin, and session CSRF header. The route requires canonical event ownership and records the session actor in `AuditLog` and the order lifecycle.
4. Run the scheduled worker, then verify `sentAt`, provider message ID, order email timestamp, and the lifecycle event. A second requeue returns conflict.

## Ownership repair

Run `pnpm db:integrity:audit` and `pnpm db:organisation-drift:repair` (dry run) against the target database. Review any relationship mismatch first. After a verified backup and change approval, run `pnpm db:organisation-drift:repair --apply`; rerun the audit and dry run. The repair updates only denormalized organisation IDs from each row's canonical event and refuses event/order relationship inconsistencies.
