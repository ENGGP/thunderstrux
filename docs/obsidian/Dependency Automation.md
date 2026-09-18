# Dependency Automation

## Current dependency remediation

The D1-D5 dependency fixes were published through [PR #3](https://github.com/ENGGP/thunderstrux/pull/3), merge `b81c631`. The [post-remediation Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35290377481) passed. GitHub reports zero open dependency alerts on 2026-09-18. Versions and compatibility checks are in [[Handover 2026-09-18 Dependency Security Remediation]]. The failed runs/counts below are historical evidence.

## P2.15 status

The original P2.15 integration gate passed locally: 185/185 tests, including 22 Stripe Connect disclosure tests. The four original failures were reproduced on `c8878fe` and fixed separately from dependency infrastructure without weakening their expectations. See the evidence below.

Repository-side P2.15 implementation is complete and merged through [PR #1](https://github.com/ENGGP/thunderstrux/pull/1), merge commit `05d9502`. Overall P2.15 remains **Open - external Renovate verification deferred**: app activation and controlled update/security PR acceptance evidence are explicitly outstanding. Commit `c8878fe` supplied exact direct dependency versions and initial automation; no dependency upgrades were included in this rollout.

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

1. Publish the reviewed changes and observe all three Dependency Validation checks passing on GitHub.
2. Install/authorize the Renovate GitHub app for `ENGGP/thunderstrux` and complete its onboarding. Enable Dependency Graph and Dependabot alerts; grant Renovate read access to vulnerability alerts. Keep a single bot responsible for update PRs.
3. Require `static-validation`, `integration-tests`, and `production-build` in the protected branch rules after GitHub has reported those checks. Remove the obsolete `Dependency validation` required check if configured. Do not require `security-audit`.
4. Allow one controlled non-major Renovate update or lockfile-maintenance PR; verify its expected diff and all three checks. Verify npm and Action discovery and exclusion of Docker dependencies, including workflow service images, in the dashboard/logs. Leave the update for manual review.
5. Confirm Renovate can read vulnerability alerts. Security-PR evidence remains pending until a real eligible advisory exists; never downgrade dependencies to manufacture a finding. Confirm maintainer failure-notification receipt when a genuine audit failure occurs.
6. Only then mark P2.15 complete and record the GitHub run/PR evidence in this note.

GitHub vulnerability alerts were enabled during implementation. Subsequent API reads verified a dependency graph containing 205 packages and 54 open alerts. Dependabot security-update PRs remain disabled to avoid adding a second update bot. Renovate app installation/permissions and a controlled bot PR remain unverified; the available credential cannot list user app installations (HTTP 403), so absence of the app is not asserted. Deployment, migration rollout, health monitoring, backup/restore, and rollback remain P2.17; real browser/Stripe tests remain P2.16.

## GitHub rollout evidence (2026-09-18)

- [Implementation PR #1](https://github.com/ENGGP/thunderstrux/pull/1) merged with a regular merge commit `05d9502`, preserving the original four commits plus advisory assignment commit `178d431`. There were no upstream conflicts; remote branches were retained.
- [Validation run 35231538737](https://github.com/ENGGP/thunderstrux/actions/runs/35231538737) passed all three jobs for commit `6b3fb9e176120ac56302239de51a41afcebc29af`.
- After that green run, `main` branch protection was configured and read back: require `static-validation`, `integration-tests`, `production-build`, bound to the observed GitHub Actions app (15368), require an up-to-date branch, enforce for administrators. No audit check or new reviewer-count requirement was added.
- Deferred: Renovate app activation/permissions, controlled update PR and eligible vulnerability PR verification. Dependabot update PRs remain disabled. Maintainer notification delivery has not been independently verified; the completed audit proves detection, not notification receipt.

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
- Renovate activation requires the account owner's GitHub installation flow; no browser was connected during finalisation. Configuration alone is not proof of app installation, alert permissions, or a bot-created PR.
- Overall P2.15 remains Open until the external checks above are evidenced. Security-PR proof waits for a real eligible advisory, as explicitly selected by the maintainer.
