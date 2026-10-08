# Thunderstrux Agent Instructions

This repository is a Docker-first Next.js application handling tenant data, tickets, and Stripe payments. Before changing code, read these documents in order:

1. [Documentation Index](docs/obsidian/Documentation%20Index.md)
2. [Project Handover](docs/obsidian/Project%20Handover.md)
3. [Engineering Delivery Workflow](docs/obsidian/Engineering%20Delivery%20Workflow.md)
4. [Issue and Defect Register](docs/obsidian/Non-Blocking%20Issue%20Register.md)
5. [Product Requirements](docs/THUNDERSTRUX_PRD.md)

## Required Practices

- Start focused work from refreshed `origin/main` on a `codex/<description>` branch. Preserve unrelated user changes. Never use destructive cleanup to make a checkout look clean.
- Use Docker for normal development. Integration tests may run only against a disposable database whose name contains `_test`.
- Treat `Event.organisationId` as the canonical tenant owner for event-owned orders, tickets, and reservations. Client IDs, headers, membership rows, and denormalized organisation fields are not authority.
- Keep payment fulfilment webhook-driven and idempotent. Stripe remains provider truth. Never mark an order paid from a browser success page.
- Preserve trusted-origin/CSRF, authentication, live staff authority, permission, tenant, and rate-limit checks when changing protected routes.
- Add focused regression coverage for behavior changes. Validate according to the risk matrix in the engineering workflow.
- Use additive migrations where possible. Production migrations run as a one-shot deployment job before app rollout; ordinary production app startup does not migrate.
- Update living documentation, the issue register, and `Project Handover` when behavior, operations, risks, or evidence changes.
- Deliver changes through a PR to protected `main` with recorded risk-appropriate local validation. GitHub test checks are not required. Documentation-only changes use docs/diff checks and claim review; do not run functionality tests. Repeat tests only when changed inputs, failures, or identified risks justify it.

`Project Handover` is the only handover document. Preserve dated implementation and release evidence in the relevant living reference, evidence ledger, PR, and Git history.
