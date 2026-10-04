# Production Readiness Verification — 2026-09-22

This is the current evidence ledger for all 19 items in the historical remediation programme, now superseded by [[../MVP_READINESS_PLAN]]. PR #18 merged this repository implementation on 2026-09-28. The ledger separates repository behavior from live production activation. A passing local or CI test is not evidence that a hosted scheduler, alert route, backup, or Stripe delivery is active.

| Item | Repository evidence and result | Remaining release gate |
| --- | --- | --- |
| P0.1 Rate limiting | `lib/security/rate-limit.ts` uses the official Redis client with atomic Lua counters, bounded connection/command behavior, and one explicitly configured trusted proxy header; tests cover policy denial and rejection of proxy chains. | Configure the exact trusted proxy header at the edge and run the Docker/real-Redis suite on the release image. |
| P0.2 CSRF/origin | The merged implementation fails closed on missing or malformed origin, guards signup, redacts rejected header logs, and binds CSRF tokens to the Auth.js session cookie; isolated browser and signed webhook tests pass. | Deploy with exact `NEXT_PUBLIC_APP_URL`/`TRUSTED_APP_ORIGINS`; retest authenticated mutations on hosted origin. |
| P0.3 Public reads | `lib/events/public-events.ts` and integration tests keep discovery read-only; seed owns demo creation. | Confirm production seed policy. |
| P0.4 Payment compensation | Reconciliation transactionally snapshots manual/automatic policy and creates a durable fenced job. The worker performs strict Stripe/local identity checks, uses provider idempotency, reconciles ordered/deduplicated refund webhooks, and supports provider-verified manual confirmation. | Schedule the worker, subscribe refund webhooks, route alerts, and pass a real Stripe test-mode automatic and manual refund campaign before enabling `automatic_full`. |
| P0.5 Email outbox | Transactional enqueue, fenced worker, retry/exhaustion, and idempotency are tested. The merged implementation adds authenticated, audited requeue of terminal failed jobs. | Schedule the worker every minute; monitor due/stale/failed jobs and verify provider acceptance before requeue. |
| P1.6 Pagination | Bounded cursor pages exist for orders, tickets, and discovery; same-timestamp tests pass. | Inspect plans on representative production data. |
| P1.7 Availability | Public detail subtracts active unexpired reservations; checkout remains authoritative. | None for the documented MVP contract. |
| P1.8 DB constraints | Numeric, event-time, paid, expired, and failed-timestamp constraints exist, with direct invalid-write regressions. | Run integrity audit and verified backup before migration; migration intentionally stops on legacy invalid rows. Cross-row mismatches remain audit-only. |
| P1.9 Ownership | Runtime reads/cleanup use `Event.organisationId`. Drift audit and a dry-run, event-based repair tool include mismatch refusal and idempotence tests. | Run audit on a production copy, review each mismatch, back up, then apply repair in a controlled window. Cross-row consistency is not a database constraint. |
| P1.10 Indexes | Composite indexes match documented bounded reads and cleanup. | Review `EXPLAIN`/index usage with production-scale data before removing overlaps. |
| P1.11 API errors | A central typed route error mapper now emits safe structured responses/logs and is used by representative public, order, and compensation routes with focused tests. | Migrate and survey the remaining route families before claiming complete API normalization. |
| P1.12 Stale cleanup | Bounded worker and narrow checkout cleanup are tested; read paths avoid broad writes. The scheduled worker also deletes expired MFA grants in bounded batches. | Schedule worker every minute and monitor both stale-order and expired-grant backlog. |
| P1.13 Logs/metrics/alerts | Structured, redacted JSON and log-derived metrics exist for covered paths. | External aggregation, dashboards, alert transport, health and migration alerts remain unconfigured. |
| P2.14 Staff accounts | Named staff, roles, invites, live revocation, encrypted TOTP, recovery codes, login-bound grants, management guards, staged enforcement, and expired-grant cleanup exist. The MFA migration is now in the readiness contract, `/mfa` has a safe error boundary, event mutations are actor-audited, and an explicit production legacy-access mode can deny the shared-login fallback. | Enroll every staff member, set MFA to `enforce`, set legacy access to `deny` after migration, and finish the sensitive-action audit survey. |
| P2.15 Dependencies | Versions pinned, Renovate controlled update merged, high-severity audit passes locally. | Next real eligible security PR and maintainer notification receipt cannot be manufactured. |
| P2.16 E2E/staging | Isolated browser and signed HTTP webhook suites pass. Prior real Stripe campaign is documented in [[E2E and Staging Payments]]. | Repeat the real Stripe test-mode campaign after the merged compensation changes; no new real-provider run is claimed. |
| P2.17 Operations | CI, one-shot production migrations, schema-aware readiness, non-root image, backup/restore, and rollback rehearsal exist. Development Compose is migration-first; the doctor detects stale containers/config and gives a non-destructive recreation command. | Activate production hosting, schedules, encrypted off-machine backup, external monitoring, and hosted restore drill. |
| P3.18 Domain services | Checkout, events, order operations, attendance and Connect service boundaries are checked by integration tests. | Keep new route adapters thin during future changes. |
| P3.19 Lifecycle | Append-only per-order events cover payment, compensation, refund flag, and email worker; concurrency/fencing tests pass. | Drain old workers during rollout; historical orders are explicitly incomplete. |

