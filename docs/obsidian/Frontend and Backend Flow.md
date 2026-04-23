# Frontend and Backend Flow

## Public Homepage

File:

```text
app/page.tsx
```

Flow:

```text
User visits /
  -> page renders Discover Events
  -> server component loads published events through lib/events/public-events.ts
  -> cards link to /events/[eventId]
```

The homepage displays:

- Organisation name
- Event title
- Date
- Location
- `View Event`

The shared public loader creates demo public events only if no published events exist. Full development data should still be restored through [[Seeding and Data]].

## Public Event Detail

Files:

- `app/(public)/events/[eventId]/page.tsx`
- `components/events/public-ticket-purchase.tsx`

Flow:

```text
User visits /events/[eventId]
  -> page fetches GET /api/public/events/[eventId]
  -> page renders event details and ticket types
  -> user selects quantity
  -> client component POSTs /api/payments/checkout/event
  -> API returns Stripe Checkout URL
  -> browser redirects to Stripe
```

Checkout request sends only:

- `eventId`
- `ticketTypeId`
- `quantity`

## Dashboard Root

Route:

```text
/dashboard
```

File:

```text
app/(dashboard)/dashboard/page.tsx
```

Flow:

```text
Page forwards request cookies to GET /api/orgs
  -> API returns organisations for session.user.id
  -> page renders onboarding or organisation cards
```

No memberships:

- Shows `You don't have an organisation yet`.
- Shows `Create Organisation`.

With memberships:

- Shows dashboard heading.
- Shows `New organisation`.
- Shows organisation cards with `Open dashboard`.

The dashboard root does not render a card-level Settings button.

## Create Organisation

Route:

```text
/dashboard/create
```

Files:

- `app/(dashboard)/dashboard/create/page.tsx`
- `components/orgs/create-organisation-form.tsx`

Flow:

```text
User submits organisation name
  -> POST /api/orgs
  -> API creates Organisation
  -> API creates org_owner OrganisationMember
  -> form redirects to /dashboard/[orgSlug]
```

Invites and join requests are not implemented.

## Organisation Dashboard

Route:

```text
/dashboard/[orgSlug]
```

Files:

- `app/(dashboard)/dashboard/[orgSlug]/layout.tsx`
- `components/layout/dashboard-shell.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/page.tsx`

Flow:

```text
Layout receives orgSlug
  -> requireOrganisationMembershipBySlug(orgSlug)
  -> render DashboardShell
  -> page renders overview card
```

Shared navigation:

- `Dashboard`
- `Events`
- `Settings`

The page content renders:

- `Organisation dashboard`
- `Manage events for this organisation.`
- `View events`

The page must not render page-level Settings navigation. See [[UI Architecture Rules]].

## Dashboard Events

Route:

```text
/dashboard/[orgSlug]/events
```

Files:

- `app/(dashboard)/dashboard/[orgSlug]/events/page.tsx`
- `components/events/events-list.tsx`
- `app/api/events/route.ts`

Flow:

```text
Events page receives orgSlug
  -> EventsList fetches organisation by slug
  -> EventsList calls GET /api/events?orgId=...
  -> API checks session and membership
  -> API returns organisation-scoped events with ticketTypes
  -> table renders draft/published controls
```

The events list defensively handles missing `ticketTypes`:

```ts
event.ticketTypes?.[0]
(event.ticketTypes?.length ?? 0)
```

## Create And Edit Event

Create route:

```text
/dashboard/[orgSlug]/events/new
```

Edit route:

```text
/dashboard/[orgSlug]/events/[eventId]/edit
```

Both use dashboard APIs that validate authenticated membership and event-management roles.

## Settings And Stripe Connect

Route:

```text
/dashboard/[orgSlug]/settings
```

Files:

- `app/(dashboard)/dashboard/[orgSlug]/settings/page.tsx`
- `components/settings/stripe-connect-settings.tsx`

Flow:

```text
Settings page receives orgSlug
  -> UI resolves organisation
  -> GET /api/stripe/connect/status
  -> user may POST /api/stripe/connect/onboard
  -> browser redirects to Stripe onboarding
  -> UI refreshes status on focus/visibility
```

Only `org_owner` and `finance_manager` can start onboarding.

