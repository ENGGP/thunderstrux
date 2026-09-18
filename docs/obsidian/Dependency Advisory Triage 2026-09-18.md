# Dependency Advisory Triage — 2026-09-18

## Current remediation status

D1-D5 fixes are merged through PR #3 and `pnpm audit --audit-level high` reports **No known vulnerabilities found**. The post-remediation GitHub audit passed; a 2026-09-18 API check found zero open dependency alerts. See [[Handover 2026-09-18 Dependency Security Remediation]] for resolved versions, compatibility checks and the scoped deepmerge-ts override. The inventory and failed audit below are preserved as the pre-remediation snapshot.

## Historical status and decision boundary

Fresh `pnpm audit --json` against the unchanged lockfile reported **41 findings: 5 critical, 21 high, 15 moderate** (36 advisory/package records; multiple installed versions account for additional findings). This is a registry snapshot, not proof of exploitation or safety. GitHub reported **54 open alerts: 9 critical, 24 high, 21 moderate**. Reconciliation by advisory ID and package found no additional advisory/package pairs: 19 GitHub alerts target `package.json` and 35 target `pnpm-lock.yaml`. The sources count manifest alerts and installed-version findings differently; neither count is silently substituted for the other.

No packages were upgraded, no overrides added, and no advisories suppressed. The approved remediation direction for every finding is **remediate in separately reviewed dependency PRs**; feature-specific observations below are not risk acceptances. P2.15 requires documented and approved critical/high decisions, not a zero-advisory audit.

**Accountable owner: ENGGP repository maintainer for D1-D5.** Approved deadlines: D1/D2 2026-09-21, D3/D5 2026-09-25, D4 2026-10-02. Remediation will use separately reviewed dependency PRs; these assignments do not accept or suppress the vulnerabilities. Candidate versions still require compatibility validation.

Source: isolated frozen installation of repository `c8878fe` plus repository-side P2.15/auth changes, pnpm 10.0.0. Lockfile SHA-256: `6E4D3BD138B75D817D349AB7CB43784B1BEEF47ED0A1965D11C53BE1FFCBA080`. Fixed versions below were returned by the audit registry; proposed candidate releases were also checked for availability via npm registry metadata. These are candidates, not tested upgrades.

## Original remediation work packages

| Decision | Proposed change and validation | Owner / deadline |
| --- | --- | --- |
| D1 | Next 16.3.3 plus sharp 0.35.4; registry metadata confirms Next's optional sharp range is `^0.35.3`, allowing this patched resolution. Verify actual lockfile resolution, native image handling, image endpoint access, proxy authorization, request/cache behavior and production build. | ENGGP repository maintainer / 2026-09-21 |
| D2 | next-auth 5.0.0-beta.32 bringing @auth/core 0.41.3; verify credentials login, session shape, malformed Bearer, protected routes and logout. Review prerelease behavior even without major increment. | ENGGP repository maintainer / 2026-09-21 |
| D3 | PostCSS 8.5.23, nanoid 3.3.18, browserslist 4.28.7, baseline-browser-mapping 2.11.0 across all affected paths; prefer compatible parent/lockfile updates, then verify CSS output and production build. Next 16.3.3 declares PostCSS 8.5.23; upgrading root PostCSS alone leaves Next's older exact pin. | ENGGP repository maintainer / 2026-09-25 |
| D4 | Vitest 4.1.11 / mocker 4.1.11 and Vite 8.0.16; verify Node engine compatibility and all integration tests. | ENGGP repository maintainer / 2026-10-02 |
| D5 | Compatible Prisma-family update resolving effect and deepmerge-ts; deepmerge-ts requires a major update. Identify a compatible parent release before proposing changes; do not force a major transitive override without compatibility testing. Verify generation, migrations on disposable database, startup and integration suite. | ENGGP repository maintainer / 2026-09-25 |

Every dependency PR must run the same typecheck, integration and production-build gates. Re-audit afterward to confirm **every installed affected version/path** is gone and identify newly published advisories. Keep actual upgrades outside P2.15 infrastructure/auth changes.

## Exposure and major-upgrade assessment

The Docker runtime copies the full node_modules tree, including development packages. “Tooling” therefore describes observed execution, not absence from the production image. Prisma migration tooling executes at container startup. Neither label justifies ignoring a finding.

