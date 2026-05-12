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
  -> page renders public event cards
```

Important current behavior:

- `app/page.tsx` is `force-dynamic`.
- Public homepage cards always link to `/events/[eventId]`.
- Public event reads are read-only. If there are zero published events in the whole database, the API returns an empty event list.
- Demo public events come from `prisma/seed.mjs`, not from public runtime reads.

## Public Event Detail

Files:

- `app/(public)/events/[eventId]/page.tsx`
- `app/api/public/events/[eventId]/route.ts`
- `components/events/public-ticket-purchase.tsx`
- `app/tickets/page.tsx`

Flow:

```text
User visits /events/[eventId]
  -> proxy redirects organisation accounts to /dashboard/events/[eventId]
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
  -> old active reservations for the ticket type are expired
  -> local Order row is created with status=pending
  -> active TicketReservation row is created with a 30-minute expiry
  -> Stripe Checkout session is created with expires_at matching the reservation expiry
  -> Order row is updated with stripeSessionId
  -> browser redirects to Stripe
  -> payment webhook marks Order paid and issues Ticket rows
  -> after fulfilment succeeds, webhook flow attempts ticket delivery email
  -> in non-production only, /success?session_id=... can reconcile paid sessions if local webhook forwarding is absent
  -> buyer sees the result at /tickets
```

Buyer tickets page:

- Requires authentication.
- Runs stale pending order cleanup for the signed-in member before reading orders.
- Reads orders by `session.user.id`.
- Shows paid orders only.
- Pending, expired, and failed order states remain internal/system history.
- Shows ticket identifiers once tickets have been issued.

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
  -> User row created with hashed password and accountRole
  -> frontend signs in via credentials
  -> browser redirects to callbackUrl
```

```text
User signs in
  -> signIn("credentials")
  -> auth.ts checks email/password against Prisma
  -> session.user.id and session.user.accountRole are exposed
  -> browser redirects to callbackUrl
```

## Dashboard Root

Files:

- `app/(dashboard)/dashboard/page.tsx`
- `app/api/orgs/route.ts`

Flow:

```text
User visits /dashboard
  -> server reads authenticated user from session
  -> member account renders member dashboard
  -> organisation account resolves Organisation.accountUserId
  -> organisation account renders organisation dashboard directly
```

Current UI:

- Member dashboard shows profile completion, joined organisations, event discovery, and tickets.
- Organisation dashboard shows organisation name, upcoming events, recent orders, past-month revenue, and management navigation.

## Member Organisation Search And Join

Files:

- `app/(dashboard)/dashboard/organisations/page.tsx`
- `components/members/organisation-search.tsx`
- `app/api/orgs/search/route.ts`
- `app/api/orgs/[orgSlug]/join/route.ts`

Flow:

```text
Member opens /dashboard/organisations
  -> page requires accountRole = member
  -> OrganisationSearch calls GET /api/orgs/search?q=...
  -> API returns public-safe organisation rows and joined state
  -> member clicks Join
  -> POST /api/orgs/[orgSlug]/join
  -> API creates or updates OrganisationMember with role = member
```

Important rule:

- Joining an organisation never grants management access.

## Member Organisation Details And Leave

Files:

- `components/members/member-organisations-list.tsx`
- `app/(public)/organisations/[orgSlug]/page.tsx`
- `app/api/orgs/[orgSlug]/leave/route.ts`

Flow:

```text
Member opens /dashboard
  -> joined organisation cards render View details and Leave organisation actions
  -> View details links to /organisations/[orgSlug]
  -> public organisation details page loads public-safe organisation data and upcoming published events
  -> Leave organisation confirms in the browser
  -> POST /api/orgs/[orgSlug]/leave
  -> API requires accountRole = member
  -> API deletes only the signed-in user's OrganisationMember row for that organisation
  -> dashboard refreshes
```

Important rules:

- `/organisations/[orgSlug]` exposes only public-safe organisation data and upcoming published events.
- Leave is idempotent when the member is already not joined.
- Organisation accounts cannot leave their owned organisation through the member leave endpoint.

## Create Organisation

Files:

- `app/(dashboard)/dashboard/create/page.tsx`
- `components/orgs/create-organisation-form.tsx`
- `app/api/orgs/route.ts`

Flow:

```text
User submits organisation name
  -> POST /api/orgs
  -> API requires accountRole = organisation
  -> API verifies the organisation account does not already own an organisation
  -> API normalises or generates slug
  -> API creates Organisation
  -> API sets Organisation.accountUserId
  -> API creates transitional org_owner membership for compatibility
  -> frontend redirects to /dashboard
```

