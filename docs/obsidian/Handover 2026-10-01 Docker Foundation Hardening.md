---
status: active
last-reviewed: 2026-10-01
owner: engineering
---

# Handover 2026-10-01 Docker Foundation Hardening

## Scope

This handover covers the first of two Docker release slices on `codex/docker-foundation-hardening`, based on merged documentation commit `0b7024e`. The immutable split-image release slice must start from refreshed `origin/main` only after this PR merges.

## Implemented Repository Controls

- Node 22.23.3 is aligned across Docker, CI, `.nvmrc`, package engines, and Node types; pnpm is 10.34.5.
- Node, PostgreSQL, Redis, and Stripe CLI images use verified multi-architecture digests. Renovate discovers Dockerfiles and Compose and proposes reviewed digest updates without automerge.
- Development uses `thunderstrux-app:dev`; its PostgreSQL port is loopback-only at `127.0.0.1:5433`.
- The runtime entrypoint supports direct or `_FILE` secret injection and rejects conflicts, relative/unreadable paths, and empty files without exposing secret values.
- Email, stale-order, and compensation workers are bounded one-shot Compose services under the `workers` profile.
- `docker-compose.hosted.yml` is a provider-neutral contract for a prebuilt immutable application image and external PostgreSQL/Redis. The hardened overlay applies non-root execution, a read-only root filesystem, dropped capabilities, no-new-privileges, resource limits, a 30-second stop period, and explicit writable temporary mounts.
- Container security CI lints Dockerfiles, validates Compose, builds the production target, and blocks fixable high or critical vulnerability findings.

## Local Evidence

- Production image build and Next.js production build passed with Node 22.23.3.
- The unified foundation runner measured 1,734,708,560 bytes locally. This is evidence for the known oversized-image gap, not the PR 2 split-image budget baseline.
- Trivy 0.68.2 found no fixable high or critical finding in the rebuilt `thunderstrux-p216-app:local` image after build-only package managers were removed from the runner.
- A final registry audit identified critical Next.js advisory `GHSA-vcvr-r3jv-pc5j`; Next.js was patched from 16.3.5 to 16.3.6 before delivery. The repeated registry audit reported no known vulnerabilities.
- Hosted, development, and hardened Compose contracts passed `docker compose config --quiet`; hosted semantic guards passed.
- Runner tests passed 26/26.
- Disposable operations rehearsal passed migrations, runtime containment, file secrets, all three workers, readiness failures, backup/restore, corrupt-backup rejection, failed migration handling, and rollback.
- Disposable integration suite passed 29 files and 247 tests on 2026-10-01. The database name contained `_test`, and all run-owned resources were removed.
- Isolated browser E2E run `p216-fb787da4745fdf8e1829264f` passed 2 enforced-MFA tests, 9 desktop/mobile tests, and 6 signed-webhook tests on Next.js 16.3.6. Its containers, network, and database volume were removed.
- Documentation checks passed across 42 files, `git diff --check` passed, and the independent Docker security/release review findings were applied. Latest-head PR checks remain required before merge.

## Compatibility And Recovery

The foundation slice retains the unified production image, existing `APP_IMAGE` behavior, one-shot migration ordering, pre-migration backup, readiness, compatibility-gated rollback, and writer shutdown after uncertain migration. Direct secret variables remain supported. The hosted contract is additive and does not activate a platform.

## Remaining Work

After this PR merges, implement the second slice on `codex/docker-immutable-release`: Next.js standalone output, minimal web and operations targets, `WEB_IMAGE`/`OPS_IMAGE` with legacy fallback, dual-image evidence and rollback declarations, GHCR publishing by immutable digest, SBOM and maximum provenance, and the measured 25% image-growth budget.

Hosted production remains blocked until managed PostgreSQL/Redis, HTTPS ingress, trusted client-IP ownership, secret-store mounts, one-minute worker schedules, centralized monitoring, off-machine backups and restore evidence, Stripe refund subscriptions, and real test-mode payment acceptance are verified.
