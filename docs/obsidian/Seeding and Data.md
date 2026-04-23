# Seeding and Data

## Purpose

`prisma/seed.mjs` restores useful local development data after database resets.

It creates:

- Users
- Organisations
- Organisation memberships
- Published demo events
- Ticket types

## Seeded Credentials

```text
user1@example.com / password123
user2@example.com / password123
```

## Seeded Organisations

```text
Engineering Society
slug: engineering-society

Arts Society
slug: arts-society
```

## Seeded Memberships

```text
user1@example.com -> Engineering Society -> org_owner
user2@example.com -> Arts Society -> member
```

## Seeded Events And Tickets

Each organisation has one published event:

```text
Engineering Society Launch Night
Ticket: General Admission
Price: 1000 cents
Quantity: 50

Arts Society Showcase
Ticket: Standard Ticket
Price: 1500 cents
Quantity: 40
```

## Idempotent Strategy

The seed is safe to run repeatedly.

Matching rules:

- Users match by `email`.
- Organisations match by `slug`.
- Memberships match by `userId + organisationId`.
- Events match by `organisationId + title`.
- Ticket types match by `eventId + name`.

Existing rows are updated instead of duplicated.

## Running Seed

Preferred command inside Docker:

```bash
docker compose exec app pnpm seed
```

Equivalent command:

```bash
docker compose exec app pnpm prisma db seed
```

The project also keeps:

```bash
docker compose exec app pnpm prisma:seed
```

`pnpm prisma:seed` runs `node prisma/seed.mjs` directly. `pnpm seed` uses Prisma's configured seed command.

## Why Data Disappears

The PostgreSQL data is stored in the Docker volume:

```text
postgres_data:/var/lib/postgresql/data
```

This command deletes the local database volume:

```bash
docker compose down -v
```

After `down -v`, run migrations and seed again:

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

## Verification

Expected minimum local data after seeding:

```text
users: 2
organisations: 2
memberships: 2
events: 2
ticketTypes: 2
```

Public homepage verification:

- `/` should show `Engineering Society Launch Night`.
- `/` should show `Arts Society Showcase`.

Dashboard verification:

- Sign in as `user1@example.com`.
- Visit `/dashboard`.
- Open `Engineering Society`.
- The dashboard should resolve `/dashboard/engineering-society`.