## Organisation Dashboard Overview

Files:

- `app/(dashboard)/dashboard/page.tsx`
- `components/layout/dashboard-shell.tsx`

Flow:

```text
Page resolves the signed-in organisation account
  -> requireCurrentOrganisationAccount()
  -> pass organisation.name into DashboardShell
  -> page renders overview, upcoming events, recent orders, and revenue summary
```

Current UI:

- Sidebar navigation: `Dashboard`, `Events`, `Orders`, `Settings`
- Header shows the organisation name
- Primary management links use slugless `/dashboard/*` paths.
- Legacy `/dashboard/[orgSlug]/*` pages redirect for backwards compatibility.

## Events Dashboard

Files:

- `app/(dashboard)/dashboard/events/page.tsx`
- `app/(dashboard)/dashboard/events/layout.tsx`
- `components/events/events-list.tsx`
- `app/api/events/route.ts`
- `app/api/events/[eventId]/route.ts`
- `app/api/events/[eventId]/publish/route.ts`

Flow:

```text
Events page resolves current organisation account
  -> EventsList fetches organisation by slug via /api/orgs/[orgSlug] for API compatibility
  -> EventsList fetches GET /api/events?orgId=...
  -> API verifies organisation account ownership for organisationId
  -> events render with management actions
```

Supported actions:

- Create new event
- View event analytics
- Edit event
- Publish draft event
- Unpublish published event, but only if there are no orders
- Delete event, but only if there are no orders or tickets

Important edit rules:

- Ticket types with existing orders or issued tickets cannot be deleted.
- Ticket types with existing orders or issued tickets can be renamed and can have price/quantity changed for future purchases.
- Historical `Order.unitPrice` and `Order.totalAmount` are preserved when ticket type price changes.
- Existing `Ticket` rows remain linked to the same `ticketTypeId`.
- Event deletion is blocked after orders or ticket issuance.

Edit link shape:

```ts
`/dashboard/${orgSlug}/events/${event.id}/edit`
or current slugless form:
`/dashboard/events/${event.id}/edit`
```

The link is generated in:

```text
components/events/events-list.tsx
```

The expected page is:

```text
app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx
app/(dashboard)/dashboard/events/[eventId]/edit/page.tsx
```

View event link shape:

```ts
`/dashboard/events/${event.id}`
```

The expected page is:

```text
app/(dashboard)/dashboard/events/[eventId]/page.tsx
```

There is also a pass-through layout at:

```text
app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx
```

This exists intentionally. In the Docker/Windows/OneDrive dev setup, Next 16 repeatedly failed to register nested child event routes in `.next/dev/server/app-paths-manifest.json` unless the `events` segment had an explicit route boundary.

If this URL returns the generic not-found page while source is correct, do not rewrite the href first. Check the dev route manifest in [[Troubleshooting]].

## Create and Edit Event

Files:

- `app/(dashboard)/dashboard/[orgSlug]/events/new/page.tsx`
- `app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx`
- `app/(dashboard)/dashboard/events/new/page.tsx`
- `app/(dashboard)/dashboard/events/[eventId]/edit/page.tsx`
- `components/events/create-event-form.tsx`

Flow:

```text
CreateEventForm loads organisation by slug
  -> create mode posts to /api/events
  -> edit mode patches /api/events/[eventId]
  -> PATCH validates event fields and ticketTypes
  -> PATCH checks event-management access
  -> PATCH updates Event and synchronises TicketType rows in a Prisma transaction
  -> form calls router.refresh()
  -> on success, router.push(`/dashboard/events`) on slugless routes
```

Edit route access:

```text
Edit page receives eventId
  -> requireCurrentOrganisationAccount()
  -> query Event where id = eventId and organisationId = current organisation.id
  -> render CreateEventForm in edit mode
  -> notFound() when the event belongs to another org
```

Current UI note:

- Edit page now shows only one `Edit event` title.
- New event page still has a top page heading `Create Event` and the form title `New event`.

Ticket edit details:

- Create mode requires ticket quantity greater than zero.
- Edit mode allows ticket quantity zero so sold-out ticket types can remain attached while event fields are edited.
- Existing ticket rows must include `id`.
- New ticket rows omit `id`.
- Existing ticket rows included in the payload update `name`, `price`, and `quantity`, even if orders or issued tickets exist.
- Removing a ticket row from the submitted array deletes it only if it has no orders or issued tickets.
- Sold/issued ticket rows omitted from the payload are preserved unchanged instead of being deleted.
- Sold/issued ticket rows keep editable name/price/quantity inputs, but their Remove button is disabled.

