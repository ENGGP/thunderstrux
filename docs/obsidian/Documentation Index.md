---
status: living
last-reviewed: 2026-10-09
owner: engineering
related: ["[[Project Handover]]", "[[Thunderstrux Codebase Map]]"]
sources: [AGENTS.md, scripts/check-docs.mjs]
---

# Documentation Index

The project knowledge map: use [[Project Handover]] for current state, the living notes for behavior/procedures, and historical notes for dated evidence. Repository implementation is not hosted activation. This vault was reviewed against merged main b9a113d on 2026-10-09; review dates describe editorial/code-reference review, not new functionality tests or runtime verification.

## Start Here

1. [[Project Handover]] ? current delivery from PR #31 onward, active risks and next safe actions.
2. [[Engineering Delivery Workflow]] ? focused branching, local validation by risk, review, cleanup and PR delivery.
3. [[Non-Blocking Issue Register|Issue and Defect Register]] ? canonical defects, accepted risks and external gates.
4. [[../THUNDERSTRUX_PRD|Product Requirements]] and [[../MVP_READINESS_WORK_PACKAGES|Work Packages]] ? product intent and delivery sequence.
5. Read only the relevant living reference and its code sources. [[../MVP_READINESS_PLAN|Readiness Plan]] owns detailed acceptance and delivery evidence.

## Find The Right Note

| Question | Living references |
| --- | --- |
| What is implemented and where is the code? | [[Project Handover]], [[Thunderstrux Codebase Map]], [[Architecture Overview]] |
| How do I implement and validate a change locally? | [[Engineering Delivery Workflow]], [[Development Workflow]] |
| How do login, verification, recovery, staff authority and closure work? | [[Authentication and Dashboard Access]], [[API Reference]], [[Database and Multi Tenancy]] |
| How do pages, navigation and requests fit together? | [[Frontend and Backend Flow]], [[UI Architecture Rules]] |
| How do events and attendance work? | [[Event Lifecycle]], [[Ticket Check-in Implementation]] |
| What creates seed data and why is it missing? | [[Seeding and Data]], [[Troubleshooting]] |
| What is payment truth and how do I recover an order? | [[Stripe Payments and Connect]], [[Payment Lifecycle]], [[E2E and Staging Payments]] |
| How do ticket emails and encrypted account notices work? | [[Email Delivery Implementation]], [[Production Operations]] |
| How do I deploy, migrate, restore or roll back? | [[Production Operations]], [[Database and Multi Tenancy]], [[Project Handover]] |
| What versions/overrides are pinned and how are audits handled? | [[Dependency Automation]], [[Troubleshooting]] |
| Which risks remain open? | [[Non-Blocking Issue Register]], [[../MVP_READINESS_PLAN|Readiness Plan]] |

## Historical Evidence

These notes retain their original findings and dates. They do not define today's runtime or delivery policy:

- [[Dependency Advisory Triage 2026-09-18]] ? original advisory inventory; current patches/override removal conditions are in [[Dependency Automation]].
- [[Production Readiness Verification 2026-09-22]] ? earlier remediation acceptance; current release procedures and remaining gates are in [[Production Operations]] and the handover.
- [[Docker Architecture Assessment 2026-09-29]] ? topology/design assessment and subsequent foundation evidence; current runtime uses Node 22 and local validation.

Earlier documentation governance merged in PRs #21, #23 and #24; the current readiness plan/work packages came through #26/#30, with baseline qualification in #28. Their implementation evidence remains in the relevant notes, merged PRs and Git history. Keep the handover focused on PR #31 onward.

## Sources And Maintenance

- Code/schema/package/Compose/provider state establish actual behavior; user-authorized [[Engineering Delivery Workflow]] establishes current delivery policy. Record disagreements in the issue register and correct the owning note.
- `sources` in note metadata lists paths relative to the repository root. `related` links connect concepts without copying their full contracts.
- `status: current` identifies the sole handover; `living` identifies maintained references/runbooks; `historical` identifies dated evidence/assessments. Preserve original event dates and label evidence local, CI, staging or production.
- Put each durable contract in its owning reference. Link from the handover; record open risks once in the issue register and detailed acceptance once in the readiness ledger or PR.
- Update affected notes in the same PR as behavior or operational changes. Review stale claims against code; do not merely advance review dates.
- Do not store secrets, complete tokens, personal data, raw provider payloads, generated caches or local .obsidian workspace state in Git.
- Documentation-only delivery uses `pnpm docs:check`, `git diff --check` and claim/reference review. Do not run functionality tests. No routine GitHub checks or repeated E2E campaigns are required.
