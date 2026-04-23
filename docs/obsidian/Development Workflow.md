# Development Workflow

## Running The App

Start the full Docker environment:

```bash
docker compose up
```

App:

```text
http://localhost:3000
```

PostgreSQL:

```text
localhost:5432
```

## Common Commands

Run Prisma migrations inside Docker:

```bash
docker compose run --rm app pnpm prisma:migrate
```

Generate Prisma Client:

```bash
docker compose run --rm app pnpm prisma:generate
```

Apply migrations in an existing Docker database:

```bash
docker compose run --rm app pnpm exec prisma migrate deploy
```

Seed MVP demo users, organisations, memberships, and published events:

```bash
docker compose run --rm app pnpm prisma:seed
```

Seeded credentials:

```text
user1@example.com / password123
user2@example.com / password123
```

Build the app:

```bash
docker compose run --rm app pnpm build
```

Restart the app container:

```bash
docker compose restart app
```

## Docker Notes

The app service mounts the project into `/app` for live reload.

Important volumes:

- `.:/app`
- `/app/node_modules`
- `postgres_data:/var/lib/postgresql/data`

If the browser shows stale content, restart the app container:

```bash
docker compose restart app
```

If a runtime stack trace still points to code that has already been changed, the Next dev server is probably serving stale compiled output. Restart the app service first:

```bash
docker compose restart app
```

Then hard refresh the browser:

```text
Ctrl + F5
```

If the stale issue persists, clear the Next build cache and restart:

```bash
docker compose stop app
```

Then delete `.next` from the project folder and start again:

```bash
docker compose up app
```

Do not delete database volumes unless you intentionally want to wipe local data.

## Environment Variables

Important env values:

```text
DATABASE_URL=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
AUTH_SECRET=
AUTH_URL=
NEXTAUTH_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=
```

For local development, `NEXT_PUBLIC_APP_URL` should usually be:

```text
http://localhost:3000
```

Auth.js browser-facing URLs should also use localhost:

```text
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
```

The app may bind the server to `0.0.0.0` inside Docker, but browser redirects and Auth.js callbacks must not use `0.0.0.0`.

## Creating A Public Purchase Test Flow

1. Create an organisation.
2. Connect Stripe in dashboard settings.
3. Ensure the connected account has charges enabled.
4. Create a published event.
5. Create at least one ticket type.
6. Visit `/`.
7. Click `View Event`.
8. Select ticket quantity.
9. Click `Buy Ticket`.
10. Complete Stripe Checkout.
11. Let the webhook mark the order paid and issue tickets.

## Authentication Model

Dashboard access uses Auth.js credentials login. Private dashboard APIs derive the user from `session.user.id` and enforce organisation access through `OrganisationMember`.

## Things Not Implemented Yet

- Email verification and password reset
- Membership purchase flow
- File storage
- AI agent API endpoints
- Stripe Connect platform fee configuration UI
- Refunds
- Order management UI
- Ticket QR codes or attendee check-in

These should be added incrementally.
