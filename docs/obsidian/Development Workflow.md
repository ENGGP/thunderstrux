# Development Workflow

## Standard Local Setup

Thunderstrux now has two Docker Compose modes.

Production-like local runtime:

```bash
docker compose up --build
```

or:

```bash
pnpm docker:prod
```

Development runtime with bind mounts, polling, and Turbopack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

or:

```bash
pnpm docker:dev
```

App:

```text
http://localhost:3000
```

PostgreSQL host port:

```text
localhost:5433 in dev override only
```

## Docker Configuration

`docker-compose.yml` is production-like:

- app runs `pnpm start`
- app uses the built `.next-build` output from the Docker image
- app receives only app runtime environment variables
- app requires `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` at Compose interpolation time
- app receives optional `RATE_LIMIT_*` values
- app uses `restart: unless-stopped`
- app waits for the database healthcheck
- app entrypoint runs `pnpm prisma:migrate:deploy`
- database uses the named volume `postgres_data`
- database port is not exposed to the host
- Redis 7 is available as `redis` for rate limiting when `RATE_LIMIT_ENABLED=true`

`docker-compose.dev.yml` only adds development-specific overrides:

```yaml
volumes:
  - .:/app
  - node_modules:/app/node_modules
command: pnpm dev
environment:
  NODE_ENV: development
  THUNDERSTRUX_RUNTIME_CONTAINER: "false"
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
ports:
  - "5433:5432"
```

Why:

- base Compose can validate the production runtime path without host source mounts
- dev override keeps source live-mounted into the container
- dev override explicitly clears the production runtime marker so build/runtime guard behavior is unambiguous
- `node_modules:/app/node_modules` avoids host/container dependency conflicts and uses the named Docker volume `thunderstrux_node_modules` instead of an anonymous hash volume
- DB host port exposure is available for dev tools only

Database data lives in the named volume:

```yaml
postgres_data:/var/lib/postgresql/data
```

Container dependencies live in the named dev volume:

```yaml
node_modules:/app/node_modules
```

## Dev Server Configuration

Current `package.json` dev script, used by the dev override:

```json
"dev": "node scripts/assert-docker-runtime.mjs --block-next-dev && node scripts/clean-next-dev.mjs && next dev --turbopack --hostname 0.0.0.0"
```

Fallback dev script:

```json
"dev:webpack": "node scripts/assert-docker-runtime.mjs --block-next-dev && node scripts/clean-next-dev.mjs && next dev --webpack --hostname 0.0.0.0"
```

The dev override also sets:

```yaml
environment:
  WATCHPACK_POLLING: "true"
  CHOKIDAR_USEPOLLING: "true"
```

This is intentional.

Reason:

- Next 16 production builds use Turbopack.
- `scripts/assert-docker-runtime.mjs` warns by default, but blocks `pnpm dev` outside Docker when `DATABASE_URL` uses the Docker-only `db:5432` hostname.
- `scripts/clean-next-dev.mjs` clears `.next/dev` and `.next/types` before startup so stale dev route manifests and volatile generated type files do not survive container restarts.
- If volatile `.next` files are locked on Windows/Docker/OneDrive, `scripts/clean-next-dev.mjs` warns and continues startup instead of blocking the app container. It still never removes `.next-build`.
- Turbopack dev mode plus polling is the default route-stable configuration.
- `pnpm dev:webpack` is kept as a safe fallback when Turbopack hot reload or route manifest generation appears stuck.
- `pnpm dev:doctor` prints a read-only report for stale `.next/dev` metadata, missing dev manifests, volatile `.next` type includes, and localhost reachability.

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

Start production-like Docker runtime:

```bash
pnpm docker:prod
```

Start Docker dev runtime:

```bash
pnpm docker:dev
```

Reset Docker volumes intentionally:

```bash
pnpm docker:reset
```

Follow app logs:

```bash
pnpm docker:logs
```

Run migrations:

```bash
docker compose exec app pnpm prisma:migrate
```

Deploy migrations through the production entrypoint/script:

```bash
docker compose exec app pnpm prisma:migrate:deploy
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
docker compose build app
```

Rebuild and recreate the app container:

```bash
pnpm docker:rebuild
```