| Package | Observed exposure / uncertainty | Candidate / major impact | Decision |
| --- | --- | --- | --- |
| next | Runtime framework; feature-specific applicability below. | 16.3.3; no major increment | D1 |
| next-auth | Runtime authentication; Credentials provider only. Session guard requires user.id; proxy getToken path needs malformed-Bearer regression coverage. | 5.0.0-beta.32; prerelease compatibility review | D2 |
| @auth/core | Runtime via next-auth; same authentication review as D2. | 0.41.3 via next-auth beta.32; no major increment | D2 |
| sharp | Runtime optional image decoder via Next.js; absence of next/image imports does not prove the image endpoint unreachable. | 0.35.4; potentially breaking 0.x minor, parent-range review required | D1 |
| postcss | Build CSS processing; repository-controlled CSS observed. No application ingestion of untrusted CSS found; dependency/tool input reachability still needs review. | 8.5.23 across all copies; no major increment | D3 |
| nanoid | Transitive CSS tooling; no direct app calls found. Parent call arguments need verification before claiming unreachable. | 3.3.18; no major increment | D3 |
| vite | Test tooling; Node Vitest configuration, no browser/dev server deployed by this repository. Windows developer server exposure needs review. | 8.0.16; no major increment | D4 |
| vitest | Direct test tooling; Node environment, browser mock server not configured. | 4.1.11; no major increment | D4 |
| @vitest/mocker | Transitive test tooling; browser mock server not configured. | 4.1.11 via vitest; no major increment | D4 |
| effect | Prisma configuration/startup tooling; no direct application Effect/RPC usage found. Verify parent use before concluding unreachable. | 3.20.0; no major increment; parent compatibility review | D5 |
| deepmerge-ts | Prisma configuration/startup tooling; no direct application merge usage found. Investigate whether untrusted recursive graphs can reach parent configuration. | 8.0.0; YES transitive major; compatible Prisma parent unresolved | D5 |
| browserslist | Build tooling via autoprefixer; no user-supplied queries/stats identified. | 4.28.7; no major increment | D3 |
| baseline-browser-mapping | Build/compatibility tooling via Next and browserslist; no direct app input path found. | 2.11.0; no major increment | D3 |

Evidence inspected: `auth.ts`, `proxy.ts`, `lib/auth/access.ts`, `next.config.ts`, `Dockerfile`, `docker/entrypoint.sh`, `postcss.config.mjs`, Vitest configuration and application imports. The repository runs Linux Node/Next, not a Windows production server or custom Next server. No locales, rewrites, Edge runtime, `use server` declarations or `next/image` imports were identified. Deployment-specific overrides and framework-provided endpoints still require verification.

Next advisory applicability:
- Windows RCE: not applicable to the checked Linux Docker deployment; Windows-hosted execution remains affected.
- AVIF/SVG image issues and sharp decoders: potential runtime exposure; investigate the framework image endpoint even without component imports. Prioritize D1.
- Server Actions, custom-server SSRF, single-locale bypass, Edge payload and rewrite SSRF: triggering configuration not observed. Upgrade anyway; do not assert unreachable without deployment verification.
- Cache confusion and endpoint disclosure: runtime/framework behavior; retain as potentially applicable pending targeted verification.

Auth advisory applicability:
- Truthy-auth fail-open: the central guard checks `session.user.id`, rather than merely a truthy auth object. Confirm all call sites during D2; not an accepted exception.
- Email normalization and OAuth binding: Credentials-only provider configuration does not use those provider flows. Keep upgrades planned.
- Malformed Bearer: `proxy.ts` calls `getToken`; treat as applicable pending targeted reproduction/fix validation.

## Complete installed-version inventory

“Fixed range” is advisory-specific. Select the **highest cumulative candidate** above to address all findings in a package family, not merely the lowest fix from one row. Path identifiers enumerate audit-reported chains below, including peer paths.

