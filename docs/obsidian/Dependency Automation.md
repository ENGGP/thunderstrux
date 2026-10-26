---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Engineering Delivery Workflow]]", "[[Production Operations Hosting]]", "[[Development Workflow]]", "[[Troubleshooting]]"]
sources: [package.json, pnpm-lock.yaml, renovate.json, .github/workflows/dependency-validation.yml, .github/workflows/security-audit.yml, .github/workflows/release.yml]
---

# Dependency Automation

**Owns:** dependency update policy: Renovate, pnpm overrides and when to remove them, how audits and container scans run, what the Dependency Validation workflow checks, and how a dependency change is validated and rolled out.
**Read when:** reviewing a Renovate PR, changing `package.json`, `pnpm-lock.yaml`, a Dockerfile, a Compose file or a workflow pin, or answering a Security Audit failure.
**Not here:** how much validation a risk level needs ([[Engineering Delivery Workflow]]); image budgets, publication and attestation ([[Production Operations Hosting]]); refreshing the dev dependency volume ([[Development Workflow]], [[Troubleshooting]]). Dated campaigns: [[Evidence Ledger]], [[Dependency Advisory Triage 2026-09-18]].

## Code

| Concern | Where |
| --- | --- |
| Pinned versions, package manager, Node engine | `package.json` (`packageManager`, `engines`), `pnpm-lock.yaml` |
| Overrides and allowed install scripts | `package.json` `pnpm.overrides`, `pnpm.onlyBuiltDependencies` |
| Update bot | `renovate.json` |
| Scheduled audit | `.github/workflows/security-audit.yml` (`pnpm security:audit`) |
| Manual validation | `.github/workflows/dependency-validation.yml` |
| Image scan on image-changing PRs and on `main` | `.github/workflows/release.yml` |
| Base images | digest-pinned `FROM` in `docker/Dockerfile`, `docker/Dockerfile.e2e`, `docker/Dockerfile.assets`; `image:` digests in the Compose files and workflows |
| Regressions for risky packages | `tests/integration/dependency-security.test.ts` (native sharp, JWT/Auth.js, Prisma config loading), `tests/integration/redis-runtime.test.ts` (real Redis client against a run-owned Redis named by `INTEGRATION_REDIS_URL`) |

## Rules

- **Exact pins.** Every dependency is pinned (`rangeStrategy: pin`) and installed with `--frozen-lockfile`. Node and pnpm versions come from `package.json`; workflows and Dockerfiles must match them.
- **Install scripts** run only for the packages in `pnpm.onlyBuiltDependencies` (Prisma and sharp).
- **No suppression.** No advisory ignore list, audit threshold change or automatic `audit fix`. A vulnerability exception needs the CVE, reason, owner and expiry recorded in [[Issue and Defect Register]] and the workflow; none exists.
- **Lockfile merges don't deploy.** A merged pin doesn't refresh a running app or the dev dependency volume: rebuild the release pair, or refresh dev dependencies without deleting database, Redis or asset volumes.
- **Rollback** of a security pin restores a vulnerable graph and needs an explicit security decision.

## Renovate

`renovate.json`, extending `config:recommended` and `helpers:pinGitHubActionDigests`:

| Setting | Value |
| --- | --- |
| Managers | `npm`, `github-actions`, `dockerfile`, `docker-compose` (Docker images are updated) |
| Schedule | before 5 am Monday; lock-file maintenance on the same schedule |
| Release age | 3 days (`minimumReleaseAge`) |
| Concurrency | 3 open PRs; majors separate from minors |
| Merge | always manual review; automerge off everywhere |
| Dashboard | on |
| Security fixes (`vulnerabilityAlerts`) | labelled `security`, created immediately, no schedule, no release age, no automerge |
| Docker digests | grouped as "container image digests", no release age: a digest rebuild has no release timestamp, and the default `timestamp-required` behaviour would leave `renovate/stability-days` pending forever |
| Groups (non-major) | Prisma; Next and React; Tailwind and PostCSS; Auth.js; Stripe; test and build tooling (Vitest, Playwright, Vite, TypeScript, jiti, `@types/node`) |

Action references are pinned to commit SHAs and kept current by Renovate. Dependabot update PRs stay off; Renovate is the only update bot. GitHub vulnerability alerts are on.

## Overrides

`package.json` `pnpm.overrides` forces patched transitive versions. Each is removed only when the upstream graph resolves a patched version without it; then rerun frozen install, audit, build and the regression named.

