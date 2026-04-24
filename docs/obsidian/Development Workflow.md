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

`docker-compose.yml` mounts the project into the app container:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

Why:

- `.:/app` keeps source live-mounted into the container.
- `/app/node_modules` avoids host/container dependency conflicts.

Database data lives in the named volume:

```yaml
postgres_data:/var/lib/postgresql/data
```

## Dev Server Configuration

Current `package.json` dev script:

```json
"dev": "next dev --webpack --hostname 0.0.0.0"
```

The app container also sets:

```yaml
environment:
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
```

This is intentional.

Reason:

- Turbopack was unreliable in this Docker setup and repeatedly served stale UI.
- Webpack plus polling has been the stable configuration.

## Tailwind Setup

Thunderstrux currently uses Tailwind CSS v4.

Files:

```text
tailwind.config.js
app/globals.css
```

Required CSS entrypoint:

```css
@config "../tailwind.config.js";
@import "tailwindcss";
```

Tailwind content paths:

```js
content: [
  "./app/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}"
]
```

Do not revert to the legacy `@tailwind base/components/utilities` entrypoint unless the project is intentionally downgraded to Tailwind v3.

## Common Commands

Run migrations:

```bash
docker compose exec app pnpm prisma:migrate
```

Generate Prisma client:

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

Restart only the app container:

```bash
docker compose restart app
```

Show app logs:

```bash
docker compose logs -f app
```

## Normal Change Workflow

1. Edit source files on the host.
2. Let Docker hot reload the app.
3. Refresh the browser for server-rendered pages.
4. Verify the rendered route actually reflects the source change.

## When To Restart Docker

Restart the app container when:

- Source code is correct but the browser still shows old UI.
- The dev server logs are not recompiling.
- A route appears stale after multiple refreshes.

```bash
docker compose restart app
```

## When To Clear `.next`

Clear `.next` when:

- Restarting the app container does not fix stale output.
- Runtime HTML contains code that no longer exists in source.
- Old strings still appear inside `.next`.

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

Only do this when you intentionally want to wipe the local Postgres volume:

```bash
docker compose down -v
```

After `down -v`, restore:

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

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

Browser-facing URLs should use `localhost`, even though the app binds to `0.0.0.0` inside Docker.
