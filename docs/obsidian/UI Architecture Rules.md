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

`app/(dashboard)/dashboard/[orgSlug]/layout.tsx`

- Resolves org membership and organisation name
- Passes name and slug into `DashboardShell`

`components/layout/dashboard-shell.tsx`

- Renders the fixed left sidebar below the global header
- Renders the organisation heading row
- Renders page children

## Page Responsibilities

`/dashboard`

- Renders organisation selection and onboarding

`/dashboard/[orgSlug]`

- Renders overview content and `View events`
- Must not render `Open settings`

`/dashboard/[orgSlug]/events`

- Renders event list content

`/dashboard/[orgSlug]/orders`

- Renders organisation-scoped order review for finance-capable roles

`/dashboard/[orgSlug]/settings`

- Renders Stripe Connect settings.
- State-specific Connect controls are allowed here because they are settings content, not dashboard navigation.

## Current Button Rules

`/dashboard`

- Shows `New organisation`
- Organisation cards show `Open dashboard`
- Organisation cards do not show `Settings`

`/dashboard/[orgSlug]`

- Sidebar shows `Dashboard`, `Events`, `Orders`, `Settings`
- Page content shows `View events`
- Page content must not show `Open settings`

## Current Heading Rules

- The organisation name appears in the dashboard header area, not in the sidebar body.
- The edit event route should render only one edit title: `Edit event` from the form.

## Stripe Settings UI Rules

The Stripe Connect settings card should render from backend lifecycle state:

- `NOT_CONNECTED`: connect button only.
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
