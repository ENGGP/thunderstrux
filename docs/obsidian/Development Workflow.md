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
"dev": "node scripts/clean-next-dev.mjs && next dev --turbopack --hostname 0.0.0.0"
```

The app container also sets:

```yaml
environment:
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
```

This is intentional.

Reason:

- Next 16 production builds use Turbopack.
- `scripts/clean-next-dev.mjs` clears `.next/dev` before startup so stale dev route manifests do not survive container restarts.
- Webpack dev mode failed to reliably register nested App Router event routes in this Docker/Windows/OneDrive setup.
- Turbopack dev mode plus polling is the current route-stable configuration.

## Build Output Separation

`next.config.ts` separates dev and production output:

```ts
distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next"
```

Why:

- `next dev` writes live route metadata under `.next/dev`.
- `pnpm build` writes production artifacts under `.next-build`.
- This prevents build verification from overwriting or confusing the running dev server's route manifest.

`.gitignore` must include both:

```gitignore
.next/
.next-build/
```

`.dockerignore` must also include `.next-build` so Docker build context does not include production build artifacts or generated Prisma client files.

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
- `.env` changed and the running app needs new runtime variables.

```bash
docker compose restart app
```

## When To Clear `.next`

Clear `.next` when:

- Restarting the app container does not fix stale output.
- Runtime HTML contains code that no longer exists in source.
- Old strings still appear inside `.next`.
- A valid App Router route exists in source but dev still returns 404.
- `.next/dev/server/app-paths-manifest.json` is missing a route that exists in source.

PowerShell:

```powershell
if (Test-Path -LiteralPath .next) { Remove-Item -LiteralPath .next -Recurse -Force }
docker compose restart app
```

Bash:

```bash
rm -rf .next
docker compose restart app
```

If production build artifacts may also be involved, clear both from inside Docker:

```bash
docker compose down
docker compose run --rm app sh -lc "rm -rf .next .next-build"
docker compose up --build --force-recreate -d
```

If restart still does not pick up the change, then recreate containers:

```bash
docker compose down
docker compose up --build --force-recreate -d
```

## Generated Next Type Metadata

`next-env.d.ts` may switch between dev and build route type imports:

```ts
import "./.next/dev/types/routes.d.ts";
```

and:

```ts
import "./.next/types/routes.d.ts";
```

or, after a production build with the current `.next-build` dist directory:

```ts
import "./.next-build/types/routes.d.ts";
```

This depends on whether `next dev` or `next build` ran most recently. Treat it as generated framework metadata, not a product change.

With the current `.next-build` production dist directory, Next may also add these generated type paths to `tsconfig.json`:

```json
".next-build/types/**/*.ts",
".next-build/dev/types/**/*.ts"
```

Those entries are expected after `pnpm build`.

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

After editing `.env`, recreate containers rather than only refreshing the browser:

```bash
docker compose down
docker compose up --build -d
```

Verify environment values are present without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```
