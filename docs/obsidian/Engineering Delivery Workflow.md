---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Development Workflow]]", "[[Issue and Defect Register]]"]
sources: [AGENTS.md, package.json]
---

# Engineering Delivery Workflow

**Owns:** how a change is branched, validated by risk, reviewed, cleaned up and merged.
**Read when:** before you validate or deliver any change.
**Not here:** how to run the commands ([[Development Workflow]], [[E2E and Staging Payments]]); open risks ([[Issue and Defect Register]]).

This is the minimum delivery workflow for a solo-maintained startup. Keep routine work lightweight while preserving tenant, authentication, payment, data, migration, and production safety. Deliver changes through a focused pull request to protected `main`, supported by proportionate local validation. GitHub test checks are not required for merge; test workflows are available for optional manual dispatch.

## 1. Start From Known State

1. Read [[Project Handover]], the issue register, the PRD, and only the living references relevant to the change. Inspect current code, schema, configuration, tests, and hosted state where relevant; documentation does not override them.
2. Run `git status` and preserve unrelated work. Switch to `main`, fetch and prune `origin`, then fast-forward local `main` to `origin/main` with `git merge --ff-only origin/main`. Confirm you are on the updated `main`, then create and switch to `codex/<focused-description>` with `git switch -c codex/<focused-description>`. Work in the primary repository folder on that branch. If unrelated changes prevent switching or updating safely, resolve that first with the user. Never stash, reset, overwrite, or carry user work implicitly.
3. Write a short acceptance note covering:

   - the required outcome and exclusions
   - the risk level from the table below
   - the tests required by the risk table below
   - rollout and rollback only when behavior, data, providers, or operations change

For small documentation or UI corrections, this can be a few lines in the working notes or PR. For high-risk work, trace input, authentication, live permission, canonical tenant ownership, validation, concurrency, provider calls, workers, output, rollout, and recovery before editing.

Keep execution and reporting concise: read relevant references once, use targeted searches and bounded output, batch independent reads, and keep acceptance/evidence in the PR rather than creating duplicate planning documents. Report outcomes and remaining blockers; do not repeatedly poll optional GitHub checks or expand scope without a concrete reason.

## 2. Implement The Smallest Complete Change

- Keep the diff focused and preserve existing response contracts, guard ordering, tenant concealment, idempotency, and transaction boundaries unless the accepted change requires otherwise.
- Keep protected routes responsible for transport and security checks. Put domain transactions, persistence, recovery, and provider composition in application services.
- For a defect, add a failing reproducer when practical, make the narrowest justified fix, and retain regression coverage. Document why when a reproducer is unsafe or impractical.
- Prefer additive migrations. Audit existing data, verify a backup for non-disposable data, test the full migration chain, and document release/rollback compatibility.
- Do not widen the task for unrelated findings. Record a confirmed non-blocking issue in [[Issue and Defect Register]] with impact, evidence, and next action.
- Never commit secrets, generated caches, local Obsidian workspace state, test artifacts, or unrelated changes.

## 3. Validate By Risk

Always run `git diff --check`. Run `pnpm docs:check` when documentation changes. Select checks from the actual diff and affected dependencies; do not run every suite for every change.

| Risk level | Typical changes | Minimum local validation |
| --- | --- | --- |
| Documentation only | Markdown, prose, links, or agent instructions without executable/configuration changes | Docs checker, diff check, and review of links and current claims. No typecheck, build, integration, browser, operations, or other functionality tests |
| Low | Copy or isolated styling | Focused visual/accessibility review; affected component/browser check only when interaction or layout risk warrants it |
| Standard | UI behavior, ordinary API/domain logic, or contained refactoring | Focused regression and relevant denial cases, typecheck; production build for build/rendering/import changes, affected integration/browser coverage where behavior crosses those boundaries |
| High | Auth, tenancy, security, payments, workers, schema/data, dependencies, or operations | Relevant Standard checks plus affected failure/concurrency/idempotency coverage. Full integration for shared domain/security/schema/runtime dependency changes; full E2E for shared authentication/checkout/navigation changes, and for a browser test tool update (Playwright, axe), because it changes what the campaign checks (DEF-046). Migration/integrity/restore, audit/image scan, provider campaign, or operations rehearsal only for the corresponding changed boundary |

Use the existing local entrypoints; do not rewrite tests merely to move execution off GitHub:

| Local command | Purpose / when to use |
| --- | --- |
| `node scripts/check-docs.mjs` | Same as `pnpm docs:check`; no Docker startup needed |
| `node scripts/run-e2e.mjs baseline` | Isolated Docker production build, typecheck, full integration and dependency audit when that combined coverage is required |
| `pnpm test:integration` | Integration suite inside a disposable Docker environment with `INTEGRATION_DATABASE_URL` pointing to its run-owned database |
| `pnpm test:e2e` | One complete isolated production-mode browser and signed-webhook run |
| `pnpm test:e2e:guards` | Runner safety and schema-contract tests (the baseline runs them first); run alone when test infrastructure or its guards change |
| `pnpm ops:test` | Disposable migration/deploy/backup/restore/rollback rehearsal for operational or schema/recovery changes |

