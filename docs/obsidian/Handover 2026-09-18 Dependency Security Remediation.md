# Handover 2026-09-18 Dependency Security Remediation

## Current status

The patched lockfile was merged through PR #3 (`b81c631`) and passes `pnpm audit --audit-level high`: **No known vulnerabilities found**. The [GitHub Security Audit](https://github.com/ENGGP/thunderstrux/actions/runs/35290377481) passed, and a 2026-09-18 API check found zero open dependency alerts. The 41-finding snapshot in [[Dependency Advisory Triage 2026-09-18]] and original 54 GitHub alerts describe the previous dependencies.

## Resolved work packages

| Group | Updated resolution |
| --- | --- |
| D1 | Next 16.3.5; Sharp 0.35.4 through Next's supported optional dependency range |
| D2 | next-auth 5.0.0-beta.32; @auth/core 0.41.3 |
| D3 | Root PostCSS 8.5.28; Next PostCSS 8.5.23; nanoid 3.3.19, Browserslist 4.29.0 and baseline-browser-mapping 2.11.25 |
| D4 | Vitest and its packages 4.1.11; explicit devDependency Vite 8.0.16 to replace the retained vulnerable peer resolution |
| D5 | Prisma client/CLI 6.19.3; Effect 3.21.0; scoped deepmerge-ts 8.0.2 override |

Direct dependencies remain exact-pinned. pnpm remains 10.0.0; Node 20, Prisma schema, migrations, authentication configuration, Docker behavior and audit threshold are unchanged. No advisory is ignored or suppressed. Vite is included in Renovate's test/build tooling group.

## Prisma override

`@prisma/config@6.19.3>deepmerge-ts: 8.0.2` replaces the vulnerable exact 7.1.5 dependency. Both the Prisma 6 backport and the inspected published Prisma 7 config still retained 7.1.5. A major Prisma migration would not by itself fix this finding.

Prisma's [merged upstream fix](https://github.com/prisma/orm/pull/30189) adopts 8.0.2 and explains that configuration loading uses basic `deepmerge` on plain objects, not the Map/deepmergeInto behaviors changed by version 8. The repository's added regression loads a real nested Prisma config through `@prisma/config`; generation, migrations and application tests cover the existing package.json/schema configuration path.

The override is deliberately restricted to @prisma/config 6.19.3. On the next Prisma update, inspect the parent dependency and remove this override once the selected config package resolves a patched deepmerge-ts natively. Rerun the config regression, generation, migration checks, integration tests, build and full audit. Owner: ENGGP repository maintainer.

## Verification

Validation passed in disposable Docker source/dependency copies with Node 20.20.2, pnpm 10.0.0 and PostgreSQL 16 database `security_test`, leaving the running application and developer database intact:

- Frozen installation and Prisma 6.19.3 generation passed.
- Typecheck passed; integration suite passed **190/190 tests across 19 files**, including all 22 Connect regressions and five new dependency compatibility tests.
- Next 16.3.5 production build passed, including CSS generation and page rendering.
- Production startup ran `prisma migrate deploy` successfully over all 22 existing migrations, then `pnpm start`. Homepage, login, health and compiled CSS returned 200; malformed Bearer input redirected to login with 307; invalid image-optimizer input returned 400.
- `pnpm audit --audit-level high` passed in the workspace, installed test environment and production-startup copy: **No known vulnerabilities found**. No ignore list or lower threshold was used.
- Updated lockfile SHA-256: `57EE7870BC283D760BD4E5C29BCBCA3C8165BA2E449D67F1A869B03F14EF470E`.

`tests/integration/dependency-security.test.ts` exercises native Sharp encoding/resizing, real JWT handling for malformed Bearer input and valid session cookies, real Auth.js credentials rejection/login/session/logout, and Prisma config loading with the override. Vitest inlines next-auth so Vite resolves its Next extensionless imports; production configuration is unchanged. Other integration tests continue to mock auth and external providers.

## Rollout

These changes were published through PR #3. The historical failed audit remains preserved; the successful post-remediation run is linked above. PR #4 (`3229578`) subsequently added generated Next type handling and passed all three required GitHub checks.

The development image and dependency volume were refreshed after PR #3 without deleting database volumes. Windows dependencies have now also been refreshed with pnpm 10.0.0 and a frozen install, and Prisma 6.19.3 generation passed. Separate deployments still require their own rollout verification; these observations refer to the local development environment.

Renovate activation and controlled update evidence are complete: Dashboard #6 detected npm and GitHub Actions dependencies with Docker exclusions, and PR #7 passed all three required application checks. PR #7 remains open for manual review while `renovate/stability-days` enforces the configured three-day minimum release age. Overall P2.15 remains open only for security-PR evidence after a real eligible advisory and maintainer notification receipt after the next genuine Security Audit failure.