## Organiser Event Analytics

Files:

- `app/(dashboard)/dashboard/events/[eventId]/page.tsx`
- `lib/events/event-analytics.ts`

Flow:

```text
Organisation opens /dashboard/events/[eventId]
  -> proxy allows organisation accounts and redirects member accounts to /
  -> page resolves current organisation through Organisation.accountUserId
  -> analytics helper runs stale pending order cleanup for that event
  -> analytics helper fetches event/ticket types and paid-order aggregates in one Prisma transaction
  -> revenue series helper fetches paid order paidAt/totalAmount values for UTC daily grouping
  -> page renders event details, revenue, sold count, remaining count, UTC revenue chart, ticket rows, order link, and ticket visibility link
```

Analytics rules:

- Remaining is current `TicketType.quantity`.
- Sold is summed from paid `Order.quantity`.
- Revenue is summed from paid `Order.totalAmount`.
- Revenue is grouped per ticket type by `Order.ticketTypeId`.
- Revenue-over-time is grouped by UTC day and labelled as `Revenue (UTC)`.
- The UI does not show total capacity.
- Empty states are shown for no ticket types and no tickets sold.

## Organiser Event Tickets And Check-in

Files:

- `app/(dashboard)/dashboard/events/[eventId]/tickets/page.tsx`
- `app/api/events/[eventId]/tickets/route.ts`
- `app/api/tickets/[ticketId]/check-in/route.ts`
- `components/tickets/ticket-check-in-button.tsx`
- `lib/tickets/check-in.ts`

Flow:

```text
Organisation opens /dashboard/events/[eventId]/tickets
  -> page resolves current organisation through Organisation.accountUserId
  -> server query verifies the event belongs to the current organisation
  -> page parses limit/cursor/direction pagination params
  -> page renders one cursor-paginated slice of issued Ticket rows for that event
  -> pagination uses stable ordering by Ticket.createdAt then Ticket.id
  -> Next and Previous links pass opaque cursors back to the same route/API
  -> each row shows buyer, ticket type, createdAt, and unused/checked-in state
  -> Check in button calls POST /api/tickets/[ticketId]/check-in
  -> API verifies ticket ownership through the event/organisation relationship
  -> API atomically sets checkedInAt only when it is currently null
  -> Check out button calls POST /api/tickets/[ticketId]/check-out
  -> API atomically clears checkedInAt only when it is currently not null
  -> UI disables the button and shows the checked-in timestamp
```

Rules:

- Member accounts cannot view event tickets or check tickets in.
- The current route/API uses organisation event-management access checks.
- Frontend ticket ids are inputs only; ownership is verified server-side.
- Double check-in returns `409` and preserves the original timestamp.
- Check-out returns `409` when the ticket is already unused.
- Check-in and check-out only mutate `Ticket.checkedInAt`.
- Check-in and check-out do not alter order status, Stripe state, ticket ownership, or ticket type data.
- `GET /api/events/[eventId]/tickets` defaults to 25 tickets per page and supports `limit`, `cursor`, and `direction`.
- Invalid pagination params return `400` from the API; the server-rendered page redirects invalid pagination back to the first page.

## Stripe Settings

Files:

- `app/(dashboard)/dashboard/settings/page.tsx`
- `components/settings/stripe-connect-settings.tsx`
- `app/api/stripe/connect/status/route.ts`
- `app/api/stripe/connect/onboard/route.ts`
- `app/api/stripe/connect/continue/route.ts`
- `app/api/stripe/connect/disconnect/route.ts`
- `lib/stripe/connect.ts`

Flow:

```text
Settings page resolves current organisation account
  -> client resolves organisation via /api/orgs/[orgSlug] for API compatibility
  -> GET /api/stripe/connect/status?organisationId=...
  -> backend maps account into NOT_CONNECTED / PLATFORM_NOT_READY / CONNECTED_INCOMPLETE / RESTRICTED / READY / ERROR
  -> user may connect, open platform settings, retry onboarding, continue onboarding, fix account, open dashboard, refresh status, or disconnect locally
  -> browser redirects to Stripe-hosted onboarding when needed
  -> status refreshes when window regains focus
```

Current UX by state:

- `NOT_CONNECTED`: show `Connect Stripe Account`.
- `PLATFORM_NOT_READY`: explain Stripe platform setup is required and show `Open Stripe Platform Settings`, `Retry after completion`, and `Disconnect Stripe account`.
- `CONNECTED_INCOMPLETE`: explain onboarding is incomplete and show `Continue onboarding`.
- `RESTRICTED`: explain Stripe requires more information and show `Fix account`.
- `READY`: show that Stripe is ready and display charges/payout status.
- `ERROR`: show the Stripe error, retry status check, dashboard link if available, and disconnect.

Current disconnect behavior:

- Disconnect clears local organisation Stripe fields only.
- It does not delete the Stripe Express account.
- Clicking `Connect Stripe Account` after disconnect creates a new account unless the old `acct_...` id is manually restored in the DB.

Important security detail:

- The frontend sends `organisationId` only as an input.
- Every Connect mutation rechecks the authenticated organisation account ownership on the server.

## Organiser Orders

Files:

- `app/(dashboard)/dashboard/orders/page.tsx`
- `app/(dashboard)/dashboard/orders/[orderId]/page.tsx`
- `app/api/orders/route.ts`
- `app/api/orders/[orderId]/route.ts`
- `app/api/orders/[orderId]/refund-manual/route.ts`
- `app/api/orders/[orderId]/resend/route.ts`
- `lib/orders/grouped-orders.ts`
- `lib/orders/order-detail.ts`
- `lib/email/ticket-delivery.ts`

Flow:

```text
Page resolves current organisation account
  -> requireOrganisationFinanceAccess(organisation.id)
  -> stale pending order cleanup runs for the organisation
  -> optionally validates eventId belongs to the current organisation
  -> query orders scoped through Order.event.organisationId with optional eventId/search/date filters
  -> render grouped events, buyer, ticket type, quantity, total, status, and timestamps
```

Access:

- Organisation account required.
- Finance access required.

Current UI:

- Orders are grouped by event.
- Search supports buyer email.
- Filters support event id and createdAt date range.
- Normal status filters support `all`, `paid`, `expired`, and `failed`.
- Default `all` excludes internal `pending` orders.
- `Show system orders` enables a debug/system view that can include `pending`.
- Event-filtered views show an event header and `Back to all orders`.
- Empty states are shown when no orders match.

Order detail flow:

```text
Organisation opens /dashboard/orders/[orderId]
  -> page resolves current organisation account
  -> query verifies the order belongs to an event owned by the current organisation
  -> page renders order snapshot data, buyer, event link, issued ticket ids, total, and Stripe session id
  -> manual refund action calls PATCH /api/orders/[orderId]/refund-manual
  -> resend action calls POST /api/orders/[orderId]/resend
```

Rules:

- Organiser order access uses `Order.event.organisationId` as the ownership source of truth.
- `Order.organisationId` remains stored but should not be used alone for organiser access decisions.
- Manual refund only sets `Order.isManuallyRefunded`; it never calls Stripe and never changes order status.
- Manual resend is paid-order only and sends actual ticket email through the email delivery service.
- Manual resend updates `ticketEmailResentAt` on success and `ticketEmailLastError` on failure.
- Pending orders remain hidden from normal organiser UI.

## Ticket Email Delivery

Files:

- `lib/email/ticket-delivery.ts`
- `lib/payments/checkout-fulfilment-orchestrator.ts`
- `lib/payments/checkout-reconciliation.ts`
- `app/api/orders/[orderId]/resend/route.ts`

Automatic webhook flow:

```text
Stripe checkout.session.completed received
  -> fulfilment orchestrator calls checkout reconciliation
  -> reconciliation validates paid session and pending order
  -> transaction marks order paid, confirms reservation, decrements inventory, and creates tickets
  -> reconciliation returns a typed result
  -> when result is fulfilled, orchestrator runs sendTicketDeliveryEmail(..., mode="automatic")
  -> success sets ticketEmailSentAt and clears ticketEmailLastError
  -> failure sets ticketEmailLastError and logs the error
```

Rules:

- Email is attempted only after successful payment fulfilment and ticket issuance.
- Email failure is non-blocking and must not roll back order payment, reservation confirmation, inventory decrement, or ticket issuance.
- Duplicate webhook delivery does not resend automatic ticket email after `ticketEmailSentAt` is set.
- Manual resend can send again for paid orders and updates `ticketEmailResentAt`.
- No attachments, QR codes, queues, or notification preferences exist in the MVP.