See [[Development Workflow]] for Docker setup and [[Dependency Automation]] for frozen installation, audit and container validation when dependencies or container configuration change. Baseline and E2E already build the app; reuse that build evidence when the relevant inputs match rather than building it again.

One successful applicable run is sufficient. Repeat only after a failure/fix, relevant executable/test/configuration/dependency changes, or a documented flaky/concurrency concern. Diagnose failures rather than rerunning until green. There is no routine three-run qualification requirement or duplicate local/GitHub campaign. Documentation-only follow-up commits preserve earlier functionality evidence. After a base update, review its diff and rerun only checks whose inputs or tested behavior changed.

Record the tested commit, commands, outcome/counts, run IDs and cleanup in the PR. Tie evidence to the reviewed executable, tests, schema, lockfile and configuration; explain any later changes and why earlier results still apply. A skipped or failed applicable check remains a blocker until resolved or explicitly accepted by the maintainer with impact and follow-up recorded. Real provider acceptance and independent production review remain separate release gates.

Integration tests may reset only a run-owned disposable database whose simple name ends in `_test`; the name alone does not establish disposability. Test infrastructure must use run-owned projects, ports, containers, networks, and volumes. Payment-path work must follow [[E2E and Staging Payments]] and distinguish synthetic checks, observed provider evidence, and user attestation.

## 4. Self-Review And Pull Request

1. Review the changed files and the diff against `origin/main`. Check generated artifacts, schema and lockfile changes, tenant boundaries, error disclosure, and rollback implications relevant to the change.
2. As the sole maintainer, perform a deliberate second-pass self-review after implementation. Obtain independent review for authentication, tenancy, payments, schema/data migration, security, production operations, or broad architecture changes before production activation. Routine docs and low-risk UI changes do not require a separate reviewer.
3. Make cohesive commits, push the branch, and open a PR to protected `main`. Keep the PR description proportional: outcome, risk, tests, and any migration, rollout, rollback, screenshot, external activation, or known limitation that applies.
4. Confirm the risk-appropriate local validation passed and its evidence covers the final diff. GitHub status checks are optional and do not replace local evidence. Review any optional CI failure that applies to this change. Do not weaken assertions or safety guards to obtain a passing result.

## 5. Clean Up, Merge, And Record

After applicable local validation and review are complete and the PR is ready to merge:

1. Complete repository-provided cleanup for every local E2E, staging-payment, or operations run. For E2E runs, use `pnpm test:e2e:cleanup -- <run-id>` and confirm the run-owned containers, network, and disposable database volume were removed.
2. Remove only task-owned temporary files, test output, and generated caches that are no longer in use. Verify exact paths before removal. A local `.next` or `.next-build` cache may be cleared after its server/build process has stopped.
3. Never blanket-delete `tmp/`, Docker volumes, or shared caches. Preserve backup archives, operations evidence needed for the PR, failed-run recovery manifests until recovery succeeds, development database/Redis volumes, dependency caches, user files, and resources not owned by the run.
4. Confirm `git status` contains only intended tracked changes and no generated artifacts. Record cleanup success or retained recovery resources in the PR.
5. Merge only the reviewed head covered by the recorded local evidence. Switch to local `main`, fetch `origin`, and fast-forward with `git merge --ff-only origin/main`. Then remove the completed branch as step 6 describes.
6. **Branch and worktree hygiene.** PRs are squash-merged, so a merged branch's commits are never ancestors of `main`, and `git branch --merged` can't tell merged work from unmerged work.
   - Delete a local branch only when `gh pr view <number> --json state,headRefOid` shows `MERGED` and the PR's head equals the branch tip. Check it in the same command as the delete, so a PR that is still open is never closed by removing its branch. A branch with no PR, or whose tip moved after the PR, is unmerged work: keep it, or ask its owner.
   - GitHub deletes a PR's branch when it merges; after `git fetch --prune`, delete a remaining remote branch only under the same check. Leave bot branches (Renovate) with open PRs alone.
   - Never delete a branch that is checked out, and never switch another session's checkout or the folder the dev app serves from. Switching the dev folder to newer code can load features ahead of their migrations.
   - Remove a worktree you made with `git worktree remove` once it is clean, never with `--force` over changes. Leave worktrees the desktop app made for sessions to the app's own cleanup.
   - When several sessions share a clone, each works in its own worktree (`git worktree add ../<name> -b codex/<task> origin/main`) and checks `git worktree list` first, so no session commits on another's checked-out branch.

Update [[Project Handover]] only when the work changes behavior, operations, release state, material risk/evidence, or the next safe action. A routine documentation or low-risk UI PR does not need handover churn when the PR itself is sufficient. Update the relevant living reference and issue register whenever their current claims or risk status change.

If work stops while incomplete, leave one compact note containing the branch/PR, HEAD, dirty files, completed checks, remaining work or blocker, retained resources, and exact next action.
