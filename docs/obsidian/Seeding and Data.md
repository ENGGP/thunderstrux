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

The script is intentionally idempotent and can be rerun after migrations or resets.

## Seed Guarantees

Current behavior:

- Users are upserted by `email`.
- Organisations are upserted by `slug`.
- Memberships are upserted by `(userId, organisationId)`.
- Events are matched by `(organisationId, title)`.
- Ticket types are matched by `(eventId, name)`.
- Seeded orders are upserted by deterministic `stripeSessionId`.
- Seeded paid orders ensure the expected number of `Ticket` rows exists.

Running the seed again updates core values instead of blindly duplicating rows.

## Seeded Users

All seeded users use:

```text
password123
```

Users:

- `user1@example.com`
- `user2@example.com`
- `admin@example.com`
- `event.manager@example.com`
- `finance@example.com`
- `content@example.com`
- `member@example.com`
- `empty@example.com`
- `outsider@example.com`

Organisation account users:

- `engineering.org@example.com`
- `arts.org@example.com`
- `robotics.org@example.com`
- `payments.lab@example.com`
- `empty.org@example.com`

## Seeded Organisations

- `Engineering Society` / `engineering-society`
- `Arts Society` / `arts-society`
- `Robotics Club` / `robotics-club`
- `Payments Lab` / `payments-lab`
- `Empty Society` / `empty-society`

Each seeded organisation is linked to its matching organisation account through `Organisation.accountUserId`.

`Payments Lab` is seeded with:

```text
stripeAccountStatus = PLATFORM_NOT_READY
stripeAccountId = null
stripeChargesEnabled = false
```

This gives a stable local UI state for testing Stripe platform setup handling without creating a real Stripe account.

## Seeded Memberships

Organisation account compatibility memberships:

- `engineering.org@example.com` -> `Engineering Society` -> `org_owner`
- `arts.org@example.com` -> `Arts Society` -> `org_owner`
- `robotics.org@example.com` -> `Robotics Club` -> `org_owner`
- `payments.lab@example.com` -> `Payments Lab` -> `org_owner`
- `empty.org@example.com` -> `Empty Society` -> `org_owner`

Engineering Society:

- `user1@example.com` -> `org_owner`
- `admin@example.com` -> `org_admin`
- `event.manager@example.com` -> `event_manager`
- `finance@example.com` -> `finance_manager`
- `content@example.com` -> `content_manager`
- `member@example.com` -> `member`

Other memberships:

- `user2@example.com` -> `Arts Society` -> `member`
- `admin@example.com` -> `Arts Society` -> `org_admin`
- `event.manager@example.com` -> `Robotics Club` -> `org_owner`
- `finance@example.com` -> `Payments Lab` -> `org_owner`
- `empty@example.com` -> `Empty Society` -> `org_owner`
- `outsider@example.com` has no memberships

## Seeded Events

Published public events:

- `Engineering Society Launch Night`
- `Engineering Sold Out Mixer`
- `Arts Society Showcase`
- `Robotics Build Night`
- `Payments Lab Checkout Test`

Draft dashboard-only events:

- `Engineering Draft Workshop`
- `Engineering No Ticket Draft`
- `Arts Members Draft Critique`

Event edge cases:

- Multiple ticket types: `Engineering Society Launch Night`, `Arts Society Showcase`
- Sold out ticket type: `Engineering Sold Out Mixer`
- Draft with tickets: `Engineering Draft Workshop`
- Draft without tickets: `Engineering No Ticket Draft`
- Organisation with no events: `Empty Society`
- Event under `PLATFORM_NOT_READY` org: `Payments Lab Checkout Test`

## Seeded Orders And Tickets

Seeded order edge cases:

- Paid Engineering order with two issued tickets.
- Failed Engineering order for the sold-out event.
- Pending Arts order with a Stripe session id.

These support:

- Buyer `/tickets` page review.
- Organiser `/dashboard/[orgSlug]/orders` review.
- Event edit/delete restrictions after orders and tickets exist.
- Webhook/idempotency UI and data inspection.

Seeded orders use synthetic `stripeSessionId` values prefixed with `cs_seed_`. They are local test records, not real Stripe sessions.

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

1. Sign in as `user1@example.com`.
2. Visit `/dashboard`.
3. Open `/dashboard/engineering-society`.
4. Visit `/dashboard/engineering-society/orders`.
5. Visit homepage `/`.
6. Visit `/tickets` as `user2@example.com`.
7. Sign in as `finance@example.com` and open `/dashboard/payments-lab/settings`.

Expected:

- Engineering dashboard resolves at `/dashboard` for `engineering.org@example.com`.
- Engineering orders page shows paid and failed seeded order data.
- Public homepage shows published events.
- `user2@example.com` can see a seeded paid order/tickets in `/tickets`.
- `payments.lab@example.com` can open `/dashboard/settings` and see the `PLATFORM_NOT_READY` Stripe Connect state.
