# UI Architecture Rules

## Dashboard Navigation Rule

Organisation dashboard navigation must live in:

```text
components/layout/dashboard-shell.tsx
```

Current nav items:

- `Dashboard`
- `Events`
- `Orders`
- `Settings`

Do not duplicate these links in page files.

## Account-Specific Dashboards

`/dashboard` is role-aware.

Member accounts:

- See profile completion.
- See joined organisations.
- Can navigate to `/dashboard/organisations` to search and join organisations.
- Can browse public events and view `/tickets`.
- Must not see organisation management navigation.

Organisation accounts:

- See the organisation dashboard directly at `/dashboard`.
- Use `DashboardShell`.
- Use slugless management routes:
  - `/dashboard/events`
  - `/dashboard/orders`
  - `/dashboard/settings`

Legacy `/dashboard/[orgSlug]/*` routes are compatibility redirects only.

## Global Header Rule

Global top navigation belongs in:

```text
components/layout/navbar.tsx
```

Current header behavior:

- Fixed at the top
- Height `h-16`
- Left side: `Thunderstrux`
- Right side when signed in: `Dashboard`, `Sign out`

## Layout Responsibilities

`app/layout.tsx`

- Imports `globals.css`
- Renders the session provider
- Renders the fixed navbar
- Offsets content below the header with `pt-16`

`app/(dashboard)/dashboard/page.tsx`

- Branches by account role.
- Renders member dashboard without `DashboardShell`.
- Renders organisation dashboard inside `DashboardShell`.

`components/layout/dashboard-shell.tsx`

- Renders the fixed left sidebar below the global header.
- Renders the organisation heading row.
- Renders page children.
- Uses `/dashboard` as the base path for organisation management.

## Page Responsibilities

`/dashboard`

- Member: profile, joined organisations, search/join entry point, public events, tickets.
- Organisation: organisation overview, upcoming events, recent orders, past-month revenue summary.

`/dashboard/events`

- Renders event list content.

`/dashboard/events/new`

- Renders event creation content.

`/dashboard/events/[eventId]/edit`

- Renders event editing content.

`/dashboard/orders`

- Renders organisation-scoped order review for organisation accounts.

`/dashboard/settings`

- Renders Stripe Connect settings.
- State-specific Connect controls are allowed here because they are settings content, not dashboard navigation.

`/dashboard/organisations`

- Renders member organisation search/join content.

## Current Button Rules

Organisation dashboard:

- Shows `New event`.
- Sidebar shows `Dashboard`, `Events`, `Orders`, `Settings`.
- Page content may link to event/order drilldowns.

Member dashboard:

- Shows `Search organisations`, `Browse`, and `/tickets` entry points.
- Must not show event-management, order-management, or settings controls.

## Current Heading Rules

- The organisation name appears in the dashboard header area, not in the sidebar body.
- The edit event route should render only one edit title: `Edit event` from the form.

## Stripe Settings UI Rules

The Stripe Connect settings card should render from backend lifecycle state:

- `NOT_CONNECTED`: connect button only.
- `PLATFORM_NOT_READY`: platform settings link, retry button, and local disconnect button.
- `CONNECTED_INCOMPLETE`: continue onboarding.
- `RESTRICTED`: fix account and show requirements if Stripe provides them.
- `READY`: show readiness and cached flags.
- `ERROR`: show clear error and recovery actions.

Always show the readiness rows when status exists:

- Lifecycle state
- Stripe account
- Charges enabled
- Payouts enabled
- Details submitted

Do not call an account "ready" just because `stripeAccountId` exists.

`Disconnect Stripe account` is local-only. It may appear for connected states and `PLATFORM_NOT_READY`. It clears local organisation Stripe fields and does not delete the Stripe account in Stripe.

## Styling Rules

Current shared visual direction:

- Neutral grey page background
- White cards
- `rounded-xl`
- `border border-neutral-200`
- `shadow-sm`
- Primary buttons use `bg-neutral-900 text-white hover:bg-neutral-700`

## Known UI Inconsistencies

- `DashboardShell` does not yet compute the active nav item from the current route; `Dashboard` is always styled active.
- New event route still shows a top page heading plus the form title.