| Override | Why | Before removing, rerun |
| --- | --- | --- |
| `deepmerge-ts` under `@prisma/config` only | advisory in Prisma's config loader dependency | Prisma config regression, `pnpm prisma:generate`, migrations, integration suite, build, audit; revisit on every Prisma update (the selector names the Prisma version, so it stops applying when Prisma moves) |
| `sharp` | librsvg advisory in sharp's bundled libvips; the lockfile moves sharp's platform binaries with it | native sharp resize/encode regression |
| `source-map-js` | indexed source-map denial of service | build, audit |

## Audits and scans

- **`pnpm security:audit`** = `pnpm audit --audit-level high` over every dependency, build and dev tooling included. Local entrypoint; the baseline campaign runs it.
- **Security Audit workflow:** Wednesday 03:00 UTC and on demand. High/critical findings and registry errors fail it visibly. Not a PR check. The maintainer subscribes to its failure notifications and triages each one. DEP-001 stays open until a genuine security-labelled Renovate PR and a received failure notification are recorded; never manufacture either.
- **Container scan:** Trivy, fixable `HIGH,CRITICAL` only, on both release images: in `.github/workflows/release.yml` (image-changing PRs and every `main` push) and in Dependency Validation. A finding fails the job and prints target, CVE, package, installed and fixed versions.
- **Base OS packages:** digest pins keep a base image's packages; `docker/Dockerfile` refreshes its security packages on every build, so a rebuild is the fix for a base-image CVE that Debian has patched ([[Production Operations Hosting]]).

## Dependency Validation workflow

Manual dispatch only. GitHub checks are optional and not merge requirements (VALID-001); local evidence chosen by [[Engineering Delivery Workflow]] is what a PR records. All jobs: read-only permissions, SHA-pinned actions, no persisted checkout credentials, job timeouts, superseded runs cancelled, pnpm installed before the Node action's pnpm cache.

| Job | Runs |
| --- | --- |
| `static-validation` | frozen install; `git diff --exit-code -- pnpm-lock.yaml`; `pnpm docs:check`; `pnpm prisma:generate`; `pnpm typecheck`; hadolint on `docker/Dockerfile` and `docker/Dockerfile.e2e` only, not `docker/Dockerfile.assets` (OPS-006); Compose `config` for base + dev, base + hardened, `scripts/check-hosted-compose.mjs` against `.env.hosted.example`, and the full Droplet stack; builds the `web` and `ops` pair and checks budgets with `scripts/release-pair.mjs`; Trivy on both |
| `integration-tests` | PostgreSQL 16 (`thunderstrux_test`) and Redis services; `pnpm test` with `INTEGRATION_DATABASE_URL` and `INTEGRATION_REDIS_URL` |
| `production-build` | `pnpm build` with non-secret placeholders matching the Docker builder |

## Validating a dependency change

Pick checks from the diff ([[Engineering Delivery Workflow]]; dependencies are High risk):

| Change | Local validation |
| --- | --- |
| Runtime or toolchain package | `node scripts/run-e2e.mjs baseline` (frozen install, build, typecheck, integration, audit) plus the package's regression |
| Browser test tool (Playwright, axe) | a full `pnpm test:e2e`, because it changes what the browser campaign checks |
| Dockerfile or base image | hadolint the changed Dockerfile, build the pair, check budgets, Trivy scan |
| Compose file | `docker compose ... config` for affected stacks, `pnpm docker:hosted:check -- --env-file <file>` for hosted ones |
| Action SHA pin only | review the pin against the upstream release tag; no functionality tests |

Never build inside the running app container; use the isolated runner or rebuild the image. Test setup supplies fake Stripe credentials and blocks external fetches; event fixtures are relative to today.

## Traps

- A Renovate Docker digest PR can change a base image under every image at once: build and scan the pair, not just one Dockerfile.
- `pnpm.overrides` keyed by a parent version (`@prisma/config@<version>>`) silently stops applying after that parent updates; check the audit after any Prisma bump.
- `integration-tests` and `redis-runtime.test.ts` need a disposable Redis; never point `INTEGRATION_REDIS_URL` at a development or production Redis.

## Related

[[Engineering Delivery Workflow]] · [[Production Operations Hosting]] · [[E2E and Staging Payments]] · [[Development Workflow]] · [[Troubleshooting]] · [[Issue and Defect Register]]
