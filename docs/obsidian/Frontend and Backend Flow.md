# Frontend and Backend Flow

## Public Homepage

Files:

- `app/page.tsx`
- `app/api/public/events/route.ts`
- `lib/events/public-events.ts`

Flow:

```text
User visits /
  -> page fetches GET /api/public/events with cache: no-store
  -> API calls getPublishedEvents()
  -> getPublishedEvents() ensures demo published events exist if there are zero published events
  -> page renders public event cards
```

Important current behavior:

- `app/page.tsx` is `force-dynamic`.
- Public homepage cards always link to `/events/[eventId]`.
- If there are zero published events in the whole database, demo events are auto-created.

## Public Event Detail

Files:

- `app/(public)/events/[eventId]/page.tsx`
- `app/api/public/events/[eventId]/route.ts`
- `components/events/public-ticket-purchase.tsx`

Flow:

```text
User visits /events/[eventId]
  -> page fetches GET /api/public/events/[eventId]
  -> API returns only published events
  -> page renders event details and ticketTypes
  -> PublicTicketPurchase handles client-side checkout start
```

Checkout flow:

```text
User selects quantity
  -> POST /api/payments/checkout/event
  -> route validates event, ticket type, quantity, status, inventory, and Stripe readiness
  -> Stripe Checkout session is created
  -> local Order row is created with status=pending
  -> browser redirects to Stripe
```

## Login and Signup

Files:

- `app/login/page.tsx`
- `app/signup/page.tsx`
- `components/auth/credentials-login-form.tsx`
- `components/auth/signup-form.tsx`
- `app/api/auth/signup/route.ts`
- `app/api/auth/[...nextauth]/route.ts`

Flow:

```text
User signs up
  -> POST /api/auth/signup
  -> User row created with hashed password
  -> frontend signs in via credentials
  -> browser redirects to callbackUrl
```

```text
User signs in
  -> signIn("credentials")
  -> auth.ts checks email/password against Prisma
  -> session.user.id is exposed
  -> browser redirects to callbackUrl
```

## Dashboard Root

Files:

- `app/(dashboard)/dashboard/page.tsx`
- `app/api/orgs/route.ts`

Flow:

```text
Server page forwards request cookies to GET /api/orgs
  -> API reads authenticated user from session
  -> API loads organisation memberships and maps to organisation list
  -> page renders empty state or organisation cards
```

Current UI:

- Empty state shows `Create Organisation`.
- Populated state shows `New organisation` and `Open dashboard`.
- Root dashboard does not render a card-level `Settings` button.

## Create Organisation

Files:

- `app/(dashboard)/dashboard/create/page.tsx`
- `components/orgs/create-organisation-form.tsx`
- `app/api/orgs/route.ts`

Flow:

```text
User submits organisation name
  -> POST /api/orgs
  -> API normalises or generates slug
  -> API creates Organisation
  -> API creates org_owner membership for current user
  -> frontend redirects to /dashboard/[orgSlug]
```

## Organisation Dashboard Overview

Files:

- `app/(dashboard)/dashboard/[orgSlug]/layout.tsx`
- `components/layout/dashboard-shell.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/page.tsx`

Flow:

```text
Layout receives orgSlug
  -> requireOrganisationMembershipBySlug(orgSlug)
  -> pass organisation.name + orgSlug into DashboardShell
  -> page renders overview content
```

Current UI:

- Sidebar navigation: `Dashboard`, `Events`, `Settings`
- Header shows the organisation name
- Page body shows `View events`
- Page body does not render `Open settings`

## Events Dashboard

Files:

- `app/(dashboard)/dashboard/[orgSlug]/events/page.tsx`
- `components/events/events-list.tsx`
- `app/api/events/route.ts`
- `app/api/events/[eventId]/route.ts`
- `app/api/events/[eventId]/publish/route.ts`

Flow:

```text
Events page receives orgSlug
  -> EventsList fetches organisation by slug via /api/orgs/[orgSlug]
  -> EventsList fetches GET /api/events?orgId=...
  -> API verifies membership for organisationId
  -> events render with management actions
```

Supported actions:

- Create new event
- Edit event
- Publish draft event
- Unpublish published event, but only if there are no orders
- Delete event, but only if there are no orders or tickets

Important edit rules:

- Ticket types with existing orders or issued tickets cannot be deleted.
- Ticket types with existing orders or issued tickets cannot be modified.
- Event deletion is blocked after orders or ticket issuance.

## Create and Edit Event

Files:

- `app/(dashboard)/dashboard/[orgSlug]/events/new/page.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx`
- `components/events/create-event-form.tsx`

Flow:

```text
CreateEventForm loads organisation by slug
  -> create mode posts to /api/events
  -> edit mode patches /api/events/[eventId]
  -> on success, router.push(`/dashboard/${orgSlug}/events`)
```

Current UI note:

- Edit page now shows only one `Edit event` title.
- New event page still has a top page heading `Create Event` and the form title `New event`.

## Stripe Settings

Files:

- `app/(dashboard)/dashboard/[orgSlug]/settings/page.tsx`
- `components/settings/stripe-connect-settings.tsx`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/onboard/route.ts`

Flow:

```text
Settings page receives orgSlug
  -> client resolves organisation via /api/orgs/[orgSlug]
  -> GET /api/stripe/connect/status?organisationId=...
  -> user may POST /api/stripe/connect/onboard
  -> browser redirects to Stripe onboarding
  -> status refreshes when window regains focus
```
