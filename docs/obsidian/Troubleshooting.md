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

## Stripe Connect Account Exists But Payments Still Blocked

Do not treat `stripeAccountId` as payment-ready.

Current lifecycle states:

- `NOT_CONNECTED`: no account is stored locally.
- `PLATFORM_NOT_READY`: Stripe platform profile/setup is incomplete and account creation is blocked.
- `CONNECTED_INCOMPLETE`: account exists but onboarding details are not submitted.
- `RESTRICTED`: details are submitted but Stripe has not enabled charges.
- `READY`: charges are enabled.
- `ERROR`: Stripe status refresh failed.

Checkout requires `stripeAccountId` and `stripeChargesEnabled = true`, so `NOT_CONNECTED`, `PLATFORM_NOT_READY`, `CONNECTED_INCOMPLETE`, `RESTRICTED`, and `ERROR` all block payment.

Fix:

1. Open `/dashboard/[orgSlug]/settings`.
2. Click `Continue onboarding` or `Fix account`.
3. Complete required Stripe steps.
4. Click `Refresh status`.
5. Confirm lifecycle state becomes `READY`.

## Stripe API Key Changed

Symptoms:

- `.env` has a new `STRIPE_SECRET_KEY`.
- Old organisations still have `stripeAccountId` from the previous Stripe account.
- Status check may enter `ERROR`.

Reason:

- Stripe connected account IDs belong to the Stripe platform account that created them.
- A new platform key may not be able to retrieve old connected accounts.

Fix:

1. Recreate Docker containers so env is reloaded:

```bash
docker compose down
docker compose up --build -d
```

2. Open settings for the organisation.
3. Click `Disconnect Stripe account`.
4. Click `Connect Stripe Account` again.
5. Complete onboarding with the new Stripe platform key.

Verify env inside Docker without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```

## Stripe Platform Setup Required

The settings page can show:

```text
Stripe platform setup required
```

API response:

```json
{
  "state": "PLATFORM_NOT_READY",
  "message": "Stripe platform setup incomplete",
  "actionRequired": "Complete Stripe Connect platform profile",
  "actionUrl": "https://dashboard.stripe.com/settings/connect/platform-profile"
}
```

Meaning:

- The platform account behind `STRIPE_SECRET_KEY` cannot create Express accounts yet.
- No connected account was created.
- `stripeAccountStatus` is stored as `PLATFORM_NOT_READY`.

Fix:

1. Open `https://dashboard.stripe.com/settings/connect/platform-profile`.
2. Complete Stripe Connect platform profile/responsibilities.
3. Return to `/dashboard/[orgSlug]/settings`.
4. Click `Retry after completion`.

You may also click `Disconnect Stripe account` in this state to clear the local status back to `NOT_CONNECTED`.

## Stripe Connect Is Not Enabled On The Stripe Account

Exact Stripe error observed:

```text
You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.
```

Failing call:

```ts
stripe.accounts.create({ type: "express" })
```

Fix:

- Sign up for Stripe Connect on the Stripe account that owns `STRIPE_SECRET_KEY`.
- Then retry `Connect Stripe Account`.

## Reconnect To A Locally Disconnected Stripe Account

Disconnect is local-only. It does not delete the Stripe account in Stripe, but it clears the local `stripeAccountId`.

There is no UI flow to reconnect to that exact old account. To restore it manually, find the old `acct_...` id in Stripe Dashboard or logs and run:

```sql
UPDATE "Organisation"
SET
  "stripeAccountId" = 'acct_old_account_id',
  "stripeAccountStatus" = 'CONNECTED_INCOMPLETE',
  "stripeChargesEnabled" = false,
  "stripePayoutsEnabled" = false,
  "stripeDetailsSubmitted" = false
WHERE slug = 'engineering-society';
```

Then open settings and click `Refresh status`.

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
