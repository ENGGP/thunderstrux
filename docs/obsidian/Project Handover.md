---
status: current
last-reviewed: 2026-10-12
owner: engineering
aliases: [Current Handover]
related: ["[[Documentation Index]]", "[[Engineering Delivery Workflow]]", "[[Non-Blocking Issue Register]]"]
sources: [package.json, prisma/schema.prisma]
---

# Project Handover

This is the only current handover. It covers delivery from **PR #31 onward**, with current contracts and dated validation evidence recorded below. Earlier implementation remains background in the linked references and Git history. Start at [[Documentation Index]]; use [[Engineering Delivery Workflow]] for delivery and [[Non-Blocking Issue Register]] for open risks.

## Current State

**Packages 1, 2 and 3 are implemented and locally qualified.** Completion does not establish full MVP or hosted production readiness. See [[../MVP_READINESS_WORK_PACKAGES|Work Packages]] and [[../MVP_READINESS_PLAN|Readiness Plan]] for dependencies and detailed evidence.

| Delivery PR | Delivered result |
| --- | --- |
| [#31](https://github.com/ENGGP/thunderstrux/pull/31) | T02 encrypted general notifications, bounded worker and tenant-scoped business recovery; the user's remediation-document deletion is reflected in GitHub |
| [#32](https://github.com/ENGGP/thunderstrux/pull/32) | T03 verification, generic signup, live verified-identity gates and session-version fencing |
| [#33](https://github.com/ENGGP/thunderstrux/pull/33) | T04a password recovery, private account settings, password change and session revocation |
| [#34](https://github.com/ENGGP/thunderstrux/pull/34) | pnpm 10.34.6 |
| [#35](https://github.com/ENGGP/thunderstrux/pull/35) | Updated test/build dependencies; exact versions are in package.json and the lockfile |
| [#36](https://github.com/ENGGP/thunderstrux/pull/36) | T04b email changes and cancellation; reliable account-link capture before hydration |
| [#37](https://github.com/ENGGP/thunderstrux/pull/37) | T04c permanent closure, credential/authority fencing and retained buyer identity |
| [#38](https://github.com/ENGGP/thunderstrux/pull/38) | Recorded final account-lifecycle checks and merged delivery evidence |
| [#39](https://github.com/ENGGP/thunderstrux/pull/39) | Sharp 0.35.5/source-map-js 1.2.2 overrides and Next.js 16.3.8 security patches; merged as b9a113d |
| [#40](https://github.com/ENGGP/thunderstrux/pull/40) | Proportionate local validation; GitHub tests are manual-only and are not merge requirements |
| [#42](https://github.com/ENGGP/thunderstrux/pull/42) | T05 live permissions, explicit personal/staff context, role-aware navigation and nonfinancial event-manager analytics |
| [#43](https://github.com/ENGGP/thunderstrux/pull/43) | T06a private versioned invitation delivery, explicit acceptance, resend/revoke and active-role preservation |
| [#44](https://github.com/ENGGP/thunderstrux/pull/44) | T06b atomic owner handover, legacy pointer retirement and retained business/Stripe history |
| [#45](https://github.com/ENGGP/thunderstrux/pull/45) | Local development stale-module recovery, Next 16.3.8 activation, backed-up migration and notification-key configuration; hosted activation remains separate |
| [#47](https://github.com/ENGGP/thunderstrux/pull/47) | T07 sanitised tenant assets, recoverable S3 storage, patched local object-store and metadata/object restore |
| [#48](https://github.com/ENGGP/thunderstrux/pull/48) | T08 public profiles/resumable setup, optimistic image references and post-retirement bootstrap fencing |

PR numbers are delivery references, not merge chronology: #40 merged before #39.

## Active Contracts And Evidence

- Verification/reset/email-change links use purpose-bound digests, explicit POST redemption and private encrypted notifications. Signup/recovery responses conceal account existence; old sessions cannot upgrade their authVersion through cookie refresh. [[Authentication and Dashboard Access]] and [[API Reference]] own the contracts.
- Closure is irreversible through the app. Ownership, unresolved payment work and upcoming paid purchases block it. Login/editable profile is anonymised; original user IDs, business/attendance/audit/security records and immutable buyer captures remain. A new signup never inherits these records. Closure is not deletion of all personal information.
- Package 1 qualification includes integration, browser, migration and recovery evidence in the readiness ledger. The historical three-pass local/CI campaigns remain evidence of that delivery; current policy does not require routine repetition.
- Latest dependency baseline: executable b3f965d, run p216-4eeb6f57df076e27f533e459, passed frozen install, production build, typecheck, 31 migrations and 311 integration tests in 36 files, including native Sharp compatibility. Audit reported no known vulnerabilities on 2026-10-09; passed and cleanupComplete are recorded. [[Dependency Automation]] owns override removal conditions and dated evidence.
- Canonical tenant authority is Event.organisationId for event-owned records. Live OrganisationStaff authority grants management access; OrganisationMember is join state. Stripe remains payment truth and production fulfilment is webhook-driven.

- T05 qualification: [PR #42](https://github.com/ENGGP/thunderstrux/pull/42), executable 1ed2031, baseline p216-f4a2251f076fd4c1d88be743 passed build/typecheck, 317 integration tests and audit with no known vulnerabilities. Browser revision cad21f9 passed campaign p216-da9f8fb4aeaf890bad145932: 2 MFA, 14 browser/mobile/account-lifecycle and 7 webhook/notification checks. Cleanup completed; the readiness ledger records corrected failed attempts and review. Member staff now start personal and select a live authorized tenant; only owners change owner authority, and event managers receive nonfinancial analytics.

## Runtime And Validation

- T06a qualification: [PR #43](https://github.com/ENGGP/thunderstrux/pull/43), baseline `3fc0f32`/`p216-b6b9e916630758d020500c61` passed build/typecheck, 330 integration tests and clean audit. Browser `a00ab6e`/`p216-25a6a1f4b0428b6f62720c72` passed 24 checks; operations `d07d1a8`/`p217-ci-1b4452dd29` passed migration/restore/key-decryption/rollback. All run-owned cleanup passed; the readiness ledger records corrected failures and final-content coverage. Invitation activation requires migration 20261009010000_private_staff_invites before app/workers; pause acceptance/delivery when rolling back older code.
- T06b qualification: [PR #44](https://github.com/ENGGP/thunderstrux/pull/44), executable `45c7e26`: baseline `p216-a78d9deb3001e890a85cafe7` passed build/typecheck, 339 integration tests and clean audit; E2E `p216-15b482330aafdb4263f4f282` passed 25 MFA/browser/webhook checks, including enforced committee handover. Operations `p217-ci-e7063f6faa` passed retired ownership/staff/audit restore, encrypted key recovery and rollback. Owned-resource cleanup passed. Owner handover requires current password/enrolled-login MFA, promotes the target before outgoing admin/revocation, clears the legacy pointer and audits atomically. No credentials, business or Stripe history move. Pointer retirement stays in place after code rollback.


T07 executable `4e6eedd`: baseline `p216-6dfa74ac94482c7b81ab2ae4` passed build/typecheck, 346 integration checks and clean audit. Operations `p217-ci-f0f9ce05fd` passed persistent object restart, database/object restore with hash verification, secrets, migration and rollback. Patched storage/app image scans, Dockerfile lint and 30 runner guards pass; run-owned cleanup completed. [[Society Profiles and Assets]] owns quotas, sanitisation, private previews, reference-gated public delivery and delayed cleanup. No development migration/redeployment or hosted activation occurred; backup both metadata and bytes before rollout.

T08 executable `4303195`: baseline `p216-60f24b14c577aa799a8af31f` passes build/typecheck, 350 integration checks and clean audit. Browser revision `67b348d`, run `p216-d64be0b22f4859dac91c2d28`, passes 27 complete MFA/browser/webhook checks; public/mobile/form screenshots were reviewed. Operations `p217-ci-4e79bc4abe` passes profile/image association restore and rollback. Owned-resource cleanup completed. BOOT-001 is resolved under User/sorted Organisation locks; profile completion is separate from Stripe readiness. [[Society Profiles and Assets]] and the readiness ledger record contracts and corrected failed attempts. Hosted activation and independent production review remain separate.

T09 baseline executable `15a1e4b`, run `p216-e62123415fe7e1788a49219e`, passes build/typecheck, 354 integration checks and clean audit. Final UI/browser executable `5931086`, run `p216-86e01a93979f3ffc3d963f33`, passes 30 MFA/browser/webhook checks, including explicit verified join, caller-only leave, fresh search badges, pagination and delayed-response fencing. Mobile screenshot reviewed; 30 runner guards and both owned-resource cleanups pass. Anonymous directory/DTOs and personalized profile controls preserve search contracts, staff and payment authority. No additional migration is required. The readiness ledger records final-content coverage and independent hosted gates.

Repository pins: Node 22.23.3, pnpm 10.34.6, Next.js 16.3.8 and Prisma client/CLI 6.19.3. The migration chain has 34 migrations, ending in 20261011020000_society_profiles; current schema has 22 models. [[Architecture Overview]], [[Database and Multi Tenancy]] and [[Development Workflow]] provide the details.

PR #40 removes PR/push triggers from test workflows. Local checks follow the risk table: documentation-only changes use docs/diff checks and claim review, with no functionality tests; code changes need one successful applicable run, with repeats justified by changed inputs, failures or a documented reliability concern. Scheduled Security Audit remains enabled. GitHub protection readback on 2026-10-09 found no required status checks/rulesets; force pushes and branch deletion were disallowed. Review local evidence in every PR (VALID-001).

**Local development was refreshed on 2026-10-10 after a stale Turbopack module-resolution error. Hosted activation remains unverified.** The existing recovery helper rebuilt the app and replaced its labelled dependency cache: installed Next is 16.3.8, Prisma is generated, all 32 migrations are applied and /api/health/ready returns 200. The pre-refresh development archive is retained at tmp/dev-before-context-refresh-20261009.dump (UTC date; SHA-256 93359d6b4809dc0086e3223926c81d3295c2415b4f1ccaf182194f783b58f880), with a readable archive listing. A missing notification key was provisioned only after confirming no existing key/jobs; ignored .env and a separate Windows-user-only key backup retain it. Database/Redis data volumes were preserved. Dashboard/settings compilation and unauthenticated context denial passed. See [[Troubleshooting]]; no production deployment or new full-suite campaign was performed. Apply additive migrations once before future app/worker rollout. [[Production Operations]] owns deployment, backup and compatibility-gated rollback; qualified test stacks are disposable and do not establish hosted rollout.

## Next Safe Actions

The five product/implementation/design specifications were reconciled on 2026-10-11 (DEF-020); the [PRD](../THUNDERSTRUX_PRD.md) defines authority by subject. Free/paid membership entitlement parity, free-purchase cancellation and mixed-event publication remain later implementation targets. T08 introduces the scoped visual token source and resolves the BOOT-001 guard discovered during reconciliation, restoring single-primary traceability. Earlier delivery evidence and hosted gates remain dated; documentation reconciliation itself did not establish functionality/deployment evidence.

1. Start Package 4 ticket foundations (T10 -> T11 -> T12 -> T13) from refreshed main. Packages 1–3 are complete locally; STAFF-001 and BOOT-001 are resolved. Paid memberships/merchandise and T15 anonymous event details remain later packages.
2. Before activating account lifecycle, obtain independent security/migration review, provision and separately back up the notification key, and verify reliable Redis and real email acceptance.
3. Choose hosting and satisfy the release gates below. T43 still owns standalone images, immutable publication, SBOM/provenance and image-size work; do it when its dependencies are met.

## Production Release Gates

Unrestricted payments and broad staff rollout remain blocked pending:

- staff MFA enrollment/enforcement and migration away from legacy shared logins with LEGACY_ORGANISATION_ACCESS_MODE=deny;
- trusted-origin/proxy configuration and reliable Redis;
- scheduling/monitoring of email, notification, stale-order and compensation workers, notification key recovery and real provider/inbox evidence;
- refund webhooks, real Stripe automatic/manual refund acceptance and external alert delivery;
- encrypted off-machine backups, external health monitoring, a hosted restore drill, and representative query/index review;
- survey/closure or explicit acceptance of remaining audit coverage and API error normalization.

[[Production Operations]] provides current procedures; [[Production Readiness Verification 2026-09-22]] preserves earlier evidence. The issue register is authoritative for open release risks.

## Resource And Recovery Rules

Use only run-owned disposable test databases with simple names ending in _test. Never reset development or real-user data. Preserve retained backups (including tmp/thunderstrux-before-p319-20260921.dump if present), failed-run recovery manifests and unrelated caches/resources until their retention or recovery decision is explicit. Local Obsidian workspace state is ignored and must not be committed. Closure anonymisation is not reversed by code rollback; pause account mutations and buyer contact/ticket delivery before rolling back to incompatible older code.
