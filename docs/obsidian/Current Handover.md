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

The latest work focused on Stripe Connect platform readiness, checkout/webhook reliability, and docs alignment.

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
