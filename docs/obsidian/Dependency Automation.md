# Dependency Automation

## Current dependency remediation

The D1-D5 dependency fixes were published through [PR #3](https://github.com/ENGGP/thunderstrux/pull/3), merge `b81c631`. The [post-remediation Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35290377481) passed. GitHub reports zero open dependency alerts on 2026-09-18. Versions and compatibility checks are in [[Handover 2026-09-18 Dependency Security Remediation]]. The failed runs/counts below are historical evidence.

## P2.15 status

The original P2.15 integration gate passed locally: 185/185 tests, including 22 Stripe Connect disclosure tests. The four original failures were reproduced on `c8878fe` and fixed separately from dependency infrastructure without weakening their expectations. See the evidence below.

Repository-side P2.15 implementation and evidence are merged through PRs #1-#5, #7, and #8. Renovate is authorized and operational: [Dependency Dashboard #6](https://github.com/ENGGP/thunderstrux/issues/6) proves npm and GitHub Actions discovery with Docker exclusions, and controlled [PR #7](https://github.com/ENGGP/thunderstrux/pull/7) merged as `b3f4fce`. All five post-merge checks passed on `main`. The non-required `renovate/stability-days` status remained pending for this pin update; it was not a failed application test. Overall P2.15 remains **Open - operational evidence pending**: a real eligible high/critical advisory is needed to verify a security-labelled Renovate PR, while maintainer notification receipt must be recorded after the next genuine Security Audit failure, including a registry failure.

## Validation and update policy

- `pnpm typecheck`, `pnpm test` (the existing integration runner), and `pnpm security:audit` are the local entrypoints. `pnpm build` remains the production build command.
- Dependency Validation runs on every PR and push targeting `main` or `master`, plus manual dispatch. The job/check names are `static-validation`, `integration-tests`, and `production-build`.
- Every job installs with the committed pnpm version and `--frozen-lockfile`. Static validation checks lockfile stability, generates Prisma, and typechecks. Integration uses disposable PostgreSQL 16 and `thunderstrux_test`; the runner resets its database and runs sequentially. Never supply an application database URL.
- Test setup supplies fake Stripe credentials; external fetch calls remain blocked. Future event fixtures are relative to the current date.
- Build uses non-secret placeholders matching the Docker builder. Do not build inside the running application container; use a disposable environment or rebuild the image.
- Workflows use read-only repository permissions, SHA-pinned Actions, disabled persisted checkout credentials, job timeouts, and cancellation of superseded runs. pnpm is installed before enabling the Node action's pnpm cache.
- Renovate covers npm and GitHub Actions. Dockerfile and Compose managers are excluded, and a Docker datasource rule also excludes workflow service/container images. All Docker image automation is deferred. Ordinary updates retain Monday scheduling, a three-day release delay, grouped non-major updates, and manual review.
- Security-fix PRs are labelled `security`, created immediately without the ordinary release delay, and require manual review. GitHub Action SHA pins are maintained by Renovate.

## Security audit operations

Security Audit runs Wednesday at 03:00 UTC and manually. It audits all dependencies at severity `high`, including development/build tooling. High/critical findings and registry errors fail the job visibly. This scheduled job is not a required PR check. Subscribe the repository maintainer to workflow failure notifications and triage each failure; never suppress registry failures or use an automatic audit fix.

The original audit reported 41 vulnerabilities (5 critical, 21 high, 15 moderate), with 54 separately counted GitHub alerts. [[Dependency Advisory Triage 2026-09-18]] retains that historical inventory. D1-D5 fixes are merged; current results, owner, override rationale and rollout limits are in [[Handover 2026-09-18 Dependency Security Remediation]]. No advisory suppression is used. A new high/critical finding or registry failure must still fail the audit.

## External rollout checklist

These actions require a repository administrator; configuration files alone do not activate them.

1. Completed: reviewed changes are published and all three Dependency Validation checks passed.
2. Completed: Renovate is authorized for `ENGGP/thunderstrux`, created [Dependency Dashboard #6](https://github.com/ENGGP/thunderstrux/issues/6), and Dependabot alerts report zero open findings. Dependabot update PRs remain disabled, leaving Renovate as the only update bot.
3. Completed: `static-validation`, `integration-tests`, and `production-build` remain strict protected-branch checks; `security-audit` is not required.
4. Completed: controlled CI-only [PR #7](https://github.com/ENGGP/thunderstrux/pull/7) pins Node 20 to 20.20.2 in four workflow inputs and Node 22 to 22.23.2 in the E2E and operations workflows. It changed no manifests or lockfile, merged as `b3f4fce`, and passed all five post-merge checks. The dashboard proves npm and GitHub Actions discovery while Dockerfile, Compose and workflow service images are excluded. The non-required `renovate/stability-days` status remained pending for this pin update.
5. Pending: security-PR evidence requires a real eligible advisory. Maintainer failure-notification receipt requires the next genuine audit failure, whether caused by an advisory or a registry error. Never downgrade dependencies, introduce a vulnerability or cause a registry failure to manufacture evidence.
6. Mark P2.15 complete only after both pending evidence items are recorded.

GitHub vulnerability alerts were enabled during implementation. The historical dependency graph contained 205 packages and 54 open alerts; after remediation, a 2026-09-18 API check found zero open alerts. Renovate authorization and repository discovery are evidenced by [Dependency Dashboard](https://github.com/ENGGP/thunderstrux/issues/6) and controlled PR #7. P2.17 repository-side deployment, migration, health, backup/restore, and rollback tooling is implemented; external production activation remains outstanding. Real browser/Stripe tests are covered by P2.16.

## GitHub rollout evidence (2026-09-18)

- [Implementation PR #1](https://github.com/ENGGP/thunderstrux/pull/1) merged with a regular merge commit `05d9502`, preserving the original four commits plus advisory assignment commit `178d431`. There were no upstream conflicts; remote branches were retained.
- [Validation run 35231538737](https://github.com/ENGGP/thunderstrux/actions/runs/35231538737) passed all three jobs for commit `6b3fb9e176120ac56302239de51a41afcebc29af`.
- After that green run, `main` branch protection was configured and read back: require `static-validation`, `integration-tests`, `production-build`, bound to the observed GitHub Actions app (15368), require an up-to-date branch, enforce for administrators. No audit check or new reviewer-count requirement was added.
- Completed after initial rollout: Renovate authorization, Dependency Dashboard #6 and controlled PR #7 validation and merge. Docker dependencies are absent from the dashboard because their managers and datasource are disabled. Dependabot update PRs remain disabled. Eligible vulnerability-PR evidence awaits a real advisory; maintainer notification evidence awaits the next genuine audit failure.

## Original P2.15 local verification

Before the authorization fix, isolated runs of `organisation-connect-disclosure.test.ts` on both clean commit `c8878fe` and the P2.15 working copy produced the same 9 passes / 4 failures. This demonstrates that the failures predate the infrastructure changes. Both used disposable PostgreSQL 16 databases (`baseline_test` and `current_test`) and equivalent fake Stripe environment values.

The authorization fix adds a bounded broad-capability check before input validation, while retaining separate target-tenant authorization and the first-party-origin guard first for mutations. Active owner/admin staff can manage Connect regardless of account role. Safe legacy ownership applies only when no staff row exists for that user/tenant pair; revoked, invited or downgraded staff cannot regain authority through legacy fallback. Unrelated staff membership does not erase legitimate legacy ownership. Missing/unrelated/revoked target access remains non-disclosing, while broad lack of capability remains 403.

After the fix: focused suite 22/22; complete suite 185/185; typecheck and production build passed. Added regressions cover member owner/admin access, malformed/missing/valid unauthorized requests, cross-tenant 404 body equivalence, target-role denial, legacy ownership, same-session revocation/invitation/downgrade, origin ordering, no provider calls and no organisation changes on denial. Original disclosure assertions were retained. Clean-environment fixture corrections keep dates relative and supply fake Stripe credentials.

Validation uses a disposable source copy and database, preserving the running app and workspace build files. The frozen install left `pnpm-lock.yaml` byte-for-byte unchanged; typecheck and the production build passed. The non-test database guard refused a `production` database before attempting a connection.

Both workflows passed actionlint 1.7.7. Renovate configuration passed validator 44.93.4 with Node 24.11.1; installation emitted engine warnings from the bootstrap Node 20 process, and the validator reported its optional RE2 fallback. Action SHAs were resolved from their official upstream release tags.

## Historical completed rollout evidence (2026-09-18 Australia/Brisbane)

- [Fresh pre-merge validation](https://github.com/ENGGP/thunderstrux/actions/runs/35236969551) passed all three required jobs for `178d431`.
- Local disposable Docker validation passed frozen installation, Prisma generation, typecheck, all 185 integration tests (including 22 Connect regressions), and production build against PostgreSQL 16 database `p215_test`.
- [Manual Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35286130474) ran from merged `main` (`05d9502`), started 2026-09-17 23:17:07 UTC (2026-09-18 09:17:07 Brisbane). Installation passed; the audit failed with exit code 1 after reporting 41 findings: 5 critical, 21 high, 15 moderate. This expected failure proves advisory detection; it is not a green audit or vulnerability remediation.
- GitHub's separately counted open-alert inventory remains 54: 9 critical, 24 high, 21 moderate. D1-D5 owner: ENGGP repository maintainer. Deadlines: D1/D2 2026-09-21; D3/D5 2026-09-25; D4 2026-10-02.
- Branch protection was read back: strict/up-to-date, administrator enforcement, and the three GitHub Actions checks remain required. Security Audit remains non-required and scheduled Wednesdays at 03:00 UTC.
- Lockfile unchanged: Windows checkout SHA-256 `6E4D3BD138B75D817D349AB7CB43784B1BEEF47ED0A1965D11C53BE1FFCBA080`; committed LF archive and validated Linux copy both `31d8d163e8b7a81effe7ac97041afec243c18900a8720ecb8967c13662bad95f`. The difference is checkout line endings.
- This historical rollout evidence was published through documentation-only PR #2. The production-readiness plan is now synchronized with current rollout status.

## Finalisation evidence (2026-09-18)

- [PR #4](https://github.com/ENGGP/thunderstrux/pull/4), merge `3229578`, ignores generated `next-env.d.ts` and runs `next typegen` before standalone typechecking. [Main validation](https://github.com/ENGGP/thunderstrux/actions/runs/35292254371) passed all three jobs.
- Branch protection still requires `static-validation`, `integration-tests`, and `production-build`, with up-to-date enforcement. Security Audit remains non-required.
- Windows dependencies were refreshed using pnpm 10.0.0 and the frozen lockfile; Prisma 6.19.3 generation passed. This replaces the previously stale host installation.
- Finalisation validation passed: host typecheck (Node 22.18.0), all 21 installed direct dependency versions match the manifest, and host audit reports no known vulnerabilities. Isolated Node 20 validation passed frozen installation, Prisma generation, typecheck, all 190 integration tests, production build and audit. Production HTTP checks passed for homepage, login, health, compiled CSS, malformed-token redirect and invalid image input. No package or lockfile changes were needed.
- Renovate 44.93.4 strict configuration validation passed (optional native RE2 unavailable; validator used its documented RegExp fallback). Independent read-only review found no concrete issues. Docker image exclusion includes workflow service images through the Docker datasource rule.
- Renovate authorization completed after finalisation. Dashboard #6 and merged PR #7 provide repository discovery and controlled-update evidence; Docker dependencies are absent as configured. PR #7's five post-merge checks passed; its non-required release-age status remained pending for a pin update.
- Overall P2.15 remains Open only for security-PR proof after a real eligible advisory and maintainer notification receipt after the next genuine audit failure, as explicitly selected by the maintainer.
