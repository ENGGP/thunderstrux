# Handover 2026-05-03 - Docker Runtime Hardening

Read [[Current Handover]] first, then this file for the Docker/runtime hardening completed in this session.

## Session Focus

This session hardened the Docker and runtime environment after a production-like Next.js runtime desync issue.

Main goals:

- prevent unsafe in-container production builds
- require core runtime env vars before container startup
- align proxy auth-secret safety with Auth.js runtime safety
- update Obsidian docs so future sessions do not repeat unsafe commands

No Stripe/payment flow, reservation logic, dashboard/account model, event logic, or Dockerfile structure was changed.

## Runtime Build Guard

Problem found earlier:

- Running `docker compose exec app pnpm build` inside a running production-like app container mutates `.next-build`.
- The running `next start` process can still hold the old build manifest.
- Result: CSS/static assets can return `404`, and route/static runtime can desynchronise.

Current guard:

- `docker-compose.yml` sets `THUNDERSTRUX_RUNTIME_CONTAINER=true` for the app service.
- `scripts/prepare-next-build.mjs` throws when:

```text
NODE_ENV=production
THUNDERSTRUX_RUNTIME_CONTAINER=true
```

Error:

```text
Do not run pnpm build inside a running container. Rebuild using docker compose.
```

Current safe commands:

```bash
pnpm docker:build
pnpm docker:rebuild
docker compose build app
docker compose up -d --build --force-recreate app
```

Do not reintroduce:

```bash
docker compose exec app pnpm build
```

## Docker Compose Runtime Safety

`docker-compose.yml` now fails fast if required app env vars are missing or empty:

```yaml
DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET is required}
AUTH_URL: ${AUTH_URL:?AUTH_URL is required}
NEXTAUTH_URL: ${NEXTAUTH_URL:?NEXTAUTH_URL is required}
NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL is required}
```

Stripe vars remain optional for non-payment local work:

```yaml
STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-}
STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}
STRIPE_CONNECT_WEBHOOK_SECRET: ${STRIPE_CONNECT_WEBHOOK_SECRET:-}
```

The app service now has:

```yaml
restart: unless-stopped
```

`docker-compose.dev.yml` explicitly sets:

```yaml
THUNDERSTRUX_RUNTIME_CONTAINER: "false"
```

This keeps the runtime build guard unambiguous in the dev override.

## Auth Secret Safety

`auth.ts` already rejected missing or placeholder `AUTH_SECRET` values in production.

`proxy.ts` now matches that behavior:

- production rejects empty string
- production rejects `dev-secret`
- production rejects `replace-with-a-non-empty-secret`
- development still falls back to `dev-secret`

This avoids proxy token decoding silently using a development secret in production-like runtime.

## Developer Script Cleanup

`scripts/doctor-dev.mjs` used to suggest:

```bash
docker compose exec app pnpm build
```

It now suggests:

```bash
pnpm docker:build
```

`package.json` uses:

```json
"docker:build": "docker compose build app",
"docker:rebuild": "docker compose up -d --build --force-recreate app"
```

## Validation Completed

Commands/checks run:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
docker compose build app
```

Results:

- `package.json` parse check passed.
- base Compose config passed.
- base plus dev override Compose config passed.
- `docker compose build app` passed after escalation due local Docker Desktop buildx lock permissions.

Required env startup validation:

- A temporary env file was created outside tracked repo files.
- It intentionally omitted `DATABASE_URL`.
- `docker compose --env-file <temp> up app` failed before app startup.
- Output contained:

```text
DATABASE_URL is required
```

- The temporary env file was deleted in cleanup.

## Obsidian Files Updated

Current docs updated:

- [[Development Workflow]]
- [[Troubleshooting]]
- [[Current Handover]]
- [[Authentication and Dashboard Access]]
- [[Thunderstrux Codebase Map]]
- [[Stripe Payments and Connect]]

Historical handovers updated only to mark the old in-container build command as obsolete/unsafe:

- [[Handover 2026-04-24 SaaS Foundation]]
- [[Handover 2026-04-27 Route Stability and Event Editing]]

## Files Changed In Code/Config

Runtime/config files:

- `docker-compose.yml`
- `docker-compose.dev.yml`
- `proxy.ts`
- `scripts/doctor-dev.mjs`

Previously completed in this session context:

- `scripts/prepare-next-build.mjs`
- `package.json`
- `README.md`

## Things To Preserve

- Keep Dockerfile build/runtime separation unchanged unless there is a separate explicit task.
- Keep migrations running only through `docker/entrypoint.sh` with `pnpm prisma:migrate:deploy`.
- Do not add retry loops unless explicitly requested.
- Do not run `pnpm build` inside a running app container.
- Use `docker compose build app` for safe production-build validation.
- Use `pnpm docker:rebuild` when a fresh runtime container is needed.
- Keep Stripe vars optional so non-payment local work can run without Stripe setup.
- Keep required core env vars fail-fast in Compose.

## Known Notes For Next Session

- Docker commands in Codex may need escalated permissions due Windows Docker Desktop lock or named-pipe access errors.
- Line-ending warnings appeared in Git output for edited files; no functional issue was observed.
- Dated handovers are historical, but unsafe active commands were still updated there to prevent future copy/paste mistakes.
