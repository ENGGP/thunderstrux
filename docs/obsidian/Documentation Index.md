---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Project Handover]]", "[[Glossary]]", "[[Thunderstrux Codebase Map]]"]
sources: [AGENTS.md, scripts/check-docs.mjs, tests/runner/docs-check.test.mjs]
---

# Documentation Index

**Owns:** where to look. It routes a task to the notes and code to read, and sets how these notes are written and checked.
**Read when:** at the start of every session, then read [[Project Handover]], then the notes your task row names. For a question that crosses areas, grep `docs/obsidian/` for the identifier; each fact lives in one note.
**Not here:** any rule or behaviour. Every fact has one owning note, listed below.

The Obsidian vault is `docs/`. The living notes are `docs/obsidian/*.md`; dated records are in `docs/obsidian/History/`. Links are `[[Note name]]` and resolve to `docs/obsidian/Note name.md` (or `docs/<NAME>.md` for the specs). Code, schema, configuration and provider state are the truth: if a note disagrees with them, the note is wrong. Fix it, or register the gap in [[Issue and Defect Register]].

## Route by task

| You are about to… | Read | Start in code |
| --- | --- | --- |
| Look up a word ("society", "hold", "compensation", "family") | [[Glossary]] | — |
| Find where something lives | [[Thunderstrux Codebase Map]], [[Architecture Overview]] | — |
| Change a page, layout or component | [[Frontend and Backend Flow]], [[UI Architecture Rules]], [[Accessibility Review]] | `app/`, `components/` |
| Add or change an API route | [[API Reference]], [[Route Security Inventory]], [[Audit Coverage]] | `app/api/`, `lib/api/errors.ts`, `lib/security/request-guard.ts` |
| Touch sign-in, sessions, roles, permissions, MFA, staff, guests or closure | [[Authentication and Dashboard Access]] | `lib/auth/`, `lib/permissions/index.ts`, `lib/staff/`, `lib/guest/`, `proxy.ts`, `auth.ts` |
| Change the schema, a migration or tenant scoping | [[Database and Multi Tenancy]] | `prisma/schema.prisma`, `prisma/migrations/`, `config/schema-contract.json` |
| Change events, ticket types, publishing or sales | [[Event Lifecycle]] | `lib/events/`, `lib/validators/events.ts` |
| Change checkout, orders or holds | [[Payment Lifecycle]], [[Stripe Payments and Connect]] | `lib/payments/`, `lib/tickets/reservations.ts`, `lib/commerce/`, `lib/purchases/` |
| Change refunds, disputes, reversals or compensation | [[Payment Lifecycle Refunds and Disputes]], [[Payment Lifecycle]] | `lib/payments/order-refunds.ts`, `lib/payments/compensation-refunds.ts`, `lib/payments/purchase-disputes.ts`, `lib/payments/dispute-reversals.ts` |
| Change Stripe Connect, payouts, fees or webhooks | [[Stripe Payments and Connect]] | `lib/stripe/`, `lib/payouts/`, `app/api/payments/webhook/`, `app/api/stripe/connect/` |
| Change memberships or merchandise | [[Memberships and Merchandise]], [[Payment Lifecycle]] | `lib/memberships/`, `lib/merchandise/`, `lib/commerce/` |
| Change society profiles, joining or images | [[Society Profiles and Assets]] | `lib/organisations/`, `lib/assets/` |
| Change check-in | [[Ticket Check-in Implementation]] | `lib/tickets/check-in.ts` |
| Change analytics or the calendar | [[Analytics and Calendar]] | `lib/analytics/`, `lib/events/calendar.ts` |
| Change emails or notices | [[Email Delivery Implementation]] | `lib/email/` |
| Add a sensitive action (it needs an audit row) | [[Audit Coverage]] | `lib/audit/history.ts` |
| Add or read an environment variable | [[Environment Variables]] | `.env.example`, `docker/entrypoint.sh` |
| Run the app or tests locally | [[Development Workflow]], [[Troubleshooting]], [[Seeding and Data]] | `package.json`, `scripts/`, `prisma/seed.mjs` |
| Validate and deliver a change | [[Engineering Delivery Workflow]], [[E2E and Staging Payments]], [[Journey Qualification]] | `scripts/run-e2e.mjs`, `tests/` |
| Deploy, schedule workers, handle an alert, back up or restore | [[Production Operations]], [[Production Operations Alerts]], [[Production Operations Hosting]], [[Pre-hosting Candidate]] | `scripts/operations.mjs`, `scripts/droplet.mjs`, `lib/ops/` |
| Update dependencies | [[Dependency Automation]] | `renovate.json`, `package.json` |
| Debug something that looks broken | [[Troubleshooting]], [[Issue and Defect Register]], [[Resolved Defects]] | — |
| Check product intent or a target design | [[THUNDERSTRUX_PRD\|Product Requirements]], then the specs below by section | — |

## Notes by area

