---
status: living
last-reviewed: 2026-10-12
owner: engineering
related: ["[[Project Handover]]", "[[Thunderstrux Codebase Map]]"]
sources: [AGENTS.md, scripts/check-docs.mjs]
---

# Documentation Index

The project knowledge map: use [[Project Handover]] for current state, the living notes for behavior/procedures, and historical notes for dated evidence. Living references were reviewed against merged main `4a8024b` on 2026-10-12: Packages 1–3 are locally qualified, local development is activated, and Package 4 follows the specification-alignment refactor recorded in the handover. Hosted activation remains unverified. This documentation review adds no functionality/provider evidence; historical notes retain their original dates and observations. Target specifications describe future contracts, not delivered features.

## Start Here

1. [[Project Handover]]: current session state, active contracts, risks and next safe actions.
2. [[Engineering Delivery Workflow]]: focused branching, local validation by risk, review, cleanup and PR delivery.
3. [[Issue and Defect Register|Issue and Defect Register]]: canonical defects, accepted risks and external gates.
4. [[THUNDERSTRUX_PRD|Product Requirements]] and [[MVP_READINESS_PLAN|Readiness Plan]] (work packages, task order and substeps) ? product intent and delivery sequence.
5. Read only the relevant living reference and its code sources. [[MVP_READINESS_PLAN|Readiness Plan]] owns detailed acceptance and delivery evidence.
6. [[THUNDERSTRUX_PRD|Product Requirements]] defines authority by subject for the [[THUNDERSTRUX_DATABASE_ARCHITECTURE_AND_SCHEMA_SPEC|Database Specification]], [[THUNDERSTRUX_UX_USER_FLOW_SPEC|UX Specification]] and [[THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC|Visual Design]]. These are target contracts; the readiness ledger and handover record delivery, and code/provider observations establish implementation facts.

## Find The Right Note

| Question | Living references |
| --- | --- |
| What is implemented and where is the code? | [[Project Handover]], [[Thunderstrux Codebase Map]], [[Architecture Overview]] |
| What would go to hosting, and what is still outstanding? | [[Pre-hosting Candidate]] |
| How do I implement and validate a change locally? | [[Engineering Delivery Workflow]], [[Development Workflow]] |
| How do login, verification, recovery, staff authority and closure work? | [[Authentication and Dashboard Access]], [[API Reference]], [[Database and Multi Tenancy]] |
| How do pages, navigation and requests fit together? | [[Frontend and Backend Flow]], [[UI Architecture Rules]] |
| How do events and attendance work? | [[Event Lifecycle]], [[Ticket Check-in Implementation]] |
| How do society profiles and safe image assets work? | [[Society Profiles and Assets]] |
| How do membership plans (and later merchandise) work? | [[Memberships and Merchandise]], [[Payment Lifecycle]] |
| How are sales, attendance and engagement numbers computed, and how does the society calendar work? | [[Analytics and Calendar]] |
| Which actions are audited, and what does the society History show? | [[Audit Coverage]] |
| What does every API route check, and which security headers and limits apply? | [[Route Security Inventory]] |
| How is accessibility checked, and what still needs a person? | [[Accessibility Review]] |
| Which test proves each section 7 user journey? | [[Journey Qualification]] |
| What creates seed data and why is it missing? | [[Seeding and Data]], [[Troubleshooting]] |
| What is payment truth and how do I recover an order? | [[Stripe Payments and Connect]], [[Payment Lifecycle]], [[E2E and Staging Payments]] |
| How do ticket emails and encrypted account notices work? | [[Email Delivery Implementation]], [[Production Operations]] |
| How do I deploy, migrate, restore or roll back? | [[Production Operations]], [[Database and Multi Tenancy]], [[Project Handover]] |
| What versions/overrides are pinned and how are audits handled? | [[Dependency Automation]], [[Troubleshooting]] |
| Which risks remain open? | [[Issue and Defect Register]], [[MVP_READINESS_PLAN|Readiness Plan]] |

## Historical Evidence

These notes retain their original findings and dates. They do not define today's runtime or delivery policy:

- [[Project Handover 2026-10-25]]: the handover for the 2026-10-15 to 2026-10-25 session (planning and delivering T10 to T46, then the Stripe audit and its fixes, PRs #68 to #166, with every dev database dump and activation) as it stood at main `1bc34ef`; superseded by [[Project Handover]] when the codebase audit session began.
- [[Project Handover 2026-10-15]]: the handover for the 2026-10-12 to 2026-10-15 session (specification-alignment refactor, tunnel and Redis fixes, UX redesign and design-system sync) as it stood at main `33e84ce`; superseded by [[Project Handover]] when the T10–T46 delivery session began.
- [[Project Handover 2026-10-12]]: the handover for PR #31 to PR #53 delivery with its qualification evidence; superseded by [[Project Handover]] when a new session began.
- [[Dependency Advisory Triage 2026-09-18]]: original advisory inventory; current patches/override removal conditions are in [[Dependency Automation]].
- [[Production Readiness Verification 2026-09-22]]: earlier remediation acceptance; current release procedures and remaining gates are in [[Production Operations]] and the handover.
- [[Docker Architecture Assessment 2026-09-29]]: topology/design assessment and subsequent foundation evidence; current runtime uses Node 22 and local validation.

Earlier documentation governance merged in PRs #21, #23 and #24; the current readiness plan/work packages came through #26/#30 (the separate work packages note was folded into the readiness plan on 2026-10-16), with baseline qualification in #28. Their implementation evidence remains in the relevant notes, merged PRs and Git history. [[Project Handover 2026-10-12]] covers PR #31 to PR #53, [[Project Handover 2026-10-15]] covers PRs #54 to #67 and [[Project Handover 2026-10-25]] covers PRs #68 to #166; keep the current handover focused on the session it describes.

## Sources And Maintenance

- Code/schema/package/Compose/provider state establish actual behavior; user-authorized [[Engineering Delivery Workflow]] establishes current delivery policy. Record disagreements in the issue register and correct the owning note.
- `sources` in note metadata lists paths relative to the repository root. `related` links connect concepts without copying their full contracts.
- `status: current` identifies the sole handover; `living` identifies maintained references/runbooks; `historical` identifies dated evidence/assessments. Preserve original event dates and label evidence local, CI, staging or production.
- Put each durable contract in its owning reference. Link from the handover; record open risks once in the issue register and detailed acceptance once in the readiness ledger or PR.
- Update affected notes in the same PR as behavior or operational changes. Review stale claims against code; do not merely advance review dates.
- Do not store secrets, complete tokens, personal data, raw provider payloads, generated caches or local .obsidian workspace state in Git.
- Documentation-only delivery uses `pnpm docs:check`, `git diff --check` and claim/reference review. Do not run functionality tests. No routine GitHub checks or repeated E2E campaigns are required.
