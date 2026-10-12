---
status: living
last-reviewed: 2026-10-12
owner: engineering
related: ["[[Frontend and Backend Flow]]", "[[Authentication and Dashboard Access]]"]
sources: [components/layout/dashboard-shell.tsx, components/layout/navbar.tsx]
---

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
- `Notifications`
- `Society profile` (organisation:settings)
- `Stripe settings` (stripe:manage)
- `Staff`
- `Staff MFA`

Do not duplicate these links in page files.

## Account-Specific Dashboards

`/dashboard` is role-aware.

Member accounts in personal mode, including named staff on a fresh login:

- See profile completion.
- See joined organisations.
- Can navigate to `/dashboard/organisations` to search and join organisations.
- Can browse public events and view `/tickets`.
- Must not see organisation management navigation.

Explicitly selected live staff context and permitted legacy organisation context:

- See the permitted organisation dashboard at `/dashboard`; the context selector offers personal mode and authorised societies. The signed preference is login-bound and carries no authority.
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
- Fixed height `h-16`, matching the content/sidebar offset
- Left side: `Thunderstrux`
- Societies is visible to anonymous and signed-in visitors. Desktop signed-in links include Dashboard, private Settings, Sign out and member My tickets. Mobile keeps Societies and Sign out visible and places account links in a native Menu disclosure.

## Layout Responsibilities

`app/layout.tsx`

- Imports `globals.css`
- Renders the session provider
- Renders the fixed navbar
- Offsets content below the header with `pt-16`

`app/(dashboard)/dashboard/page.tsx`

- Resolves the signed context against live staff/MFA authority; member accounts default personal rather than automatically entering a staff tenant. Organisation accounts retain only an authorised bootstrap fallback when no context preference exists.
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

- Renders canonical tenant-scoped order review for callers with live finance capability, regardless of account role.
- Normal filters hide internal pending orders.
- `Show system orders` may expose pending orders for debugging, but pending must not be presented as a normal product status.

`/dashboard/settings`

- Renders Stripe Connect settings.
- State-specific Connect controls are allowed here because they are settings content, not dashboard navigation.

`/dashboard/organisations`

- Renders caller-only joined societies and bounded paged search. Explicit verified Join changes free affiliation only; Leave synchronises both views after refresh and never revokes staff or paid purchases.

`/organisations` and `/organisations/[orgSlug]` render anonymous discovery and public profile content. Profile join controls are personalized and dynamic; sign-in/verification never automatically joins. `/dashboard/settings/profile` is the live-settings/MFA-protected resumable editor. [[Society Profiles and Assets]] owns their full contracts.

## Current Button Rules

Organisation dashboard:

- Shows `New event`.
- Sidebar filters Dashboard, Events, Orders, Notifications, Society profile, Stripe settings and Staff by capability; Staff MFA remains available. The longest matching route sets aria-current and active styling.
- Page content may link to event/order drilldowns.

Member dashboard:

- Shows `Search organisations`, `Browse`, and `/tickets` entry points.
- Must not show management controls without live staff authority. Private account Settings remains available to all active authenticated accounts.

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

Scoped society surfaces and the explicit society button variant use the purple `--ts-*` tokens in app/globals.css. Existing general dashboards retain the neutral styling below; the target visual specification is not a claim that the entire app has been restyled.

- Neutral grey page background
- White cards
- `rounded-xl`
- `border border-neutral-200`
- `shadow-sm`
- Primary buttons use `bg-neutral-900 text-white hover:bg-neutral-700`

## Known UI Inconsistencies

- New event route still shows a top page heading plus the form title.

## Notification Recovery

The shared DashboardShell owns the Notifications navigation link. `/dashboard/notifications` requires live email-resend authority and renders a bounded failed-business-job list, review-reason forms, accessible status/error feedback and pagination. Account-security jobs are private and absent.
