# Seeding and Data

## Seed File

Primary seed script:

```text
prisma/seed.mjs
```

Package scripts:

```json
"seed": "prisma db seed"
"prisma:seed": "node prisma/seed.mjs"
```

Recommended command in Docker:

```bash
docker compose exec app pnpm seed
```

## Seed Guarantees

The seed is intentionally idempotent.

Current behavior:

- Users are upserted by `email`
- Organisations are upserted by `slug`
- Memberships are upserted by `(userId, organisationId)`
- Events are matched by `(organisationId, title)`
- Ticket types are matched by `(eventId, name)`

Running the seed again updates core values instead of blindly duplicating rows.

## Seeded Users

- `user1@example.com` / `password123`
- `user2@example.com` / `password123`

## Seeded Organisations

- `Engineering Society` / `engineering-society`
- `Arts Society` / `arts-society`

## Seeded Memberships

- `user1@example.com` -> `Engineering Society` -> `org_owner`
- `user2@example.com` -> `Arts Society` -> `member`

## Seeded Events

The seed creates published demo events:

- `Engineering Society Launch Night`
- `Arts Society Showcase`

Each gets at least one ticket type with positive quantity and a valid price.

## Important Interaction With Demo Public Events

`lib/events/public-events.ts` contains fallback logic:

- If the database has zero published events, the public homepage auto-creates demo published events.

This means:

- Public pages can look populated even when you have not run the seed.
- Dashboard memberships and users still require the seed.
- The seed remains the correct way to restore full development state.

## What `down -v` Removes

This command wipes the Postgres volume:

```bash
docker compose down -v
```

After that, users, organisations, memberships, events, ticket types, orders, and tickets are gone.

## Safe Restore Flow

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

## Quick Verification

After seeding:

1. Sign in as `user1@example.com`
2. Visit `/dashboard`
3. Open `/dashboard/engineering-society`
4. Visit homepage `/`

Expected:

- Dashboard resolves the engineering organisation
- Public homepage shows published events
- Event detail pages load

Seed data does not create orders or tickets. Those are created only through checkout and webhook reconciliation.
