# Thunderstrux Agent Instructions

This repository is a Docker-first Next.js application handling tenant data, tickets, and Stripe payments. Before changing code, read:

1. [Documentation Index](docs/obsidian/Documentation%20Index.md): it routes your task to the notes and code to read.
2. [Project Handover](docs/obsidian/Project%20Handover.md): current state, what blocks real users, and next safe actions.
3. The notes your task's row in the Index names. For anything cross-cutting, grep `docs/obsidian/` for the identifier rather than reading more notes whole.

Read [Engineering Delivery Workflow](docs/obsidian/Engineering%20Delivery%20Workflow.md) before you validate or deliver. Read the [Issue and Defect Register](docs/obsidian/Issue%20and%20Defect%20Register.md) when you touch an area with an open item or find a defect, and the [Product Requirements](docs/THUNDERSTRUX_PRD.md) when product intent matters. Search the large specs and the readiness plan by section or task ID; don't read them whole.

## Required Practices

- Start focused work from refreshed `origin/main` on a `codex/<description>` branch. Preserve unrelated user changes. Never use destructive cleanup to make a checkout look clean.
- Use Docker for normal development. Integration tests may run only against a disposable database whose simple name ends in `_test`.
- Treat `Event.organisationId` as the canonical tenant owner for event-owned orders, tickets, and reservations. Client IDs, headers, membership rows, and denormalized organisation fields are not authority.
- Keep payment fulfilment webhook-driven and idempotent. Stripe remains provider truth. Never mark an order paid from a browser success page.
- Preserve trusted-origin/CSRF, authentication, live staff authority, permission, tenant, and rate-limit checks when changing protected routes.
- Add focused regression coverage for behavior changes. Validate according to the risk matrix in the engineering workflow.
- Use additive migrations where possible. Production migrations run as a one-shot deployment job before app rollout; ordinary production app startup does not migrate.
- Update the owning living note (the Index says which), the issue register, and `Project Handover` in the same PR when behavior, operations, risks, or release state change. `pnpm docs:check` fails on broken links, stale code paths, and code its owning note doesn't name.
- Deliver changes through a PR to protected `main` with recorded risk-appropriate local validation. GitHub test checks are not required. Documentation-only changes use docs/diff checks and claim review; do not run functionality tests. Repeat tests only when changed inputs, failures, or identified risks justify it.

`Project Handover` is the only current handover document; a superseded handover moves to `docs/obsidian/History/` as a dated note. Record run IDs and validation evidence in the PR description; living notes describe current behavior only, and `docs/obsidian/History/` keeps dated records (Resolved Defects, Evidence Ledger, past handovers).
