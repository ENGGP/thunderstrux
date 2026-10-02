---
status: living
last-reviewed: 2026-10-02
owner: engineering
---

# Engineering Delivery Workflow

This is the minimum delivery workflow for a solo-maintained startup. Keep routine work lightweight, but do not weaken tenant, authentication, payment, data, migration, or production safety. All changes still reach protected `main` through a focused pull request with passing checks on its latest head.

## 1. Start From Known State

1. Read [[Current Handover]], the issue register, the PRD, and only the living references relevant to the change. Inspect current code, schema, configuration, tests, and hosted state where relevant; documentation does not override them.
2. Run `git status`, preserve unrelated work, fetch and prune `origin`, and create `codex/<focused-description>` from current `origin/main`. Use a separate worktree when the current checkout contains unrelated changes. Never stash, reset, overwrite, or carry user work implicitly.
3. Write a short acceptance note covering:

   - the required outcome and exclusions
   - the risk level from the table below
   - the tests required by the risk table below
   - rollout and rollback only when behavior, data, providers, or operations change

For small documentation or UI corrections, this can be a few lines in the working notes or PR. For high-risk work, trace input, authentication, live permission, canonical tenant ownership, validation, concurrency, provider calls, workers, output, rollout, and recovery before editing.

## 2. Implement The Smallest Complete Change

- Keep the diff focused and preserve existing response contracts, guard ordering, tenant concealment, idempotency, and transaction boundaries unless the accepted change requires otherwise.
- Keep protected routes responsible for transport and security checks. Put domain transactions, persistence, recovery, and provider composition in application services.
- For a defect, add a failing reproducer when practical, make the narrowest justified fix, and retain regression coverage. Document why when a reproducer is unsafe or impractical.
- Prefer additive migrations. Audit existing data, verify a backup for non-disposable data, test the full migration chain, and document release/rollback compatibility.
- Do not widen the task for unrelated findings. Record a confirmed non-blocking issue in [[Non-Blocking Issue Register]] with impact, evidence, and next action.
- Never commit secrets, generated caches, local Obsidian workspace state, test artifacts, or unrelated changes.

## 3. Validate By Risk

Always run `git diff --check`. Run `pnpm docs:check` when documentation changes.

| Risk level | Typical changes | Minimum local validation |
| --- | --- | --- |
| Low | Documentation, copy, or isolated styling | Documentation checker when applicable, focused review/test, and stale-claim or responsive review as relevant |
| Standard | UI behavior, ordinary API/domain logic, or contained refactoring | Focused tests, relevant denial cases, typecheck, production build, and affected integration/browser coverage |
| High | Auth, tenancy, security, payments, workers, schema/data, dependencies, or operations | Standard checks plus the applicable full integration/E2E suite, concurrency/idempotency/failure tests, migration/integrity/backup checks, audit, provider campaign, or operations rehearsal |

Integration tests may reset only a disposable database whose name contains `_test`. Test infrastructure must use run-owned projects, ports, containers, networks, and volumes. Payment-path work must follow [[E2E and Staging Payments]] and distinguish synthetic checks, observed provider evidence, and user attestation.

## 4. Self-Review And Pull Request

1. Review the changed files and the diff against `origin/main`. Check generated artifacts, schema and lockfile changes, tenant boundaries, error disclosure, and rollback implications relevant to the change.
2. As the sole maintainer, perform a deliberate second-pass self-review after implementation. Obtain independent review for authentication, tenancy, payments, schema/data migration, security, production operations, or broad architecture changes before production activation. Routine docs and low-risk UI changes do not require a separate reviewer.
3. Make cohesive commits, push the branch, and open a PR to protected `main`. Keep the PR description proportional: outcome, risk, tests, and any migration, rollout, rollback, screenshot, external activation, or known limitation that applies.
4. Required checks on the latest PR head are `static-validation`, `integration-tests`, `production-build`, `e2e-tests`, and `operations-tests`. After every push, wait for fresh results. Do not weaken tests or branch protection to obtain green status.

## 5. Clean Up, Merge, And Record

After all latest-head GitHub checks pass and the PR is otherwise ready to merge:

1. Complete repository-provided cleanup for every local E2E, staging-payment, or operations run. For E2E runs, use `pnpm test:e2e:cleanup -- <run-id>` and confirm the run-owned containers, network, and disposable database volume were removed.
2. Remove only task-owned temporary files, test output, and generated caches that are no longer in use. Verify exact paths before removal. A local `.next` or `.next-build` cache may be cleared after its server/build process has stopped.
3. Never blanket-delete `tmp/`, Docker volumes, or shared caches. Preserve backup archives, operations evidence needed for the PR, failed-run recovery manifests until recovery succeeds, development database/Redis volumes, dependency caches, user files, and resources not owned by the run.
4. Confirm `git status` contains only intended tracked changes and no generated artifacts. Record cleanup success or retained recovery resources in the PR.
5. Merge only the reviewed latest green head. Verify the merge is contained in `main` before deleting the branch or worktree.

Update [[Current Handover]] only when the work changes behavior, operations, release state, material risk/evidence, or the next safe action. A routine documentation or low-risk UI PR does not need handover churn when the PR itself is sufficient. Update the relevant living reference and issue register whenever their current claims or risk status change.

If work stops while incomplete, leave one compact note containing the branch/PR, HEAD, dirty files, completed checks, remaining work or blocker, retained resources, and exact next action.