Do not run `pnpm build` inside a live production-like `next start` container and continue using that same process as the running app. `next build` mutates `.next-build` while `next start` serves the previous build manifest, which can leave HTML and static asset serving out of sync. Runtime containers set `THUNDERSTRUX_RUNTIME_CONTAINER=true`, so `scripts/prepare-next-build.mjs` blocks this unsafe path before build metadata is changed.

If build was somehow run inside a running app container, recreate the app container afterwards:

```bash
docker compose up -d --force-recreate app
```

For final production-path validation, prefer rebuilding/recreating the base Compose app container rather than relying on a build run inside an already-started process.

Smoke tests:

```bash
docker compose exec app pnpm test:smoke
```

The smoke script checks auth roles, dashboard access, event create/edit, ticket editing, member API denial, checkout preconditions, member organisation leave, public organisation details, reservation availability behavior, stale pending order expiry, cleanup idempotency, and paid/failed cleanup safety.

Integration tests:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration
```

The integration runner uses a disposable test database, not the normal development database.

Current test database behavior:

- default database URL: `postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux_test?schema=public`
- override with `INTEGRATION_DATABASE_URL` or `TEST_DATABASE_URL`
- refuses to run unless the database name contains `_test`
- ignores accidental host `DATABASE_URL` leakage by setting `DATABASE_URL` from the resolved test URL for all child commands
- resets the test database through `pnpm prisma migrate reset --force --skip-seed`
- runs `pnpm prisma:generate` after reset so Prisma Client matches the current schema
- truncates app tables before each test
- runs Vitest sequentially with `--no-file-parallelism --maxWorkers=1 --maxConcurrency=1`

Important:

- Run integration tests from the Docker dev stack because `docker-compose.dev.yml` bind-mounts the local `tests/` directory into the app container.
- Do not run integration tests against the normal `thunderstrux` development database.
- Vitest 4 does not support the literal Jest flag `--runInBand`; the current sequential flags are the equivalent.
- The integration suite blocks real network calls through the global test `fetch` stub and mocks Stripe at the SDK boundary where needed.

The build script runs:

```text
node scripts/prepare-next-build.mjs && pnpm prisma:generate && next build
```

This strips `.next/types/**/*.ts` / `.next/dev/types/**/*.ts` from `tsconfig.json`, regenerates Prisma Client from the current schema, then runs production type checking and build.

Restart only the app container:

```bash
docker compose restart app
```

Show app logs:

```bash
docker compose logs -f app
```

Check dev environment health without changing files:

```bash
docker compose exec app pnpm dev:doctor
```

Host-facing package helpers:

```bash
pnpm docker:dev
pnpm docker:dev:clean
pnpm docker:prod
pnpm docker:reset
pnpm docker:logs
pnpm docker:up
pnpm docker:restart
pnpm docker:migrate
pnpm docker:seed
pnpm docker:db:sync
pnpm docker:build
pnpm docker:rebuild
```

`pnpm docker:up` is a detached dev-stack alias using `docker-compose.dev.yml`.

`pnpm docker:dev` is the normal fast foreground dev start.

`pnpm docker:dev:clean` is the explicit recovery path when the app container does not see current source, migrations, or generated state. It uses the dev Compose files with `--build --force-recreate` and does not wipe the Postgres volume.

`pnpm docker:build` runs `docker compose build app`. It does not execute `pnpm build` inside the running app container.

`pnpm docker:rebuild` runs `docker compose up -d --build --force-recreate app`.

Apply the current schema and seed data after pulling schema changes:

```bash
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

## Normal Change Workflow

Use the dev override for source-editing work.

1. Edit source files on the host.
2. Let Docker hot reload the app through `docker-compose.dev.yml`.
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

Prefer clearing volatile `.next/dev` and `.next/types` first through the normal dev startup path. `scripts/clean-next-dev.mjs` has a narrow path guard and only removes those volatile `.next` paths; it never removes `.next-build`.

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

With the current `.next-build` production dist directory, normal TypeScript validation should include the stable generated route types:

```json
".next-build/types/**/*.ts"
```

Do not keep `.next-build/dev/types/**/*.ts` unless that directory actually exists and is intentionally used by the current Next build output.

