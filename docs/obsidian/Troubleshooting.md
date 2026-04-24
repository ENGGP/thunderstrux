# Troubleshooting

## UI Change Not Visible

Most likely causes:

- Browser cache.
- Docker dev server did not detect the file change.
- Stale `.next` output.
- The container is not seeing the host file.

Diagnosis order:

1. Search the source for the exact visible stale text.
2. Compare host and container copies of the file.
3. Search `.next` for the stale text.
4. Refresh the route and inspect runtime HTML.

Useful commands:

```bash
rg -n --hidden --no-ignore "Exact stale text" .
docker compose exec app cat 'app/(dashboard)/dashboard/[orgSlug]/page.tsx'
```

## Stale Next.js Output In Docker

Observed issue:

- Source was correct.
- Browser still showed old dashboard UI.
- Old JSX remained in `.next` output.

Current mitigation:

- `pnpm dev` runs `next dev --webpack --hostname 0.0.0.0`
- Docker enables `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING`

Fix order:

1. Hard refresh browser.
2. `docker compose restart app`
3. Clear `.next`
4. Recreate containers

## Tailwind Classes Exist But Styling Does Not Apply

Observed issue:

- JSX contained classes such as `bg-red-500`, `rounded-xl`, `shadow-md`, and `text-white`
- Rendered output did not show expected Tailwind styling

Root cause that previously existed:

- Tailwind v4 project was still using legacy v3-style CSS directives

Correct setup:

```css
@config "../tailwind.config.js";
@import "tailwindcss";
```

Files:

```text
app/globals.css
tailwind.config.js
```

Verification:

1. Confirm `app/layout.tsx` imports `./globals.css`.
2. Confirm compiled CSS contains `text-white`, `bg-neutral-900`, and similar utilities.
3. Confirm no late custom CSS overrides utility colors.

Important current lesson:

- A global `a { color: inherit; }` rule can override Tailwind text color utilities on `Link` elements if it lands after utilities.
- The current fix is that the app-level anchor rule only removes underline, not color.

## Button Text Is Invisible On Dark Buttons

Observed issue:

- `View events` and `New event` showed dark text on dark background

Real root cause:

- Global anchor color override was winning over `text-white`

Current safe pattern for primary links/buttons:

```text
bg-neutral-900 text-white hover:bg-neutral-700
```

If a dark link button shows dark text again, inspect `app/globals.css` before changing the button component.

## Dashboard Layout Overlap

Observed issue:

- Fixed global header overlapped dashboard sidebar content
- Slug/title content was hidden under the top bar

Current layout structure:

- Global `Navbar` is fixed at `h-16`
- Root layout offsets content with `pt-16`
- Dashboard sidebar uses `top-16`
- Dashboard main content uses `md:ml-64`

If overlap returns, inspect:

- `app/layout.tsx`
- `components/layout/navbar.tsx`
- `components/layout/dashboard-shell.tsx`

## Duplicate Dashboard Controls

Current intended structure:

- `DashboardShell` owns `Dashboard`, `Events`, `Settings`
- `/dashboard/[orgSlug]` page body renders only overview content and `View events`
- `/dashboard` organisation cards render only `Open dashboard`

If stale or duplicate buttons appear:

1. Search exact string across the repo.
2. Search `.next`.
3. Compare runtime HTML with source.
4. Restart app / clear `.next`.

## Duplicate Event Titles

Recent issue:

- Edit event route showed both `Edit Event` and `Edit event`

Current correct state:

- The route-level page no longer renders the top `Edit Event` heading
- The single remaining title comes from `CreateEventForm` in edit mode

If duplicate titles reappear, inspect:

- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx`
- `components/events/create-event-form.tsx`

## Docker File Sync

Expected volumes:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

Verify container sees latest file:

```bash
docker compose exec app cat 'app/(dashboard)/dashboard/[orgSlug]/page.tsx'
```

If host and container differ, inspect Docker Desktop file sharing and restart Docker.

## Hydration Mismatch On `<body>`

Warning attributes:

```text
data-new-gr-c-s-check-loaded
data-gr-ext-installed
data-gr-ext-disabled
```

Root cause:

- Browser extensions such as Grammarly inject attributes into `<body>` before React hydrates

This is not currently an app code bug.

## Stripe Not Connected

Checkout can fail with:

```text
Stripe not connected
```

Meaning:

- Event exists
- Ticket type exists
- Event is published
- Connected Stripe account is missing or not charges-enabled

Fix:

- Sign in as `org_owner` or `finance_manager`
- Go to `/dashboard/[orgSlug]/settings`
- Complete Stripe Connect onboarding

## Data Missing After Reset

Cause:

```bash
docker compose down -v
```

This removes the Postgres volume.

Restore:

```bash
docker compose up --build --force-recreate -d
docker compose exec app pnpm prisma:migrate
docker compose exec app pnpm seed
```
