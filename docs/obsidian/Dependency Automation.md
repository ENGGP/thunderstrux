# Dependency Automation

## P2.15 status

The integration gate passes locally: 185/185 tests, including 22 Stripe Connect disclosure tests. The four original failures were reproduced on `c8878fe` and fixed separately from dependency infrastructure without weakening their expectations. See the evidence below.

Repository automation is implemented. P2.15 remains open until the GitHub settings and a real Renovate PR are verified. Commit `c8878fe` supplied exact direct dependency versions, the lockfile, npm-focused Renovate configuration, and initial typecheck CI; the pnpm pin predates that commit.

## Validation and update policy

- `pnpm typecheck`, `pnpm test` (the existing integration runner), and `pnpm security:audit` are the local entrypoints. `pnpm build` remains the production build command.
- Dependency Validation runs on every PR and push targeting `main` or `master`, plus manual dispatch. The job/check names are `static-validation`, `integration-tests`, and `production-build`.
- Every job installs with the committed pnpm version and `--frozen-lockfile`. Static validation checks lockfile stability, generates Prisma, and typechecks. Integration uses disposable PostgreSQL 16 and `thunderstrux_test`; the runner resets its database and runs sequentially. Never supply an application database URL.
- Test setup supplies fake Stripe credentials; external fetch calls remain blocked. Future event fixtures are relative to the current date.
- Build uses non-secret placeholders matching the Docker builder. Do not build inside the running application container; use a disposable environment or rebuild the image.
- Workflows use read-only repository permissions, SHA-pinned Actions, disabled persisted checkout credentials, job timeouts, and cancellation of superseded runs. pnpm is installed before enabling the Node action's pnpm cache.
- Renovate covers npm, GitHub Actions, Dockerfile, and Compose dependencies. Ordinary updates retain Monday scheduling, a three-day release delay, grouped non-major updates, and manual review. Docker tags are managed; Docker digest pinning is deferred.
- Security-fix PRs are labelled `security`, created immediately without the ordinary release delay, and require manual review. GitHub Action SHA pins are maintained by Renovate.

## Security audit operations

Security Audit runs Wednesday at 03:00 UTC and manually. It audits all dependencies at severity `high`, including development/build tooling. High/critical findings and registry errors fail the job visibly. This scheduled job is not a required PR check. Subscribe the repository maintainer to workflow failure notifications and triage each failure; never suppress registry failures or use an automatic audit fix.

The baseline audit reports 41 vulnerabilities: 5 critical, 21 high, and 15 moderate. [[Dependency Advisory Triage 2026-09-18]] records all affected installed versions, paths, fixed ranges, exposure assessments and proposed separate remediation work. No upgrades, acceptance or suppression were performed. Accountable owners and deadlines await maintainer confirmation. GitHub reports 54 open alerts; reconcile its inventory separately rather than equating the counts. Advisory counts can change without lockfile changes.

## External rollout checklist

These actions require a repository administrator; configuration files alone do not activate them.

1. Publish the reviewed changes and observe all three Dependency Validation checks passing on GitHub.
2. Install/authorize the Renovate GitHub app for `ENGGP/thunderstrux` and complete its onboarding. Enable Dependency Graph and Dependabot alerts; grant Renovate read access to vulnerability alerts. Keep a single bot responsible for update PRs.
3. Require `static-validation`, `integration-tests`, and `production-build` in the protected branch rules after GitHub has reported those checks. Remove the obsolete `Dependency validation` required check if configured. Do not require `security-audit`.
4. Allow one controlled Renovate update PR; verify the expected manifests/lockfile and all three checks. Verify discovered npm, Action, Dockerfile, Compose, and workflow service-image dependencies in the Renovate dashboard/logs.
5. Confirm known vulnerability alerts are visible to Renovate and that eligible fixes produce security-labelled PRs. Dispatch Security Audit and confirm failure notifications reach the maintainer.
6. Only then mark P2.15 complete and record the GitHub run/PR evidence in this note.

GitHub vulnerability alerts were enabled during implementation. Subsequent API reads verified a dependency graph containing 205 packages and 54 open alerts. Dependabot security-update PRs remain disabled to avoid adding a second update bot. Renovate app installation/permissions and a controlled bot PR remain unverified. Required checks must follow green runs of the final job structure. Deployment, migration rollout, health monitoring, backup/restore, and rollback remain P2.17; real browser/Stripe tests remain P2.16.

## Local verification

Before the authorization fix, isolated runs of `organisation-connect-disclosure.test.ts` on both clean commit `c8878fe` and the P2.15 working copy produced the same 9 passes / 4 failures. This demonstrates that the failures predate the infrastructure changes. Both used disposable PostgreSQL 16 databases (`baseline_test` and `current_test`) and equivalent fake Stripe environment values.

The authorization fix adds a bounded broad-capability check before input validation, while retaining separate target-tenant authorization and the first-party-origin guard first for mutations. Active owner/admin staff can manage Connect regardless of account role. Safe legacy ownership applies only when no staff row exists for that user/tenant pair; revoked, invited or downgraded staff cannot regain authority through legacy fallback. Unrelated staff membership does not erase legitimate legacy ownership. Missing/unrelated/revoked target access remains non-disclosing, while broad lack of capability remains 403.

After the fix: focused suite 22/22; complete suite 185/185; typecheck and production build passed. Added regressions cover member owner/admin access, malformed/missing/valid unauthorized requests, cross-tenant 404 body equivalence, target-role denial, legacy ownership, same-session revocation/invitation/downgrade, origin ordering, no provider calls and no organisation changes on denial. Original disclosure assertions were retained. Clean-environment fixture corrections keep dates relative and supply fake Stripe credentials.

Validation uses a disposable source copy and database, preserving the running app and workspace build files. The frozen install left `pnpm-lock.yaml` byte-for-byte unchanged; typecheck and the production build passed. The non-test database guard refused a `production` database before attempting a connection.

Both workflows passed actionlint 1.7.7. Renovate configuration passed validator 44.93.4 with Node 24.11.1; installation emitted engine warnings from the bootstrap Node 20 process, and the validator reported its optional RE2 fallback. Action SHAs were resolved from their official upstream release tags.
