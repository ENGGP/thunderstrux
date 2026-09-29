---
status: living
last-reviewed: 2026-09-29
owner: engineering
---

# Documentation Index

This is the entry point for engineers and coding agents. Documentation supports the code; it does not override current code, schema, migrations, configuration, or provider behavior.

## Start Here

Read these in order before implementation:

1. [[Current Handover]] — current repository state, active work, release gates, and next safe actions.
2. [[Engineering Delivery Workflow]] — required planning, branching, implementation, validation, review, PR, and handover procedure.
3. [[Non-Blocking Issue Register|Issue and Defect Register]] — open defects, accepted debt, external gates, and resolved defect history.
4. [[Thunderstrux Codebase Map]] and [[Architecture Overview]] — repository layout and system boundaries.
5. [[../THUNDERSTRUX_PRD|Thunderstrux PRD]] and [[../production-readiness-remediation-plan|Production Readiness Remediation Plan]] — product intent and production-risk roadmap.

Then read the living reference for the subsystem being changed.

## Document Classes

| Class | Purpose | Update rule |
| --- | --- | --- |
| Living reference | Current behavior, architecture, development, or operations | Update in the same PR as behavior changes |
| Current handover | Short current-state and next-action summary | Update before ending material work |
| Issue and defect register | Canonical open-risk and defect-resolution record | Add discoveries promptly; resolve only with evidence |
| Evidence ledger | Dated acceptance and release-gate evidence | Append verified evidence; distinguish repository checks from hosted activation |
| Dated handover | Immutable snapshot of a completed workstream | Do not rewrite to look current; supersede through links |
| Runbook | Repeatable operational or troubleshooting procedure | Test commands before publishing |

## Living References

- [[Development Workflow]] — Docker setup, commands, environments, and local recovery.
- [[Authentication and Dashboard Access]] — sessions, staff authority, MFA, roles, and access behavior.
- [[Database and Multi Tenancy]] — schema, canonical ownership, migrations, and integrity rules.
- [[API Reference]] — route contracts and error conventions.
- [[Frontend and Backend Flow]] and [[UI Architecture Rules]] — request/UI flow and interface conventions.
- [[Event Lifecycle]], [[Ticket Check-in Implementation]], and [[Seeding and Data]] — event, attendance, and local data behavior.
- [[Stripe Payments and Connect]], [[Payment Lifecycle]], [[Email Delivery Implementation]], and [[E2E and Staging Payments]] — payments, lifecycle history, delivery, and provider acceptance.
- [[Production Operations]] and [[Production Readiness Verification 2026-09-22]] — deployment tooling, recovery, evidence, and external release gates.
- [[Dependency Automation]] — pinned dependencies, Renovate policy, audit behavior, and dependency PR validation.
- [[Troubleshooting]] — symptom-based diagnosis and safe recovery.

## Source-of-Truth Order

When sources disagree, verify in this order:

1. Current code, schema, migrations, package manifest, Compose files, and CI workflows.
2. Current provider or hosted-environment state when the question is operational.
3. `Current Handover`, the relevant living reference, and the issue register.
4. Dated evidence ledgers and handovers.

Record any discovered disagreement as a documentation defect and correct the living documents in the same PR.

## Documentation Quality Rules

- Use exact dates and label evidence as local, CI, staging, or production.
- Never publish secrets, complete tokens, raw payment payloads, or personal data.
- Link to durable files, PRs, commits, tests, or runbooks for important claims.
- State limitations and external activation work alongside completed repository work.
- Run `pnpm docs:check` and `git diff --check` before opening a PR.
