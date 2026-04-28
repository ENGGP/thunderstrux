# Thunderstrux

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies. It supports member and organisation accounts, organisation event management, public event discovery, ticket checkout, and Stripe Connect.

Last reviewed: 2026-04-28

## Stack

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
docker compose up -d
```

Open:

```text
http://localhost:3000
```

Database from host:

```text
postgresql://thunderstrux:thunderstrux@localhost:5432/thunderstrux?schema=public
```

Database from app container:

```text
postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
```

## Common Commands

```bash
docker compose up -d
docker compose restart app
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm prisma:generate
docker compose exec app pnpm seed
docker compose exec app pnpm build
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
```

## Account Model

`User.accountRole` is either:

- `member`
- `organisation`

Member accounts can complete a profile, join organisations, browse public events, buy tickets, and view `/tickets`.

Organisation accounts represent exactly one organisation via `Organisation.accountUserId` and manage it at `/dashboard`.

For MVP, organisation committee members may share one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

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
- `/events/[eventId]`
- `/login`
- `/signup`

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
- `pnpm build` runs `scripts/prepare-next-build.mjs` before `next build`.
- `tsconfig.json` must not include `.next/dev/types/**/*.ts`; stale dev route types can break production builds.
- The current route guard uses `proxy.ts`, not deprecated `middleware.ts`.
- Turbopack root is pinned in `next.config.ts` so unrelated lockfiles outside the repo do not affect workspace detection.

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
