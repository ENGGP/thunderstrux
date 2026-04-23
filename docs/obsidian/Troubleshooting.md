# Troubleshooting

## UI Change Not Visible

Most likely causes:

- Browser cache.
- Next dev server did not detect the file change.
- Stale `.next` compiled output.
- Docker container is not seeing the host file.

Diagnosis:

1. Search source for the visible stale text.
2. Search generated output too:

```bash
rg -n --hidden --no-ignore "Exact stale text" .
```

3. Compare host and container source:

```bash
docker compose exec app cat 'app/(dashboard)/dashboard/[orgSlug]/page.tsx'
```

4. Add a temporary visible debug marker to the suspected page.
5. Use `curl http://localhost:3000/...` to inspect server HTML.

Fix order:

1. Hard refresh the browser.
2. Restart app container:

```bash
docker compose restart app
```

3. Clear `.next` and recreate containers:

```powershell
docker compose down
if (Test-Path -LiteralPath .next) { Remove-Item -LiteralPath .next -Recurse -Force }
docker compose up --build --force-recreate -d
```

## Stale Next.js Build Output

Observed issue:

- Source files were correct.
- Browser still showed old dashboard buttons.
- `.next/dev/server/chunks/ssr/*.js` still contained old JSX.

Root cause:

- Stale Next.js compiled output in the Docker dev environment.
- Turbopack was unreliable for this setup.

Current mitigation:

- `package.json` uses `next dev --webpack`.
- `docker-compose.yml` enables `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING`.

## Docker File Sync

Expected app volumes:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

Verify Docker sees current code:

```bash
docker compose exec app cat 'app/(dashboard)/dashboard/[orgSlug]/page.tsx'
```

If the container file differs from the host file, inspect Docker Desktop file sharing and restart Docker.

## Hydration Mismatch On `<body>`

Warning attributes:

```text
data-new-gr-c-s-check-loaded
data-gr-ext-installed
data-gr-ext-disabled
```

Root cause:

- Browser extensions such as Grammarly inject attributes into `<body>` before React hydrates.

Why this is not an app bug:

- These attributes are not present in source.
- `app/layout.tsx` renders a plain `<body>`.
- The mismatch only appears in browsers with the extension active.

Fix:

- No code change is required.
- Disable the extension for `localhost` if the warning is distracting.

## Dashboard Route 404

Correct file:

```text
app/(dashboard)/dashboard/[orgSlug]/events/page.tsx
```

Correct URL:

```text
/dashboard/engineering-society/events
```

Do not use literal placeholders in the browser:

```text
/dashboard/[orgSlug]/events
```

If the route exists but returns not found, the signed-in user is probably not an `OrganisationMember` for that slug.

## Old Dashboard Buttons

Current intended structure:

- `DashboardShell` renders `Dashboard`, `Events`, `Settings`.
- `/dashboard/[orgSlug]/page.tsx` renders page content and `View events`.
- `/dashboard` organisation cards render `Open dashboard`.

Invalid stale buttons:

- Page-level `Open settings` on `/dashboard/[orgSlug]`.
- Card-level `Settings` on `/dashboard`.

If these appear but are absent from source, search `.next`, clear it, and restart Docker.

## Data Missing After Reset

Cause:

```bash
docker compose down -v
```

This deletes the PostgreSQL volume.

Restore:

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```

See [[Seeding and Data]].

## Stripe Not Connected

Checkout can fail with:

```text
Stripe not connected
```

Meaning:

- The event exists and can be purchased.
- The organisation does not have a ready Stripe Connect account.
- `stripeAccountId` is missing or `stripeChargesEnabled` is false.

Fix:

- Sign in as a user with `org_owner` or `finance_manager`.
- Go to `/dashboard/[orgSlug]/settings`.
- Start Stripe Connect onboarding.
- Use valid local Stripe keys and webhooks for full local testing.

Local limitation:

- Without real/test Stripe keys and webhook forwarding, onboarding and checkout cannot complete end-to-end.