Do not include `.next/types/**/*.ts` or `.next/dev/types/**/*.ts` in normal TypeScript validation. Stale dev route types or `validator.ts` files can break `pnpm exec tsc --noEmit` with errors from ignored generated cache files. Current generated type includes should stay under `.next-build`.

`scripts/prepare-next-build.mjs` enforces this immediately before `pnpm build`, because Next dev may re-add `.next/types` entries while the dev server is running.

## Proxy Route Guard

Next 16 deprecates the `middleware.ts` file convention in favour of `proxy.ts`.

Thunderstrux uses:

```text
proxy.ts
```

It protects:

```text
/dashboard/:path*
/events/:path*
```

Expected behavior:

- Logged-out dashboard requests redirect to `/login`.
- The `callbackUrl` query preserves the requested dashboard path.
- Logged-in requests continue normally.
- Organisation accounts requesting `/events/[eventId]` redirect to `/dashboard/events/[eventId]`.
- Member accounts requesting `/dashboard/events/[eventId]` redirect to `/`.
- Production proxy startup rejects missing or placeholder `AUTH_SECRET` values instead of silently using `dev-secret`.

## Docker Access From Codex

Docker Desktop may be healthy even if sandboxed commands report named-pipe or log-file access errors.

Symptoms:

```text
permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
unable to create a log file for docker-desktop.exe ... Access is denied
```

In this Codex environment, run Docker commands with escalated permissions when needed. Verified working checks:

```bash
docker desktop status
docker info
docker compose ps
docker compose build app
```

If the app is started outside Docker, `DATABASE_URL=db:5432` will not resolve. Use the Docker app container for normal development.

Host database connection string, available when using `docker-compose.dev.yml`:

```text
postgresql://thunderstrux:thunderstrux@localhost:5433/thunderstrux?schema=public
```

Container database connection string:

```text
postgresql://thunderstrux:thunderstrux@db:5432/thunderstrux?schema=public
```

## When To Use `down -v`

Only do this when you intentionally want to wipe the local Postgres volume:

```bash
docker compose down -v
```

After `down -v`, restore:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build --force-recreate -d
docker compose exec app pnpm seed
```

## Environment Variables

Application `.env` values:

```text
DATABASE_URL=
AUTH_SECRET=
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
```

Required for app container startup:

```text
DATABASE_URL
AUTH_SECRET
AUTH_URL
NEXTAUTH_URL
NEXT_PUBLIC_APP_URL
```

If one is missing or empty, `docker compose up` fails before starting the app. Example diagnostic:

```text
DATABASE_URL is required
```

Optional Stripe values may be empty for non-payment local work:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET
```

Optional email delivery values may be empty for local work that does not need actual ticket emails:

```text
RESEND_API_KEY
EMAIL_FROM
```

When email values are missing, paid webhook fulfilment still succeeds, automatic email delivery records an error, and manual resend returns an email configuration error.

Rate-limit values:

```text
RATE_LIMIT_ENABLED=false
RATE_LIMIT_REDIS_URL=redis://redis:6379
RATE_LIMIT_FAIL_OPEN=false
RATE_LIMIT_KEY_PREFIX=thunderstrux
```

Keep `RATE_LIMIT_ENABLED=false` for normal local development unless testing throttling behavior. Production should enable it and point `RATE_LIMIT_REDIS_URL` at a managed or otherwise reliable Redis-compatible service.

Database `.env.db` values:

```text
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
```

Tracked examples:

```text
.env.example
.env.db.example
```

Browser-facing URLs should use `localhost`, even though the app binds to `0.0.0.0` inside Docker.

After editing `.env` or `.env.db`, recreate containers rather than only refreshing the browser:

```bash
docker compose down
docker compose up --build -d
```

For webhook-secret-only changes, recreating the app container is enough:

```bash
docker compose up -d --force-recreate app
```

Verify environment values are present without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```

To compare a Stripe CLI webhook secret without printing the full secret:

```bash
docker compose exec app node -e "const s=process.env.STRIPE_WEBHOOK_SECRET; console.log(s ? s.slice(0,12)+'... len='+s.length : 'missing')"
```
