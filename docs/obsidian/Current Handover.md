# Current Handover

Read this first, then [[Thunderstrux Codebase Map]].

## Current State

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies with:

- Auth.js credentials auth.
- Two account roles: `member` and `organisation`.
- Member profile onboarding, organisation search/join, public event browsing, ticket checkout, and `/tickets`.
- Organisation accounts that own exactly one organisation through `Organisation.accountUserId`.
- Organisation dashboard at `/dashboard`.
- Organisation management routes at `/dashboard/events`, `/dashboard/orders`, and `/dashboard/settings`.
- Legacy `/dashboard/[orgSlug]/*` routes kept as redirects.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Stripe Checkout with webhook-only fulfilment.
- Stripe Connect Express onboarding with explicit lifecycle states.

For MVP, organisation committee members may share the one organisation login. Future security work should add named staff users, staff invites, MFA, audit logs, and per-user permissions.

## Latest Migration

The account role/platform structure migration is implemented.

Changed areas:

- `prisma/schema.prisma`
- `prisma/migrations/20260428000000_account_role_groundwork/migration.sql`
- `auth.ts`
- `next-auth.d.ts`
- `lib/auth/access.ts`
- `app/api/auth/signup/route.ts`
- `components/auth/signup-form.tsx`
- `app/api/me/profile/route.ts`
- `app/api/orgs/search/route.ts`
- `app/api/orgs/[orgSlug]/join/route.ts`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/dashboard/events/*`
- `app/(dashboard)/dashboard/orders/page.tsx`
- `app/(dashboard)/dashboard/settings/page.tsx`
- `app/(dashboard)/dashboard/organisations/page.tsx`
- `components/members/*`
- `prisma/seed.mjs`
- `docs/obsidian/*.md`

## Current Routes

Public:

- `/`
- `/events/[eventId]`
- `/login`
- `/signup`
- `/success`
- `/cancel`

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

Legacy compatibility:

- `/dashboard/[orgSlug]`
- `/dashboard/[orgSlug]/events`
- `/dashboard/[orgSlug]/events/new`
- `/dashboard/[orgSlug]/events/[eventId]/edit`
- `/dashboard/[orgSlug]/orders`
- `/dashboard/[orgSlug]/settings`

The legacy routes redirect for the owning organisation account and return not found when ownership does not match.

## Seeded Logins

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

Best smoke-test accounts:

- `engineering.org@example.com`: organisation dashboard with events/orders.
- `payments.lab@example.com`: Stripe `PLATFORM_NOT_READY` settings state.
- `user2@example.com`: member account with seeded ticket/order history.
- `outsider@example.com`: member account with no joined organisations.

## Runtime And Database

Use Docker for normal development. The app container resolves Postgres at `db:5432`; running Next directly on the Windows host with the Docker `.env` will not resolve `db`.

Database:

```text
PostgreSQL 16
Database: thunderstrux
User: thunderstrux
Password: thunderstrux
Container host: db
Host machine: localhost
Port: 5432
Docker volume: thunderstrux_postgres_data
Container path: /var/lib/postgresql/data
```

Useful commands:

```bash
docker compose up -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
docker compose restart app
docker compose exec app pnpm build
```

Latest verification:

- `docker compose exec app pnpm prisma:migrate` applied `20260428000000_account_role_groundwork`.
- `docker compose exec app pnpm seed` completed.
- `docker compose restart app` completed.
- `http://localhost:3000/` returned `200 OK`.
- `docker compose exec app pnpm build` passed.

## Next Route Stability

Keep these route stability fixes:

- `scripts/clean-next-dev.mjs`
- `scripts/prepare-next-build.mjs`
- `next.config.ts` uses `.next-build` for production and `.next` for dev.
- `.next-build/` ignored in `.gitignore` and `.dockerignore`.
- `app/(dashboard)/dashboard/events/layout.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`

`tsconfig.json` should include generated production build types under `.next-build`, not stale `.next/dev` route types. Stale `.next/dev/types/routes.d.ts` can break `docker compose exec app pnpm build`.

`pnpm build` now runs `scripts/prepare-next-build.mjs` first so build verification strips stale `.next` dev type includes before `next build`.

Current generated include entries:

```json
".next-build/types/**/*.ts",
".next-build/dev/types/**/*.ts"
```

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs.
- Keep `Organisation` as the tenant/payment/event/order owner.
- Member `OrganisationMember` rows must not grant organisation management access.
- Payment fulfilment must remain webhook-driven.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
