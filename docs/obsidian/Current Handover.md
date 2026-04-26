# Current Handover

This is the quickest context for the next coding session. Read this first, then [[Thunderstrux Codebase Map]].

## Current State

Thunderstrux is a Docker-based Next.js App Router SaaS for student societies with:

- Auth.js credentials auth.
- Organisation-scoped dashboards.
- Event creation, editing, publishing, unpublishing, and deletion rules.
- Public event discovery and ticket purchase.
- Stripe Checkout with webhook-only fulfilment.
- Stripe Connect Express onboarding with explicit lifecycle states.

The latest work focused on Stripe Connect platform readiness, checkout/webhook reliability, dashboard event route stability, edit-event persistence, expanded seed data, permissions, and docs alignment.

## Recently Changed Areas

Stripe Connect and payments:

- `lib/stripe/connect.ts`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/continue/route.ts`
- `app/api/stripe/connect/disconnect/route.ts`
- `app/api/stripe/connect/webhook/route.ts`
- `app/api/payments/checkout/event/route.ts`
- `app/api/payments/webhook/route.ts`
- `components/settings/stripe-connect-settings.tsx`
- `lib/client/api.ts`

Dashboard events and permissions:

- `components/events/events-list.tsx`
- `components/events/create-event-form.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx`
- `app/api/events/[eventId]/route.ts`
- `lib/permissions/index.ts`
- `lib/validators/events.ts`
- `prisma/seed.mjs`

Next runtime/build stability:

- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `.gitignore`

Docs:

- `docs/obsidian/*.md`

## Stripe Connect State Model

The backend and UI use:

```ts
NOT_CONNECTED
PLATFORM_NOT_READY
CONNECTED_INCOMPLETE
RESTRICTED
READY
ERROR
```

Mapping:

- `NOT_CONNECTED`: no local `stripeAccountId` and no remembered platform setup block.
- `PLATFORM_NOT_READY`: Stripe platform profile/setup blocks `stripe.accounts.create({ type: "express" })` before an account exists.
- `CONNECTED_INCOMPLETE`: a Stripe Express account exists, but `details_submitted = false`.
- `RESTRICTED`: details are submitted, but `charges_enabled = false`.
- `READY`: `charges_enabled = true`.
- `ERROR`: an existing connected account could not be retrieved or synced.

Checkout still uses `isOrganisationStripeReady`, which requires:

- `stripeAccountId`
- `stripeChargesEnabled`

`stripeAccountId` alone does not mean payments are allowed.

## Platform Not Ready

Stripe can reject Express account creation with messages such as:

```text
Please review the responsibilities of managing losses...
```

or:

```text
You can only create new accounts if you've signed up for Connect...
```

Thunderstrux maps these to `PLATFORM_NOT_READY`, not generic `ERROR`.

`POST /api/stripe/connect/onboard` returns:

```json
{
  "state": "PLATFORM_NOT_READY",
  "message": "Stripe platform setup incomplete",
  "actionRequired": "Complete Stripe Connect platform profile",
  "actionUrl": "https://dashboard.stripe.com/settings/connect/platform-profile"
}
```

The settings UI shows `Open Stripe Platform Settings`, `Retry after completion`, and `Disconnect Stripe account`.

## Disconnect And Reconnect Reality

Disconnect is local-only.

It clears these fields on `Organisation`:

- `stripeAccountId = null`
- `stripeAccountStatus = "NOT_CONNECTED"`
- `stripeChargesEnabled = false`
- `stripePayoutsEnabled = false`
- `stripeDetailsSubmitted = false`

It does not delete or detach the account in Stripe.

After disconnecting, clicking `Connect Stripe Account` creates a new Express account unless the old `acct_...` id is manually restored in the DB. There is no UI for reconnecting a previously forgotten account.

Manual restore pattern:

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

## Stripe Connect UX

Settings page:

```text
/dashboard/[orgSlug]/settings
```

Controls by state:

- `NOT_CONNECTED`: `Connect Stripe Account`
- `PLATFORM_NOT_READY`: `Open Stripe Platform Settings`, `Retry after completion`, `Disconnect Stripe account`
- `CONNECTED_INCOMPLETE`: `Continue onboarding`, `Open in Stripe dashboard`, `Refresh status`, `Disconnect Stripe account`
- `RESTRICTED`: `Fix account`, requirements list if provided, `Open in Stripe dashboard`, `Refresh status`, `Disconnect Stripe account`
- `READY`: readiness rows, `Open in Stripe dashboard`, `Refresh status`, `Disconnect Stripe account`
- `ERROR`: retry/recovery actions and local disconnect

## Webhook And Checkout Reliability

Payment fulfilment is webhook-only:

- `POST /api/payments/checkout/event` creates a local pending order, then creates a Stripe Checkout Session.
- `POST /api/payments/webhook` handles `checkout.session.completed` and `checkout.session.expired`.
- Completed checkout validates amount, currency, metadata, order status, and inventory inside a serializable Prisma transaction.
- Duplicate completed delivery is idempotent: paid orders are not paid twice and tickets are not duplicated.
- Expired checkout marks matching pending orders failed and does not restore inventory because inventory is not reserved before payment.

Known product tradeoff:

- Inventory is not reserved at checkout creation. If multiple buyers race for the last ticket, Stripe may collect payment for a later order that fails reconciliation due to inventory. Refund management UI is not implemented yet.

## Verification Already Run

Latest build passed:

```bash
docker compose exec app pnpm build
```

Authenticated route/API validation was run against local Docker:

- Disconnect returns `NOT_CONNECTED`.
- Stripe platform setup block returns `409 PLATFORM_NOT_READY`.
- Status endpoint returns `PLATFORM_NOT_READY` after that block.
- Simulated invalid stored Stripe account returns `ERROR` and clears stale readiness flags.
- Checkout is blocked when the organisation is not Stripe-ready.
- Signed local webhook payloads validated completed, duplicate completed, late expired, and normal expired handling.
- Expanded seed data was applied with `docker compose run --rm app pnpm seed`.
- Seed verification counted 9 users, 5 organisations, 11 memberships, 8 events, 9 ticket types, 3 orders, and 2 tickets.
- `payments-lab` is seeded with `stripeAccountStatus = PLATFORM_NOT_READY` and no `stripeAccountId`.
- Dashboard event edit route 404 was debugged. Source href was correct, but `.next/dev/server/app-paths-manifest.json` was missing nested event routes until the dev/build output separation and explicit `events/layout.tsx` boundary were added.
- Clearing `.next` and restarting the app made `/dashboard/engineering-society/events/[eventId]/edit` resolve correctly.
- Authenticated event workflow audit passed: dashboard pages, edit page, event create, event GET, event PATCH, publish, unpublish, delete, public events, public detail, and tickets page.
- Access boundary verified: `user2@example.com` receives 404 for a direct Engineering event edit route.
- Stripe Connect permission change verified: `admin@example.com` can start Connect onboarding for Arts Society; `user2@example.com` as `member` still receives `403`.
- Dashboard event edit route verified after a production build: `/dashboard/engineering-society/events/cmob9yf710002po0z781ua9qr/edit` and `/dashboard/engineering-society/events/cmoffx2ig0019ul1abb52zeii/edit` both returned `200`.
- Final dev manifest contains `events/page`, `events/new/page`, and `events/[eventId]/edit/page`.
- Event edit persistence verified:
  - Sold-out event with `quantity = 0` now allows event-field edits.
  - Draft event ticket sync verified update, create, and delete behavior.
  - Direct Postgres queries confirmed changed `Event` and `TicketType` rows.

## Recent Bug Lessons

### Edit Event 404

Symptom:

```text
/dashboard/engineering-society/events/[eventId]/edit
```

returned the standard Next.js not-found page even though:

- `components/events/events-list.tsx` generated the correct href.
- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx` existed.
- production build manifests included the route.

Root causes encountered:

- The source route and href were correct, but the live dev route manifest omitted nested event routes.
- `next dev --webpack` did not reliably register nested App Router routes in this setup.
- Running `pnpm build` while dev was running could also confuse the shared `.next` output.
- In the final failure, a clean Turbopack dev server still omitted child event routes until an explicit segment layout was added.

Permanent fix now in code:

- `package.json`: dev uses `next dev --turbopack --hostname 0.0.0.0`.
- `next.config.ts`: production builds use `.next-build`; dev keeps `.next`.
- `.gitignore`: ignores `.next-build/`.
- `app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx`: explicit pass-through route boundary.

Recovery command if a local manifest is corrupt:

```bash
docker compose down
docker compose run --rm app sh -lc "rm -rf .next .next-build"
docker compose up --build --force-recreate -d
```

The dev manifest must include:

```text
/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page
/(dashboard)/dashboard/[orgSlug]/events/new/page
/(dashboard)/dashboard/[orgSlug]/events/page
```

After the fix, `pnpm build` passed and the running edit route still returned `200`.

### Edit Event Saves Did Not Persist

Symptom:

- User edited event fields or ticket types on `/dashboard/[orgSlug]/events/[eventId]/edit`.
- Clicking `Save event` appeared to do nothing.
- Reopening the edit page showed old data.

Exact chain break:

- The frontend submitted the correct `PATCH /api/events/[eventId]` URL and included ticket IDs.
- The API route was hit, but validation rejected the body before auth and before Prisma update.
- Root cause was `quantity = 0` on a sold-out ticket type. Sold-out inventory is valid, but the update schema reused the create rule requiring `quantity >= 1`.

Fix:

- `lib/validators/events.ts`: create ticket types still require `quantity >= 1`; update ticket types allow `quantity >= 0`.
- `components/events/create-event-form.tsx`: client validation allows `0` only in edit mode.
- `app/api/events/[eventId]/route.ts`: added trace logs for PATCH body, auth, ticket diff, and awaited Prisma update result.
- Frontend now logs raw failed PATCH response text and calls `router.refresh()` after successful save.

Verified:

- Sold-out event `cmoffx2ig0019ul1abb52zeii` updated event fields while keeping its ticket quantity at `0`.
- Draft event `cmoffx2i90013ul1aae9ck4qk` verified ticket update, new ticket create, and omitted ticket delete.
- Direct Postgres queries confirmed persisted rows.

### `next-env.d.ts` Churn

`next-env.d.ts` can flip between:

```ts
import "./.next/dev/types/routes.d.ts";
```

and:

```ts
import "./.next/types/routes.d.ts";
```

depending on whether `next dev` or `next build` ran most recently. This is generated Next metadata, not application logic. Avoid treating that line as a meaningful product change.

### Stripe Connect Permissions

`canManageStripeConnect` now allows every organisation role except `member`:

```ts
return userRole !== "member";
```

This means `org_owner`, `org_admin`, `event_manager`, `finance_manager`, and `content_manager` can manage Connect. `member` cannot.

## Not Yet Fully Verified

Still requires manual Stripe-side setup:

- Complete the Stripe platform profile for the account behind `STRIPE_SECRET_KEY`.
- Create/complete a real Stripe Express account through hosted onboarding.
- Make a real test-mode Checkout purchase from the public event page.
- Forward real Checkout and Connect webhooks through Stripe CLI or Dashboard endpoint.

## Runtime Notes

Docker loads `.env` through `env_file`.

After changing Stripe keys or webhook secrets, recreate containers:

```bash
docker compose down
docker compose up --build -d
```

Verify required env names without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs.
- Dashboard navigation belongs in `DashboardShell`.
- Payment fulfilment must remain webhook-driven.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
- `PLATFORM_NOT_READY` is a platform setup block, not a connected-account state.
- Disconnect remains local-only unless a future feature explicitly implements Stripe account detachment/deletion.
