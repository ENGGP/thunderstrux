# Development Workflow

## Standard Local Setup

Start the stack:

```bash
docker compose up
```

Detached mode:

```bash
docker compose up -d
```

App:

```text
http://localhost:3000
```

PostgreSQL:

```text
localhost:5432
```

## Docker Configuration

`docker-compose.yml` mounts the host project into the app container:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

The anonymous `/app/node_modules` volume prevents host/container dependency conflicts.

PostgreSQL data lives in:

```yaml
postgres_data:/var/lib/postgresql/data
```

The app service also enables polling for reliable file watching inside Docker:

```yaml
environment:
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
```

## Next Dev Server

The development script intentionally disables Turbopack:

```json
"dev": "next dev --webpack --hostname 0.0.0.0"
```

Reason:

- Turbopack has repeatedly served stale compiled dashboard UI in this Docker setup.
- Webpack plus polling has produced reliable file-change detection.

## Tailwind CSS Setup

This project uses Tailwind CSS v4.

Config:

```text
tailwind.config.js
```

Required content paths:

```js
content: [
  "./app/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}"
]
```

Global CSS entrypoint:

```text
app/globals.css
```

Required Tailwind v4 directives:

```css
@config "../tailwind.config.js";
@import "tailwindcss";
```

`app/layout.tsx` must import the global stylesheet:

```ts
import "./globals.css";
```

If Tailwind class names are present in rendered HTML but the page is visually unstyled, verify the compiled CSS contains the exact utilities being used.

## Common Commands

Run migrations:

```bash
docker compose exec app pnpm prisma:migrate
```

Generate Prisma Client:

```bash
docker compose exec app pnpm prisma:generate
```

Seed development data:

```bash
docker compose exec app pnpm seed
```

Build:

```bash
docker compose exec app pnpm build
```

Restart app only:

```bash
docker compose restart app
```

View app logs:

```bash
docker compose logs -f app
```

## Normal Change Workflow

1. Edit source files on the host.
2. Let the Docker app container hot reload.
3. Refresh the browser if the route is server-rendered.
4. Confirm the HTML or UI reflects the source change.

For server-rendered App Router pages, a browser refresh is often enough after the dev server recompiles.

## Verifying UI Changes

Use a visible temporary marker only when debugging stale output:

```tsx
<div style={{ color: "red" }}>DEBUG: PAGE ACTIVE</div>
```

Then verify:

```bash
curl http://localhost:3000/
```

Remove the marker immediately after confirming the active render source.

For Tailwind-specific verification, use a visibly styled marker with temporary text:

```tsx
<div className="bg-red-500 text-white p-10 text-2xl">
  Tailwind visual test
</div>
```

If the block is not red with large white text and heavy padding, Tailwind is not compiling or loading correctly. Check [[Troubleshooting]] before changing page logic.

## When To Restart Docker

Restart the app container when:

- Source is correct but the browser still shows old UI.
- The dev server logs look stuck.
- A route keeps serving stale compiled output.

```bash
docker compose restart app
```

## When To Clear `.next`

Clear `.next` when:

- Restarting the app container does not fix stale output.
- Runtime HTML contains code that no longer exists in source.
- `.next` search finds old strings that should not be present.

PowerShell:

```powershell
docker compose down
if (Test-Path -LiteralPath .next) { Remove-Item -LiteralPath .next -Recurse -Force }
docker compose up --build --force-recreate -d
```

Bash:

```bash
docker compose down
rm -rf .next
docker compose up --build --force-recreate -d
```

## When To Use `down -v`

Only use this when you intentionally want to wipe local database data:

```bash
docker compose down -v
```

After `down -v`, restore the database:

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

See [[Seeding and Data]] for seeded users and organisations.

## Environment Variables

Important local values:

```text
DATABASE_URL=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
AUTH_SECRET=
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
```

The app binds to `0.0.0.0` inside Docker, but browser-facing URLs should use `localhost`.
