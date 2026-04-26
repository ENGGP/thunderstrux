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
- A nested App Router route existed in source and production manifests but returned 404 in dev because `.next/dev/server/app-paths-manifest.json` was stale.

Current mitigation:

- `pnpm dev` runs `next dev --turbopack --hostname 0.0.0.0`
- Docker enables `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING`
- `next.config.ts` sends production build output to `.next-build` so `pnpm build` does not clobber live dev output under `.next`

Fix order:

1. Hard refresh browser.
2. `docker compose restart app`
3. Clear `.next`
4. Recreate containers

## App Router Route Exists But Returns 404

Observed with:

```text
/dashboard/engineering-society/events/[eventId]/edit
```

Also observed as browser console 404s such as:

```text
GET http://localhost:3000/dashboard/engineering-society/events/cmob9yf710002po0z781ua9qr/edit 404 (Not Found)
```

Source was correct:

```text
components/events/events-list.tsx
app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx
```

The generated production manifests contained the route, but the dev manifest did not:

```text
.next/dev/server/app-paths-manifest.json
```

Diagnosis:

```bash
docker compose exec app sh -lc "grep -n 'events/.*/edit\|events/\[eventId\]/edit\|events/new' .next/dev/server/app-paths-manifest.json .next/dev/types/routes.d.ts 2>/dev/null || true"
```

Permanent fixes now in code:

- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx` exists as an explicit pass-through route boundary for nested event pages.
- `package.json` uses `next dev --turbopack --hostname 0.0.0.0`.
- `next.config.ts` uses `.next-build` for production builds and `.next` for dev output.
- `.gitignore` ignores both `.next/` and `.next-build/`.

If it happens again, first inspect the dev manifest:

```bash
docker compose exec app sh -lc "cat .next/dev/server/app-paths-manifest.json"
```

It must include:

```text
/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page
/(dashboard)/dashboard/[orgSlug]/events/new/page
/(dashboard)/dashboard/[orgSlug]/events/page
```

Recovery:

```powershell
docker compose down
docker compose run --rm app sh -lc "rm -rf .next .next-build"
docker compose up --build --force-recreate -d
```

Then recheck the route. If the route is registered but the page still 404s, inspect the page-level guards:

- `app/(dashboard)/dashboard/[orgSlug]/layout.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx`
- `requireOrganisationMembershipBySlug(orgSlug)`
- event lookup by `eventId` and `organisationId`

For a valid Engineering event and `user1@example.com`, the route should return `200`. For `user2@example.com`, direct Engineering edit URLs should return `404`.

If clicking `Edit` navigates to `/dashboard/[orgSlug]/events/edit` without an event id, the source link or a stale client bundle is wrong. The correct source link is:

```tsx
href={`/dashboard/${orgSlug}/events/${event.id}/edit`}
```

It lives in:

```text
components/events/events-list.tsx
```

Check browser hard refresh and confirm `EDIT EVENT ID:` logs a real id.

## Event Edit Saves But Reopens With Old Data

Observed on:

```text
/dashboard/[orgSlug]/events/[eventId]/edit
```

Symptom:

- User changes event fields or ticket types.
- Clicks `Save event`.
- Reopening shows old data.

Root cause found:

- Sold-out ticket types can legitimately have `quantity = 0`.
- The edit form and `PATCH /api/events/[eventId]` validator used the create-time rule `quantity >= 1`.
- The API returned `400 VALIDATION_ERROR` before auth and Prisma transaction.
- Because the failure surfaced generically, it looked like a persistence failure.

Current fix:

- `createTicketTypeSchema` still requires `quantity >= 1`.
- `updateTicketTypeSchema` allows `quantity >= 0`.
- `components/events/create-event-form.tsx` allows zero quantity only in edit mode.
- Sold/issued ticket rows are disabled in the edit form so event fields can still be saved without accidentally modifying protected ticket history.
- Failed PATCH responses are logged with the raw response body.
- Successful saves call `router.refresh()` before redirecting back to the events list.

Expected behavior:

- Event title, description, location, start time, and end time can be edited even after sales.
- Ticket type name, price, quantity, and removal are locked once that ticket type has orders or issued tickets.
- Unsold ticket types on the same event remain editable/removable.

Trace logs now available:

```text
FORM SUBMIT DATA:
PATCH PAYLOAD:
PATCH EVENT HIT:
REQUEST BODY:
AUTH PASSED
EXISTING TICKETS:
INCOMING TICKETS:
UPDATING EVENT:
UPDATED EVENT RESULT:
```

Database verification examples:

```bash
docker compose exec db psql -U thunderstrux -d thunderstrux -c "SELECT id, title, description, location FROM \"Event\" WHERE id = 'event_id';"
docker compose exec db psql -U thunderstrux -d thunderstrux -c "SELECT id, name, price, quantity FROM \"TicketType\" WHERE \"eventId\" = 'event_id' ORDER BY name;"
```

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

## `next-env.d.ts` Changes After Build Or Dev

Next can rewrite `next-env.d.ts` depending on whether the last run was dev or build:

```ts
import "./.next/dev/types/routes.d.ts";
```

or:

```ts
import "./.next/types/routes.d.ts";
```

This is generated route-type metadata. It is not application behavior. If it appears in a diff after running `pnpm build` or `next dev`, decide whether to keep the generated state or exclude it from unrelated commits.

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

- Sign in as a role other than `member`
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