| Package / installed version | Severity | Advisory | Relationship / paths | Fixed range | Decision |
| --- | --- | --- | --- | --- | --- |
| effect 3.18.4 | high | [GHSA-38f7-945m-qr2g](https://github.com/advisories/GHSA-38f7-945m-qr2g) | Transitive; P1 | >=3.20.0 | D5 |
| postcss 8.4.31 | moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | Transitive; P2 | >=8.5.10 | D3 |
| vite 8.0.10 | moderate | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | Transitive; P3 | >=8.0.16 | D4 |
| vite 8.0.10 | high | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | Transitive; P3 | >=8.0.16 | D4 |
| sharp 0.34.5 | high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | Transitive; P4 | >=0.35.0 | D1 |
| next 16.2.6 | high | [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | high | [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | high | [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | moderate | [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | moderate | [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | moderate | [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | high | [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | moderate | [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| next 16.2.6 | moderate | [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) | Direct + transitive/peer; P5 | >=16.2.11 | D1 |
| postcss 8.5.10 | high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | Direct + transitive/peer; P6 | >=8.5.12 | D3 |
| postcss 8.4.31 | high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | Transitive; P2 | >=8.5.12 | D3 |
| postcss 8.5.10 | moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | Direct + transitive/peer; P6 | >=8.5.23 | D3 |
| postcss 8.5.13 | moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | Transitive; P7 | >=8.5.23 | D3 |
| postcss 8.4.31 | moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | Transitive; P2 | >=8.5.23 | D3 |
| nanoid 3.3.11 | high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | Transitive; P8 | >=3.3.16 | D3 |
| next-auth 5.0.0-beta.31 | critical | [GHSA-8fpg-xm3f-6cx3](https://github.com/advisories/GHSA-8fpg-xm3f-6cx3) | Direct; P9 | >=5.0.0-beta.32 | D2 |
| next-auth 5.0.0-beta.31 | critical | [GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh) | Direct; P9 | >=5.0.0-beta.32 | D2 |
| @auth/core 0.41.2 | critical | [GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh) | Transitive; P10 | >=0.41.3 | D2 |
| nanoid 3.3.11 | high | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | Transitive; P8 | >=3.3.18 | D3 |
| postcss 8.5.10 | high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | Direct + transitive/peer; P6 | >=8.5.18 | D3 |
| postcss 8.5.13 | high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | Transitive; P7 | >=8.5.18 | D3 |
| postcss 8.4.31 | high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | Transitive; P2 | >=8.5.18 | D3 |
| next-auth 5.0.0-beta.31 | high | [GHSA-xmf8-cvqr-rfgj](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj) | Direct; P9 | >=5.0.0-beta.32 | D2 |
| @auth/core 0.41.2 | high | [GHSA-xmf8-cvqr-rfgj](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj) | Transitive; P10 | >=0.41.3 | D2 |
| next-auth 5.0.0-beta.31 | moderate | [GHSA-x445-f3h2-j279](https://github.com/advisories/GHSA-x445-f3h2-j279) | Direct; P9 | >=5.0.0-beta.32 | D2 |
| @auth/core 0.41.2 | moderate | [GHSA-x445-f3h2-j279](https://github.com/advisories/GHSA-x445-f3h2-j279) | Transitive; P10 | >=0.41.3 | D2 |
| deepmerge-ts 7.1.5 | high | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | Transitive; P11 | >=8.0.0 | D5 |
| browserslist 4.28.2 | high | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | Transitive; P12 | >=4.28.7 | D3 |
| browserslist 4.28.2 | high | [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | Transitive; P12 | >=4.28.7 | D3 |
| nanoid 3.3.11 | high | [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) | Transitive; P8 | >=3.3.12 | D3 |
| next 16.2.6 | critical | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | Direct + transitive/peer; P5 | >=16.3.3 | D1 |
| vitest 4.1.5 | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | Direct; P13 | >=4.1.11 | D4 |
| @vitest/mocker 4.1.5 | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | Transitive; P14 | >=4.1.11 | D4 |
| baseline-browser-mapping 2.10.20 | moderate | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | Transitive; P15 | >=2.11.0 | D3 |
| sharp 0.34.5 | high | [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | Transitive; P4 | >=0.35.4 | D1 |
| next 16.2.6 | critical | [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | Direct + transitive/peer; P5 | >=16.3.3 | D1 |

## Audit-reported dependency paths

### P1

- `. > @prisma/client@6.19.0 > prisma@6.19.0 > @prisma/config@6.19.0 > effect@3.18.4`
- `. > prisma@6.19.0 > @prisma/config@6.19.0 > effect@3.18.4`

### P2

- `. > next@16.2.6 > postcss@8.4.31`
- `. > next-auth@5.0.0-beta.31 > next@16.2.6 > postcss@8.4.31`

### P3

- `. > vitest@4.1.5 > @vitest/mocker@4.1.5 > vite@8.0.10`
- `. > vitest@4.1.5 > vite@8.0.10`

### P4

- `. > next@16.2.6 > sharp@0.34.5`
- `. > next-auth@5.0.0-beta.31 > next@16.2.6 > sharp@0.34.5`

### P5

- `. > next@16.2.6`
- `. > next-auth@5.0.0-beta.31 > next@16.2.6`

### P6

- `. > @tailwindcss/postcss@4.2.4 > postcss@8.5.10`
- `. > autoprefixer@10.5.0 > postcss@8.5.10`
- `. > postcss@8.5.10`

### P7

- `. > vitest@4.1.5 > @vitest/mocker@4.1.5 > vite@8.0.10 > postcss@8.5.13`
- `. > vitest@4.1.5 > vite@8.0.10 > postcss@8.5.13`

### P8

- `. > next@16.2.6 > postcss@8.4.31 > nanoid@3.3.11`
- `. > next-auth@5.0.0-beta.31 > next@16.2.6 > postcss@8.4.31 > nanoid@3.3.11`
- `. > @tailwindcss/postcss@4.2.4 > postcss@8.5.10 > nanoid@3.3.11`
- `. > autoprefixer@10.5.0 > postcss@8.5.10 > nanoid@3.3.11`
- `. > postcss@8.5.10 > nanoid@3.3.11`
- `. > vitest@4.1.5 > @vitest/mocker@4.1.5 > vite@8.0.10 > postcss@8.5.13 > nanoid@3.3.11`
- `. > vitest@4.1.5 > vite@8.0.10 > postcss@8.5.13 > nanoid@3.3.11`

### P9

- `. > next-auth@5.0.0-beta.31`

### P10

- `. > next-auth@5.0.0-beta.31 > @auth/core@0.41.2`

### P11

- `. > @prisma/client@6.19.0 > prisma@6.19.0 > @prisma/config@6.19.0 > deepmerge-ts@7.1.5`
- `. > prisma@6.19.0 > @prisma/config@6.19.0 > deepmerge-ts@7.1.5`

### P12

- `. > autoprefixer@10.5.0 > browserslist@4.28.2 > update-browserslist-db@1.2.3 > browserslist@4.28.2`

### P13

- `. > vitest@4.1.5`

### P14

- `. > vitest@4.1.5 > @vitest/mocker@4.1.5`

### P15

- `. > next@16.2.6 > baseline-browser-mapping@2.10.20`
- `. > next-auth@5.0.0-beta.31 > next@16.2.6 > baseline-browser-mapping@2.10.20`
- `. > autoprefixer@10.5.0 > browserslist@4.28.2 > baseline-browser-mapping@2.10.20`

## Current rollout evidence

- D1-D5 fixes were merged through PR #3; exact versions, lockfile changes, regression coverage and successful audit results are recorded in the linked remediation handover.
- The initial 54-alert inventory is historical. The post-remediation audit passed and a 2026-09-18 GitHub API check found zero open dependency alerts.
- Renovate is authorized. Dashboard #6 verifies npm and GitHub Actions discovery with Docker exclusions; controlled PR #7 passed all required application checks and is waiting for its configured three-day stability check before manual merge.
- P2.15 remains open only for a security-labelled Renovate PR after a real eligible advisory and maintainer notification receipt after the next genuine Security Audit failure. No vulnerability will be introduced and no registry failure will be caused to manufacture that evidence.

## Rollout audit evidence

[Manual Security Audit run 35286130474](https://github.com/ENGGP/thunderstrux/actions/runs/35286130474) executed on merged main `05d9502` at 2026-09-17 23:17 UTC (2026-09-18 Brisbane). Frozen installation passed; audit exited 1 with 41 findings: 5 critical, 21 high, 15 moderate, matching the local audit. GitHub open alerts remained 54 (9 critical, 24 high, 21 moderate), counted separately. This is historical detection evidence, not current vulnerability state or risk acceptance. D1-D5 ownership and deadlines above were approved. The later post-remediation audit passed, GitHub reported zero open alerts, and Renovate activation and controlled-update validation completed. Overall P2.15 remains open only for security-PR evidence after a real eligible advisory and notification-receipt evidence after the next genuine audit failure.
