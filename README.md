# Thunderstrux

Thunderstrux is a Docker-based Next.js App Router platform for student societies. It covers:
- accounts, named staff with live roles and MFA, and an explicit dashboard context;
- society profiles and images, discovery and free joining;
- events with free and paid tickets (members and verified guests), check-in, memberships and merchandise;
- Stripe Connect payouts, analytics, a society calendar and an audit history.

Coding agents and contributors start with [AGENTS.md](AGENTS.md), the [Documentation Index](docs/obsidian/Documentation%20Index.md) and the [Project Handover](docs/obsidian/Project%20Handover.md). The Index routes each kind of task to the notes and code to read. The handover says where the project stands and what blocks real users.

## Stack

Next.js 16 App Router (Turbopack), React 19, Auth.js credentials, Prisma with PostgreSQL 16, Redis (Valkey when hosted) for rate limits, S3-compatible object storage for images, Tailwind CSS, Stripe Checkout and Connect Express, Resend for email, Docker Compose and pnpm. Exact versions are in `package.json` and `docker/`.

## Local development

Development is Docker-only. The `.env` database host `db` exists only inside the Compose network, so host `next dev` can't reach it. `pnpm dev` refuses to start outside Docker while `DATABASE_URL` points at `db:5432`.

```bash
cp .env.example .env
```

```bash
pnpm docker:dev
```

- Open the address `.env` sets as `NEXT_PUBLIC_APP_URL`; `http://localhost:3080` with the example file.
- Writes (forms, checkout) are accepted only from `NEXT_PUBLIC_APP_URL` and the origins in `TRUSTED_APP_ORIGINS`, so open exactly one of those addresses.
- PostgreSQL is on `localhost:5433` from the host and `db:5432` inside the stack.
- The dev stack is for loopback only. Never put it behind a public hostname: `next dev` answers development endpoints to anyone, and seeded accounts share a published password (SEC-014, SEC-015).

Everyday commands, the full `pnpm` script list, tests, rebuilds and traps are in [Development Workflow](docs/obsidian/Development%20Workflow.md). Every environment variable is in [Environment Variables](docs/obsidian/Environment%20Variables.md). Problems and fixes are in [Troubleshooting](docs/obsidian/Troubleshooting.md).

## Seeded accounts

The seed (`prisma/seed.mjs`, run by the dev stack) is for local loopback databases. On a public origin it refuses to run unless `SEED_DEMO_PASSWORD` (16+ characters) is set, and then uses it. Locally, every seeded account's password is `password123`.

| Kind | Accounts |
| --- | --- |
| Society (organisation) accounts | `engineering.org@`, `arts.org@`, `robotics.org@`, `payments.lab@`, `empty.org@example.com` |
| Member and staff test accounts | `user1@`, `user2@`, `admin@`, `event.manager@`, `finance@`, `content@`, `member@`, `empty@`, `outsider@example.com` |

Which of these hold staff roles where is in [Seeding and Data](docs/obsidian/Seeding%20and%20Data.md). The seed's own console table overstates some of them (OPS-006).

## Public preview

The public preview at `https://thunderstrux.mistayu.com` runs the production build as its own Compose project, `ops-preview`, separate from the dev stack. Its setup, deploy and worker commands are in [Production Operations](docs/obsidian/Production%20Operations.md#public-preview).

## Tests and delivery

- Every change goes through a PR to protected `main`, with local validation chosen by risk: [Engineering Delivery Workflow](docs/obsidian/Engineering%20Delivery%20Workflow.md).
- The isolated runner covers the production build, typecheck, integration tests, the browser campaign and real Stripe test mode: [E2E and Staging Payments](docs/obsidian/E2E%20and%20Staging%20Payments.md).
- `pnpm docs:check` keeps the documentation linked and matched to the code.

## Project structure

```text
app/         App Router pages (app/**/page.tsx) and API routes (app/api/**/route.ts)
components/  UI primitives (components/ui) and feature components
lib/         Domain services: auth, events, payments, commerce, email, ops, ...
prisma/      Schema, migrations and seed
scripts/     Dev, test-runner, worker, operations and deploy scripts
tests/       integration/, e2e/, runner/, setup/ and helpers/
docker/      Dockerfiles and the container entrypoint
deploy/      Single-host (Droplet) deployment files
config/      Schema contract: the newest migration readiness requires
docs/        Obsidian vault: obsidian/ (living notes), specs and plans
```

Each folder and module is described in [Thunderstrux Codebase Map](docs/obsidian/Thunderstrux%20Codebase%20Map.md), and every page in [Frontend and Backend Flow](docs/obsidian/Frontend%20and%20Backend%20Flow.md).
