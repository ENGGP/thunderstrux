# Troubleshooting

## Dashboard Dynamic Route 404

Expected route:

```text
/dashboard/[orgSlug]/events
```

Actual file:

```text
app/(dashboard)/dashboard/[orgSlug]/events/page.tsx
```

This is correct for the Next.js App Router.

The route group `(dashboard)` is ignored in the URL. It is only used for organising files.

## Do Not Use Literal Placeholders

This URL is a documentation placeholder:

```text
http://localhost:3000/dashboard/[orgSlug]/events
```

Use a real organisation slug instead:

```text
http://localhost:3000/dashboard/my-society/events
```

If the route loads but says `Organisation not found`, the route exists but the slug is not in the database.

## Confirm Route Files

Dashboard events route should look like this:

```text
app/
  (dashboard)/
    dashboard/
      [orgSlug]/
        layout.tsx
        page.tsx
        events/
          page.tsx
          new/
            page.tsx
        settings/
          page.tsx
```

`events/page.tsx` should have a default export:

```tsx
import { EventsList } from "@/components/events/events-list";

export default async function EventsPage({
  params
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return <EventsList orgSlug={orgSlug} />;
}
```

## Stale Next Or Docker Cache

If the code is correct but the browser still shows old behavior, restart the app container:

```bash
docker compose restart app
```

Then hard refresh:

```text
Ctrl + F5
```

If the stale compiled output still appears, stop the app, delete `.next`, and restart:

```bash
docker compose stop app
docker compose up app
```

## Dashboard Shows Old No Organisations Text

Expected empty dashboard onboarding:

```text
You don't have an organisation yet
Create Organisation
```

Active file for `/dashboard`:

```text
app/(dashboard)/dashboard/page.tsx
```

If the browser shows old text such as:

```text
No organisations have been created yet.
```

but that text does not exist in the current source, the running Docker or Next.js output is stale.

To prove the active render source, temporarily add this at the top of the dashboard page component:

```ts
console.log("DASHBOARD PAGE RENDERED - NEW VERSION");
```

Also temporarily render visible debug text:

```tsx
<div style={{ color: "red" }}>DEBUG: NEW DASHBOARD CODE ACTIVE</div>
```

Then hard reset the local Docker environment.

PowerShell:

```powershell
docker compose down
docker volume prune -f
if (Test-Path -LiteralPath .next) { Remove-Item -LiteralPath .next -Recurse -Force }
docker compose up --build --force-recreate -d
docker compose run --rm app pnpm exec prisma migrate deploy
```

Bash:

```bash
docker compose down
docker volume prune -f
rm -rf .next
docker compose up --build --force-recreate -d
docker compose run --rm app pnpm exec prisma migrate deploy
```

Important:

- `docker volume prune -f` can wipe the local database volume.
- Run Prisma migrations again after pruning volumes.
- Remove debug logs and debug text after confirming the new page is active.

## `event.ticketTypes.length` Runtime Error

Error:

```text
Cannot read properties of undefined (reading 'length')
```

Cause:

- The dashboard events component expected `event.ticketTypes`.
- Older `GET /api/events` responses did not include `ticketTypes`.
- Or the browser/dev server was using stale compiled code.

Fix in API:

- `GET /api/events` returns `ticketTypes` for each event.

Fix in frontend:

```ts
event.ticketTypes?.[0]
(event.ticketTypes?.length ?? 0)
```

This means:

- Missing `ticketTypes` is treated like an empty list.
- Events with no ticket types render safely.
- The Buy Ticket button is disabled when there are no ticket types.

## Homepage Still Shows Old Placeholder

Expected homepage:

```text
Discover Events
```

If the old starter content appears:

```text
Thunderstrux
Student society SaaS foundation
```

The running app is stale. Restart Docker:

```bash
docker compose restart app
```

Then hard refresh the browser.

## Navbar Not Visible

The global navbar should be mounted from:

```text
app/layout.tsx
```

Current layout tree:

```text
app/layout.tsx
app/(dashboard)/dashboard/[orgSlug]/layout.tsx
```

There is no `app/(public)/layout.tsx` and no `app/(dashboard)/layout.tsx`.

If the navbar is missing:

1. Confirm `app/layout.tsx` logs:

```ts
console.log("LAYOUT HIT:", __filename);
```

2. Confirm the served HTML contains `components/layout/navbar.tsx` or the visible navbar markup.
3. Restart Docker if Turbopack is stale:

```bash
docker compose restart app
```

4. If generated types or layout output are corrupted, delete `.next` and restart:

```bash
docker compose stop app
```

Then delete `.next` from the project folder and run:

```bash
docker compose up app
```

Implementation note:

- `app/layout.tsx` calls `auth()`.
- The session is passed into `AuthSessionProvider`.
- `Navbar` uses `useSession()`.

Passing the initial server session prevents the navbar from staying blank while the client session is loading.

## Sign Out Redirects To 0.0.0.0

Symptom:

```text
http://0.0.0.0:3000/
```

Cause:

- The Next.js dev server binds to `0.0.0.0` inside Docker.
- Browser-facing Auth.js URLs were not explicitly set to `localhost`.

Fix local environment values:

```text
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Keep Docker bind hosts as `0.0.0.0` if needed, but never use `0.0.0.0` as a browser callback URL.

The navbar sign-out action should use:

```ts
signOut({ callbackUrl: "http://localhost:3000/" })
```
