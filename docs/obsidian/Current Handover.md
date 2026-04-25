# Current Handover

This file is the quickest context for the next coding session.

## Current Focus

The latest work redesigned Stripe Connect onboarding into a production-style lifecycle system.

The payment webhook architecture was not changed during the Connect UI refactor.

## Recently Changed Areas

Stripe Connect:

- `lib/stripe/connect.ts`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/continue/route.ts`
- `app/api/stripe/connect/disconnect/route.ts`
- `components/settings/stripe-connect-settings.tsx`

Docs updated:

- `docs/obsidian/Thunderstrux Codebase Map.md`
- `docs/obsidian/Architecture Overview.md`
- `docs/obsidian/API Reference.md`
- `docs/obsidian/Frontend and Backend Flow.md`
- `docs/obsidian/Stripe Payments and Connect.md`
- `docs/obsidian/Troubleshooting.md`
- `docs/obsidian/Development Workflow.md`
- `docs/obsidian/Database and Multi Tenancy.md`
- `docs/obsidian/UI Architecture Rules.md`

## Stripe Connect State Model

The UI and backend now use:

```ts
NOT_CONNECTED
CONNECTED_INCOMPLETE
RESTRICTED
READY
ERROR
```

Mapping:

- `NOT_CONNECTED`: no local `stripeAccountId`.
- `CONNECTED_INCOMPLETE`: Stripe account exists but `details_submitted = false`.
- `RESTRICTED`: details submitted but `charges_enabled = false`.
- `READY`: `charges_enabled = true`.
- `ERROR`: Stripe account status could not be retrieved.

Checkout still uses `isOrganisationStripeReady`, which requires:

- `stripeAccountId`
- `stripeChargesEnabled`

## Stripe Connect UX

Settings page:

```text
/dashboard/[orgSlug]/settings
```

The Connect panel supports:

- Connect Stripe Account
- Continue onboarding
- Fix account
- Retry status check
- Refresh status
- Open in Stripe dashboard
- Disconnect Stripe account

Disconnect is local-only. It clears local organisation Stripe fields but does not delete the Stripe account.

## Runtime Notes

Docker loads `.env` through `env_file`.

After changing Stripe keys, recreate containers:

```bash
docker compose down
docker compose up --build -d
```

Verify without printing secrets:

```powershell
docker compose exec app printenv | Select-String -Pattern '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_CONNECT_WEBHOOK_SECRET|NEXT_PUBLIC_APP_URL)=' | ForEach-Object { $line = $_.Line; $name, $value = $line -split '=', 2; if ($value.Length -gt 0) { "$name=set length=$($value.Length)" } else { "$name=EMPTY" } }
```

## Known Stripe Issue From Debugging

Observed error:

```text
You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.
```

Meaning:

- The platform account behind `STRIPE_SECRET_KEY` had not enabled Stripe Connect.

Fix:

- Enable Connect in the Stripe Dashboard for that test platform account.
- Retry Connect onboarding.

## Verification Already Run

Latest build passed:

```bash
docker compose exec app pnpm build
```

The app container was restarted after the Connect refactor:

```bash
docker compose restart app
```

## Not Yet Fully Verified

Real browser Stripe Connect completion and real Stripe Checkout test-mode purchase still need manual verification with valid Stripe test keys and Connect enabled.

## High-Risk Rules To Preserve

- Do not trust frontend tenancy inputs.
- Dashboard navigation belongs in `DashboardShell`.
- Payment fulfilment must remain webhook-driven.
- Stripe onboarding must stay hosted by Stripe.
- Do not collect sensitive onboarding or compliance data in Thunderstrux.
