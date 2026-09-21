# Engineering Delivery Workflow

Use this workflow for the next remediation slice. Scale validation to the change: a documentation-only PR needs link/diff review and its required CI checks, while payment, auth, data, or operations changes need the full relevant acceptance path. [[Current Handover]] records the current repository state; [[Development Workflow]] has local commands and Docker setup.

## Establish State And Scope

1. Read the entire remediation plan, the latest dated handover, this workflow, and the relevant architecture/runbook notes. Confirm the requested slice and its acceptance criteria against the actual code, schema, routes, tests, Docker/CI configuration, and open issue register. Do not treat old handovers as current product truth.
2. Inspect `git status`, current branch, `origin/main`, open PRs, and required checks. Preserve unrelated user changes. Start a focused branch from refreshed `main` unless an explicitly stacked PR is necessary.
3. Trace the affected path end to end, including authentication, permission, canonical tenant ownership, transaction and concurrency boundaries, provider calls, worker behavior, UI states, and deployment/migration consequences. Record existing contracts that must not change.
4. Write a short, reviewable implementation and validation plan. For high-risk slices, seek an independent review and incorporate concrete findings; do not manufacture objections or widen scope without a reason.

## Implement In Verifiable Steps

1. Keep route handlers thin and follow existing application-service ownership. Preserve guard ordering, status codes, response shapes, and current-state fields. Use active database staff authority, not member join rows or JWT claims, for management permissions.
2. For schema changes, make the migration additive where possible; test a fresh migrate/generate path and compatibility with the previous application release. Do not backfill history with invented events. For payment or email changes, document rollout order and old/new worker compatibility.
3. Add focused regression tests alongside each behavior change. Cover success, denial, cross-tenant access, idempotency, replay, stale/late state, and transaction rollback where relevant. When feasible, demonstrate a discovered defect with a failing reproducer before fixing it; always verify the regression after the fix.
4. When validation exposes a bug, identify whether it is in product code, test isolation, fixture setup, or infrastructure. Make the smallest justified fix, rerun the focused reproducer, then rerun affected suites. Record unresolved issues in [[Non-Blocking Issue Register]] with impact and next action.

## Validate With Disposable Infrastructure

1. Use an isolated PostgreSQL database whose name contains `_test` for integration tests. Never reset the development or production database for testing. Use run-owned Docker projects, ports, containers, and volumes; clean only resources owned by the run.
2. For application changes, run fresh Prisma migration/generation where relevant, `pnpm typecheck`, integration tests, `pnpm build`, and `pnpm audit --audit-level high`. Run browser/signed-webhook tests for affected flows and `pnpm ops:test` for deployment, backup, rollback, migration, or readiness work. Inspect screenshots and responsive layouts for UI changes.
3. Payment-path changes also need real Stripe test-mode success, decline, cancellation, and expiry/reconciliation evidence when the documented campaign applies. Correlate provider event delivery, local order/ticket/inventory/outbox state, and cleanup. Record what was observed separately from what was user-attested; do not claim natural timeout or email-provider delivery from synthetic evidence. Never paste secrets or raw payment payloads into logs or docs. See [[E2E and Staging Payments]].
4. Before migrating a non-disposable local database, make and verify a restorable backup. Rehearse restore/rollback against an isolated target; do not confuse a passing local rehearsal with production monitoring, off-machine backups, or hosted recovery.
5. Review `git diff --check`, changed files, generated artifacts, and documentation for stale claims. Keep implementation and evidence commits separable when useful.

## Pull Request And Handover

1. Push the feature branch and open a PR to `main` with scope, contracts preserved, migration/rollback notes, tests, evidence, and known limitations. Protected `main` is not a direct-push target.
2. Check **the latest PR head** after every push. Require all repository-mandated checks to pass, including static validation, integration, production build, browser E2E, and operations validation when configured. Investigate a failing check from its logs, reproduce locally, fix narrowly, push, and wait for fresh checks. Do not rely on green checks from an earlier commit.
3. Complete review before merge. Do not merge solely because local tests passed or GitHub says mergeable. Use the repository's protected-branch PR process; preserve reviewable commits. Keep a documentation-only follow-up PR separate when it records post-merge evidence.
4. Update [[Current Handover]] and a dated handover with merged/open PR status, exact evidence, fixed bugs, remaining risks, cleanup state, and the next safe action. Distinguish repository implementation from deployment activation. Do not delete backup archives, untracked user files, shared Docker volumes, or historical Git objects as incidental cleanup.

## Recent Defect Examples

- P2.16: a hard-coded localhost sign-out target broke isolated staging-port behavior; use the current site's root and test logout on the isolated port.
- P2.17: the operations CI runner inherited an unintended database environment; isolate its disposable database and verify the operations job itself, not just local tests.
- P3.18: Windows checkout changed `docker/entrypoint.sh` line endings; enforce LF via `.gitattributes` and rerun container startup/operations validation.
- P3.19: concurrent webhook replay exposed PostgreSQL `40001` through Prisma `P2010`, not only `P2034`; retry only recognized serialization/deadlock conflicts around the whole transaction, then rerun HTTP and integration concurrency tests. Review also caught an inaccurate compensation reservation after-state; read the actual reconciled result and test it. Keep browser screenshot evidence outside directories that the runner cleans between phases.

These are examples of the process, not a claim that all future bugs follow these patterns. See [[Handover 2026-09-21 P3.19 Delivery]] for P3.19 evidence and outstanding work.
