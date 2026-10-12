# Thunderstrux

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies. It supports private account lifecycle, named staff and explicit dashboard context, safe society images, editable public profiles, anonymous society/event discovery, free society affiliation, ticket checkout and Stripe Connect.

Last reviewed: 2026-10-12 against main `4a8024b` (Package 3 merged). Packages 1–3 are implemented and locally qualified; Package 4 ticket foundations is next. Paid memberships, merchandise, guest checkout and OpenClaw remain future work. Local development is activated; hosted release gates remain open. The [readiness ledger](docs/MVP_READINESS_PLAN.md) owns exact completion and validation evidence.

Future coding agents and contributors should start with the [Documentation Index](docs/obsidian/Documentation%20Index.md), [Project Handover](docs/obsidian/Project%20Handover.md), and [Engineering Delivery Workflow](docs/obsidian/Engineering%20Delivery%20Workflow.md).

## Stack

For isolated browser tests and guided real Stripe test-mode acceptance, see
[E2E and Staging Payments](docs/obsidian/E2E%20and%20Staging%20Payments.md).
Run `pnpm test:e2e` with Docker Desktop available; it uses a separate stack on port 3100.

- Next.js 16 App Router with Turbopack
- React 19
- Auth.js / NextAuth Credentials provider
- Prisma
- PostgreSQL 16
- Tailwind CSS
- Docker Compose
- Stripe Checkout
- Stripe Connect Express
- pnpm

## Local Development

Development is Docker-only.

The project `.env` uses:

```text
DATABASE_URL=postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
```

The host name `db` only resolves inside the Docker Compose network. Do not run host `next dev` with this `.env`; it will fail to connect to Postgres.

Start the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Open:

```text
http://localhost:3080
```

Cloudflare Tunnel service URL: `http://127.0.0.1:3080`. For `https://thunderstrux.mistayu.com`, set AUTH_URL, NEXTAUTH_URL, NEXT_PUBLIC_APP_URL and TRUSTED_APP_ORIGINS to that public origin in ignored .env, then recreate the app. Next's development-origin allowlist includes this exact hostname so browser assets load through the tunnel. The container still listens on port 3000; APP_PORT only controls the host port.

Database from host:

```text
postgresql://thunderstrux:thunderstrux@localhost:5433/thunderstrux?schema=public
```

Database from app container:

```text
postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
```

## Common Commands

```bash
pnpm docker:up
pnpm docker:restart
docker compose exec app pnpm dev:doctor
docker compose exec app pnpm dev:webpack
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm prisma:generate
docker compose exec app pnpm seed
docker compose build app
pnpm docker:rebuild
docker compose logs -f app
```

Equivalent package helpers exist for host use:

```bash
pnpm docker:up
pnpm docker:restart
pnpm docker:migrate
pnpm docker:seed
pnpm docker:db:sync
pnpm docker:build
pnpm docker:rebuild
```

## Builds and App Recreation

Do not run this against a running app container:

```bash
docker compose exec app pnpm build
```

The production container serves the `.next-build` output through a running `next start` process. Running `pnpm build` inside that same container mutates `.next-build` while the server still has the previous build manifest in memory. That can desynchronise CSS/static chunks and routes, causing assets to return `404`.

Use these commands instead:

```bash
pnpm docker:build
pnpm docker:rebuild
```

If an in-container build was already run, recreate the app container:

```bash
pnpm docker:rebuild
```

The development restart/rebuild helpers rebuild the app, replace only the labelled `node_modules` dependency-cache volume, regenerate Prisma Client, apply migrations, and then start the dev server. They preserve the PostgreSQL and Redis data volumes. Production uses the separate one-shot migration service through `pnpm ops:deploy`; ordinary production app startup does not run migrations.