## Release decision

**Production payments and broad staff rollout remain blocked.** MFA must be activated for all staff and legacy owners, then legacy access must be denied. Automatic refunds require an active worker schedule, refund webhook subscription, alert delivery, and a real Stripe test-mode campaign. Sensitive-action audit coverage, off-machine backups, a hosted restore drill, and release-image Docker acceptance in the chosen environment remain release gates. PR #18 passed all five latest-head checks; any later release candidate must do the same on its own head.

## Final local acceptance

- `pnpm typecheck`: passed.
- `pnpm security:audit`: passed with no known vulnerabilities.
- Docker integration suite: 27 files and 231 tests passed against a freshly migrated `_test` database.
- Isolated production E2E run `p216-9dbe96c64a57db34477ce07d`: 2 enforced-MFA tests, 9 desktop/mobile tests, and 6 signed-webhook tests passed; its containers, network, and database volume were removed.
- `pnpm test:e2e:guards`: 13 runner-safety tests passed.
- Final operations rehearsal `p217-ci-5419aa0686`: production image build, 25 migrations, non-root deployment, readiness outage checks, checksum backup/restore, compatibility-gated rollback, and cleanup passed.
- Final reviewer found no remaining PR blocker after the dry-run grant-cleanup regression was added.

### 2026-09-27 remediation extension

- A custom-format backup of the development database was created and listed successfully before applying the MFA and failed-order constraint migrations; the failed-order preflight found zero invalid rows.
- All 26 migrations, including `20260927010000_compensation_refunds`, applied in order to an empty disposable PostgreSQL database.
- TypeScript passed after the compensation route, UI, worker, schema contract, official Redis client, legacy-access switch, and audit changes.
- Seventeen runner and schema-contract tests passed when executed directly. The sandbox blocks the aggregate Node/Vitest child-process runner, Docker named-pipe access, registry audit requests, and Prisma binary downloads; those checks must run in Docker/CI before merge.
- The production build compiled successfully; the sandbox then denied Next's post-compile TypeScript worker with `spawn EPERM`.
- Independent review findings were applied: refund correlation now requires exact job/order/amount/currency/PaymentIntent identity and a known non-disputed charge; webhook transitions are lock-fenced and monotonic; missed pending webhooks are polled; compensation orders cannot use unverified legacy refund marking; Redis cold-start connection is shared; unknown API exception messages are redacted. The re-review found no remaining blocker or high-severity issue.
- Live Docker verification found that the existing named dependency volume masked the rebuilt image, causing `@redis/client` resolution failure; replacing only that cache exposed a second missing generated Prisma Client. The recreation helper now handles both conditions. The repaired stack reports 26 current migrations, resolves `@redis/client`, returns `200` from readiness, and redirects unauthenticated `/mfa` to login.

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