- **Start:** [[Project Handover]] · [[Engineering Delivery Workflow]] · [[Issue and Defect Register]] · [[Glossary]]
- **Architecture:** [[Architecture Overview]] · [[Thunderstrux Codebase Map]] · [[Database and Multi Tenancy]]
- **Domain:** [[Authentication and Dashboard Access]] · [[Event Lifecycle]] · [[Ticket Check-in Implementation]] · [[Payment Lifecycle]] · [[Payment Lifecycle Refunds and Disputes]] · [[Stripe Payments and Connect]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]] · [[Analytics and Calendar]] · [[Email Delivery Implementation]] · [[Audit Coverage]]
- **Interfaces:** [[API Reference]] · [[Route Security Inventory]] · [[Frontend and Backend Flow]] · [[UI Architecture Rules]] · [[Accessibility Review]]
- **Operations:** [[Environment Variables]] · [[Development Workflow]] · [[Troubleshooting]] · [[Seeding and Data]] · [[Production Operations]] · [[Production Operations Alerts]] · [[Production Operations Hosting]] · [[Pre-hosting Candidate]] · [[Dependency Automation]] · [[E2E and Staging Payments]] · [[Journey Qualification]]
- **History** (dated; read only for evidence): [[Resolved Defects]] · [[Evidence Ledger]] · [[Project Handover 2026-10-25]] · [[Project Handover 2026-10-15]] · [[Project Handover 2026-10-12]] · [[Docker Architecture Assessment 2026-09-29]] · [[Production Readiness Verification 2026-09-22]] · [[Dependency Advisory Triage 2026-09-18]]

## Specs and plans outside the living notes

These are target contracts and planning records, not descriptions of the code. They are large, so search them by task ID or section number instead of reading them whole.

| Document | Size | Use |
| --- | --- | --- |
| [[THUNDERSTRUX_PRD\|Product Requirements]] | ~26 KB (one read) | Product intent, and which spec has authority on which subject |
| [[MVP_READINESS_PLAN\|Readiness Plan]] | ~280 KB | Task order (T01 to T53) and detailed acceptance; grep a task ID |
| [[THUNDERSTRUX_UX_USER_FLOW_SPEC\|UX Specification]] | ~165 KB | Target user flows; grep a flow or section ID |
| [[THUNDERSTRUX_DATABASE_ARCHITECTURE_AND_SCHEMA_SPEC\|Database Specification]] | ~152 KB | Target data contracts; the real schema is `prisma/schema.prisma` |
| [[THUNDERSTRUX_COMPLETE_VISUAL_DESIGN_SPEC\|Visual Design]] | ~151 KB | Target visual system; tokens in code are in [[UI Architecture Rules]] |
| [[MVP_DELIVERY_PLAN_T10_T46\|MVP Delivery Plan]] | ~65 KB | The T10 to T46 working plan (historical) |
| `docs/cache/` | — | Archived earlier roadmaps (historical) |

## How these notes are written

Every living note follows the same shape so it is quick to scan:
- **Header:** frontmatter (`status`, `last-reviewed`, `owner`, `related`, `sources`), then three bold lines after the title: **Owns**, **Read when**, **Not here**.
- **Section names:** `## Code` (concern → file table), topic sections or `## Rules` and `## States`, `## Traps`, `## Failure and recovery`, `## Related`. Empty sections are left out.
- **One owner per fact.** Other notes link to it (`[[Note#Heading]]`) instead of copying it; copies are how the notes used to contradict each other.
- **Exact identifiers in backticks:** paths, functions, permissions, enum values, error codes, env vars, routes and scripts. That keeps them greppable and lets the checker verify them.
- **No copied counts or versions** (migrations, models, tests, package versions). Name the source file instead. Only the handover keeps a dated snapshot.
- **No history.** Run IDs and test counts go in the PR description; register outcomes go to [[Resolved Defects]].
- **Keep the why.** A rule that isn't obvious from code gets one line saying why.
- **Size:** each living note stays under 32 KB, so one read returns all of it.

## What `pnpm docs:check` enforces

`scripts/check-docs.mjs` runs in CI static validation and must pass before any PR. Its rules are tested in `tests/runner/docs-check.test.mjs`. It fails when:
- **Links:** a link target doesn't exist or is ambiguous; a link leaves the vault (`docs/`); or a `#heading` anchor doesn't exist.
- **Living notes:** a note names a backticked repository path, test file or frontmatter source that doesn't exist (`History/` is exempt), or is over 32 KB.
- **Coverage:** code exists that its owning note doesn't name in backticks.

| Code | Owning note |
| --- | --- |
| Every API route | [[API Reference]] and [[Route Security Inventory]] |
| Every page | [[Frontend and Backend Flow]] |
| Every `lib/*` and `components/*` entry | [[Thunderstrux Codebase Map]] |
| Every Prisma model and enum | [[Database and Multi Tenancy]] |
| Every `process.env` read | [[Environment Variables]] |
| Every alert name | [[Production Operations Alerts]] |
| Every permission and staff role | [[Authentication and Dashboard Access]] |
| Every rate-limit policy | [[Route Security Inventory]] |
| Every audit action | [[Audit Coverage]] |
| Every email template | [[Email Delivery Implementation]] |
| Every package script and script file | any living note |

## Maintenance

- Update the owning note in the same PR as the behaviour or operational change. Review stale claims against the code; don't just advance `last-reviewed`.
- `status: current` marks the one handover, `living` the maintained notes, and `historical` the dated records. When a handover is superseded, move it to `History/` with its date in the name.
- Never store secrets, complete tokens, personal data, raw provider payloads, generated caches or `docs/.obsidian/workspace.json` in Git.
- Documentation-only delivery runs `pnpm docs:check`, `git diff --check` and a claim review against the code. No functionality tests.
