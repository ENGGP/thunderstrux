# Frontend and Backend Flow

## Public Homepage Flow

File:

- `app/page.tsx`

Flow:

```text
User visits /
  -> app/page.tsx renders Discover Events
  -> server component queries published events through lib/events/public-events.ts
  -> cards link to /events/[eventId]
```

The homepage displays:

- Event title
- Formatted date
- Location
- Organisation name
- View Event button

API used:

- `GET /api/public/events`

The public API and homepage share the same published-event query. If the database has no published events, the shared loader creates two idempotent demo events with ticket types so the MVP homepage has data to display.

The global navigation bar is rendered from `app/layout.tsx` through `components/layout/navbar.tsx`.

`app/layout.tsx` calls `auth()` server-side and passes the initial session into `components/layout/auth-session-provider.tsx`. This prevents the navbar from disappearing while `useSession()` is still loading on the client.

The navigation bar shows:

- `Sign in` when the visitor is not authenticated
- `Dashboard` when the visitor has a session
- `Sign out` when the visitor has a session

Sign out calls Auth.js `signOut({ callbackUrl: "http://localhost:3000/" })` in local development.

## Public Event Detail Flow

Files:

- `app/(public)/events/[eventId]/page.tsx`
- `components/events/public-ticket-purchase.tsx`

Flow:

```text
User visits /events/[eventId]
  -> page fetches GET /api/public/events/[eventId]
  -> page renders public event details and ticket types
  -> user chooses quantity
  -> client component POSTs /api/payments/checkout/event
  -> API returns Stripe Checkout URL
  -> browser redirects to Stripe
```

The public page shows:

- Event title
- Description
- Start time
- End time
- Location
- Ticket types
- Remaining ticket quantity
- Buy Ticket button

Important:

- Public event page does not directly use Prisma.
- It fetches event data through the public API.
- Checkout request sends only `eventId`, `ticketTypeId`, and `quantity`.

## Dashboard Flow

Files:

- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/dashboard/create/page.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/layout.tsx`
- `components/orgs/create-organisation-form.tsx`
- `components/layout/dashboard-shell.tsx`
- `components/events/events-list.tsx`
- `components/events/create-event-form.tsx`
- `components/settings/stripe-connect-settings.tsx`

Flow:

```text
User visits /dashboard/[orgSlug]
  -> layout renders dashboard shell
  -> pages fetch organisation by slug
  -> dashboard APIs use the authenticated session and OrganisationMember role
```

Dashboard sections:

- Organisation selection and onboarding
- Create organisation
- Dashboard overview
- Events list
- Create event
- Settings
- Stripe Connect onboarding/status

## Dashboard Root And Organisation Onboarding

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
User visits /dashboard
  -> page forwards current request cookies to GET /api/orgs
  -> API returns organisations where session.user.id is an OrganisationMember
  -> page renders either onboarding or organisation cards
```

If the signed-in user has no organisations, the page shows:

- `You don't have an organisation yet`
- `Create your first organisation to start managing events`
- `Create Organisation` button linking to `/dashboard/create`

If the signed-in user has organisations, the page shows cards linking to `/dashboard/[orgSlug]`.

## Create Organisation Flow

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
  -> client form POSTs /api/orgs
  -> API creates Organisation
  -> API creates OrganisationMember for session.user.id as org_owner
  -> form redirects to /dashboard/[orgSlug]
```

The create form uses existing organisation APIs. It does not implement invites or join requests.

## Dashboard Events Route

Route:

```text
/dashboard/[orgSlug]/events
```

File:

```text
app/(dashboard)/dashboard/[orgSlug]/events/page.tsx
```

The route group `(dashboard)` is not part of the URL. The actual URL starts at `/dashboard`.

Important:

- `[orgSlug]` is a placeholder in documentation.
- In the browser you must use a real organisation slug, for example `/dashboard/my-society/events`.
- If the organisation slug does not exist, the page can render an organisation lookup error.
- That is different from a Next.js route 404.

## Dashboard Events List Flow

Files:

- `app/(dashboard)/dashboard/[orgSlug]/events/page.tsx`
- `components/events/events-list.tsx`
- `app/api/events/route.ts`

Flow:

```text
Events page receives orgSlug
  -> EventsList fetches organisation by slug
  -> EventsList calls GET /api/events?orgId=...
  -> API checks the authenticated session and OrganisationMember row
  -> API returns organisation-scoped events with ticketTypes
  -> table renders events
```

The dashboard event list defensively handles missing ticket type data:

```ts
event.ticketTypes?.[0]
(event.ticketTypes?.length ?? 0)
```

This prevents runtime crashes if an older API response or stale dev cache omits `ticketTypes`.

## Create Event Flow

```text
Create event form
  -> resolves organisation by slug
  -> POST /api/events
  -> API validates authenticated membership and role
  -> Prisma creates Event
```

## Stripe Connect Settings Flow

```text
Settings page
  -> resolves organisation by slug
  -> GET /api/stripe/connect/status
  -> user clicks Connect Stripe Account
  -> POST /api/stripe/connect/onboard
  -> API creates Express account or rejects if existing
  -> API returns Stripe onboarding URL
  -> browser redirects to Stripe
```

Only `org_owner` and `finance_manager` can start onboarding.
