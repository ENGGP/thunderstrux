---
status: living
last-reviewed: 2026-09-29
owner: engineering
---

# Engineering Delivery Workflow

This is the required delivery procedure for code and documentation changes. Scale validation to risk, while keeping the branch, review, latest-head CI, and handover requirements for every change.

## 1. Establish State And Acceptance

1. Read [[Documentation Index]], [[Current Handover]], this workflow, the issue register, the PRD, and the living references for the affected subsystem.
2. Inspect the actual code, schema, migrations, Docker configuration, package scripts, tests, CI, open PRs, and hosted state where relevant. Do not rely on a historical handover as current truth.
3. Inspect `git status`, preserve unrelated user work, then fetch and prune the remote. If dirty files belong to the requested task, continue deliberately; otherwise create a separate worktree from current `origin/main` or pause and document the conflict. Never stash, reset, overwrite, or carry user work onto a new branch implicitly. Start `codex/<focused-description>` from current `origin/main` and use fast-forward operations.
4. Trace the affected path end to end: input, authentication, live permission, canonical tenant ownership, validation, transaction/concurrency boundary, provider calls, workers, output, UI, migration, rollout, and recovery.
5. Write acceptance criteria and classify the risk: documentation, UI, API/domain, schema/data, authentication/tenancy, payment/provider, dependency, or operations.
6. Define compatibility, rollout, rollback, monitoring, and evidence before implementation. Payment, authentication, tenancy, schema, security, operations, or broad architecture work requires independent review.

## 2. Implement In Reviewable Steps

- Keep the change focused. Preserve route guard ordering, response contracts, tenant concealment, idempotency, transaction boundaries, and current-state fields unless the accepted plan changes them.
- Keep protected route handlers as transport adapters. Put domain persistence, recovery, provider composition, and transaction logic behind existing application services.
- For a confirmed defect, add a failing reproducer when practical, apply the smallest justified fix, and retain a regression test. If a reproducer is unsafe or impractical, document the reason and substitute direct verification.
- Add tests when existing coverage does not prove the new behavior. Prefer behavior, boundary, failure, and regression coverage over tests that restate implementation details.
- Use additive migrations where possible. Audit existing data first, verify a backup for non-disposable data, test the full migration chain, and document old/new application and worker compatibility.
- When an unrelated issue appears, fix it only if it blocks or invalidates the requested work. Otherwise add it to the issue register with impact, evidence, workaround, and next action.
- Make cohesive commits with imperative subjects. Never commit secrets, generated caches, local Obsidian workspace state, test artifacts, or unrelated user changes.

## 3. Validation Matrix

Always run `pnpm docs:check` when documentation changes and `git diff --check` before push.

| Change class | Minimum local validation |
| --- | --- |
| Documentation only | Documentation checker, link/content review, stale-claim search, runner test for checker changes |
| UI | Focused tests, `pnpm typecheck`, `pnpm build`, affected browser E2E, responsive and screenshot review |
| API/domain | Focused and full integration tests, denial/cross-tenant cases, typecheck, production build |
| Schema/data | Integrity preflight, disposable full migration chain, direct invalid-write tests, backup/restore and compatibility review |
| Authentication/tenancy/security | Allowed and denied roles, live revocation, cross-tenant non-disclosure, CSRF/origin, rate-limit and session tests |
| Payments/email/workers | Idempotency, duplicate/reordered replay, stale/late state, fencing, rollback, signed webhook E2E, provider campaign when required |
| Docker/operations | Production image, non-root runtime, one-shot migration, readiness failures, backup/restore and rollback rehearsal |
| Dependencies | Frozen install, lockfile stability, audit, compatibility tests, build, all required CI |

Integration tests must use a disposable database whose name contains `_test`. Use run-owned Docker projects, ports, containers, networks, and volumes; remove only resources owned by the run. Never point a test runner at development or production data.

For payment-path changes, follow [[E2E and Staging Payments]]. Correlate provider delivery with local order, ticket, inventory, lifecycle, refund, and outbox state. Separate observed evidence from user attestation and synthetic events. Never expose secrets or raw provider payloads.

## 4. Self-Review And Pull Request

1. Review changed files, generated artifacts, schema/lockfile changes, documentation, `git diff --check`, and the diff against `origin/main`.
2. Give high-risk or broad changes to an independent reviewer. Resolve concrete findings and record consciously accepted limitations.
3. Push the feature branch and open a PR to protected `main` using the repository template. Include scope, risk, contracts preserved, tests, migration/data impact, rollout, rollback, screenshots, external activation, and known limitations.
4. Check the latest PR head after every push. Required checks are `static-validation`, `integration-tests`, `production-build`, `e2e-tests`, and `operations-tests`. Earlier green commits do not qualify the latest head.
5. Investigate failures from logs, reproduce locally when practical, fix narrowly, push, and wait for fresh checks. Do not weaken tests or branch protection to obtain green status.
6. Complete required review before merge. GitHub reporting a branch as mergeable is not acceptance by itself.

## 5. Handover, Merge, And Cleanup

- Before ending material work, update [[Current Handover]] with branch/PR, exact completed work, evidence, failures, remaining risks, cleanup state, and the next safe command or action.
- Add or update the dated handover/evidence ledger for a material workstream. Distinguish repository implementation from production activation.
- After merge, verify current `main` and post-merge checks when required. Delete a branch only after confirming its PR is merged and its commits are contained in `main`.
- Do not delete backup archives, shared Docker volumes, untracked user files, or historical Git objects as incidental cleanup.

### Interrupted Or Usage-Limited Session

Record the current branch, HEAD, dirty files, commits, PR/check state, completed and uncompleted acceptance criteria, commands and outcomes, discovered defects, external resources, cleanup state, and the exact next action. A later agent must verify current GitHub and workspace state instead of assuming the snapshot is unchanged.

## GitHub Desktop Option

GitHub Desktop may be used to fetch, create the branch from `main`, review the file list and diff, commit, push, open the PR, and delete a verified merged branch. Before committing, exclude unrelated files such as `docs/obsidian/.obsidian/workspace.json`. Use terminal commands and GitHub check logs for diagnostics, test execution, exact ancestry, and recovery. Desktop does not replace branch protection, latest-head CI, review, or the handover.