Society image storage uses the development object-store service and persistent `asset_data` volume. Normal development startup above includes it; when refreshing an older stack, start it before the app helper with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build object-store`. Back up the database before pending migrations; preserve database, Redis and object bytes. Hosted S3 configuration and metadata/object recovery are covered in [Society Profiles and Assets](docs/obsidian/Society%20Profiles%20and%20Assets.md).

## Account Model

`User.accountRole` is either:

- `member`
- `organisation`

Member accounts can complete a profile, join organisations, browse public events, buy tickets, and view `/tickets`.

Member staff start in personal mode and explicitly select a live authorised society; selection never grants authority. Free affiliation is separate from paid entitlements and staff access. A verified organisation account bootstraps one primary society and opens resumable profile setup. Owner handover permanently retires the bootstrap pointer; retained active staff authority still blocks a second primary bootstrap.

Organisation management normally uses an active `OrganisationStaff` record, its live role and permissions, and the canonical organisation resolved by the server. Named staff accounts, invitations, live revocation, TOTP MFA, recovery codes, and actor-attributed audit records are implemented.

`Organisation.accountUserId` remains a deliberately controlled migration fallback for legacy organisation logins. Production rollout must enroll staff, enforce MFA, and set `LEGACY_ORGANISATION_ACCESS_MODE=deny` before shared access is considered retired. See [Authentication and Dashboard Access](docs/obsidian/Authentication%20and%20Dashboard%20Access.md) and [Production Readiness Verification](docs/obsidian/Production%20Readiness%20Verification%202026-09-22.md).

## Seeded Accounts

All seeded accounts use:

```text
password123
```

Organisation accounts:

- `engineering.org@example.com`
- `arts.org@example.com`
- `robotics.org@example.com`
- `payments.lab@example.com`
- `empty.org@example.com`

Member/test accounts:

- `user1@example.com`
- `user2@example.com`
- `admin@example.com`
- `event.manager@example.com`
- `finance@example.com`
- `content@example.com`
- `member@example.com`
- `empty@example.com`
- `outsider@example.com`

## Main Routes

Public:

- `/`
- `/societies`
- `/societies/[orgSlug]`
- `/events/[eventId]`
- `/login`
- `/signup`
- `/verify-email`
- `/forgot-password`
- `/reset-password`
- `/change-email`
- `/staff/invites/accept`

The public event API is anonymous, but `/events/[eventId]` HTML still requires authentication through the proxy; anonymous event detail is planned in T15. Society discovery/profile HTML is anonymous.

Private account:

- `/account/settings`
- `/mfa`

Member:

- `/dashboard`
- `/dashboard/organisations`
- `/tickets`

Organisation:

- `/dashboard`
- `/dashboard/create`
- `/dashboard/events`
- `/dashboard/events/new`
- `/dashboard/events/[eventId]/edit`
- `/dashboard/orders`
- `/dashboard/settings`
- `/dashboard/settings/profile`
- `/dashboard/settings/staff`
- `/dashboard/notifications`

Legacy compatibility redirects:

- `/dashboard/[orgSlug]`
- `/dashboard/[orgSlug]/events`
- `/dashboard/[orgSlug]/events/new`
- `/dashboard/[orgSlug]/events/[eventId]/edit`
- `/dashboard/[orgSlug]/orders`
- `/dashboard/[orgSlug]/settings`

## Next.js Stability Notes

- Dev output writes to `.next`.
- Production build output writes to `.next-build`.
- `pnpm dev` clears `.next/dev` before startup.
- `pnpm dev` uses Turbopack by default.
- `pnpm dev:webpack` is the safe fallback if Turbopack route manifests or hot reload become unstable.
- `pnpm dev:doctor` prints a read-only report for stuck dev-server symptoms and stale generated metadata.
- `pnpm build` runs `scripts/prepare-next-build.mjs` and `prisma generate` before `next build`.
- `pnpm build` is blocked inside the running production-like app container. Rebuild the image instead.
- `tsconfig.json` must not include `.next/dev/types/**/*.ts`; stale dev route types can break production builds.
- The current route guard uses `proxy.ts`, not deprecated `middleware.ts`.
- Turbopack root is pinned in `next.config.ts` so unrelated lockfiles outside the repo do not affect workspace detection.
- `scripts/assert-docker-runtime.mjs` warns by default, but blocks `pnpm dev` outside Docker when `.env` points at `db:5432`.

## Project Structure

```text
app/           App Router pages and API routes
components/    UI and feature components
lib/           Auth, Prisma, validators, Stripe, client helpers
prisma/        Schema, migrations, seed script
docs/obsidian/ Internal codebase notes
docker/        Dockerfile and container setup
scripts/       Local development safety scripts
```
