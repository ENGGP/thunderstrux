# API Reference

This is a concise reference for implemented API routes. Security and data-model rules are documented in [[Database and Multi Tenancy]].

## Mutation Origin Guard

Custom cookie-authenticated mutation routes (`POST`, `PATCH`, `DELETE`) use a central trusted-origin guard.

Rules:

- If `Origin` exists, it must match `NEXT_PUBLIC_APP_URL` or `TRUSTED_APP_ORIGINS`.
- If `Origin` is missing and `Referer` exists, the `Referer` origin must be trusted.
- Compatibility mode: if both are missing, the request is currently allowed and a warning is logged for remediation tracking.
- Stripe webhook routes are exempt and remain protected by Stripe signature verification on raw request bodies.

## Rate Limiting

High-risk mutation routes use central Redis-backed fixed-window rate limiting.

Protected routes:

- credentials login
- signup
- checkout creation
- ticket email resend
- organisation create, join, and leave
- ticket check-in and check-out
- Stripe Connect onboard, continue, and disconnect

Rules:

- Login, signup, and organisation creation fail closed if the limiter backend is unavailable.
- Checkout, resend, join/leave, check-in/check-out, and Stripe Connect mutations fail open with a structured warning if the limiter backend is unavailable.
- Limit responses use `429` with a safe retry message and `Retry-After` when available.
- Bucket keys are hashed before Redis storage; warning logs avoid request bodies, cookies, tokens, passwords, raw emails, raw user IDs, raw order IDs, Redis URLs, and unhashed bucket keys.
- Stripe webhook routes are not rate-limited.

## Auth And Profile

### `POST /api/auth/signup`

Creates either a member account or an organisation account.

Request:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "accountRole": "member"
}
```

Rules:

- `accountRole` is `member` or `organisation`.
- Old email/password-only requests default to `member`.
- Member signup may include `firstName` and `lastName`.

### `PATCH /api/me/profile`

Completes or updates member onboarding profile fields.

Rules:

- Auth required.
- Member account required.
- Stores first name, last name, and optional useful profile fields.

## Organisation Search And Join

### `GET /api/orgs/search?q=...`

Searches organisations by name or slug.

Rules:

- Auth required.
- Member account required.
- Returns public-safe organisation fields and whether the member has joined.

### `POST /api/orgs/[orgSlug]/join`

Joins an organisation as a member.

Rules:

- Auth required.
- Member account required.
- Creates or updates an `OrganisationMember` row with role `member`.

### `POST /api/orgs/[orgSlug]/leave`

Leaves an organisation as a member.

Rules:

- Auth required.
- Member account required.
- Deletes only the signed-in member account's `OrganisationMember` row for the resolved organisation.
- Organisation accounts cannot use this endpoint.
- If the member is already not joined, the endpoint still returns success.

## Public Events

### `GET /api/public/events`

Returns published events for public discovery.

Rules:

- No auth required.
- Only `published` events are returned.
- Response is public-safe.
- Cursor pagination uses stable `startTime ASC, id ASC` ordering.
- Query params:
  - `limit`: optional integer `1..100`, defaults to `25`.
  - `cursor`: optional opaque cursor from `pageInfo.nextCursor` or `pageInfo.previousCursor`.
  - `direction`: optional `next` or `prev`, defaults to `next`.
- Invalid pagination params return structured `400`.
- Read-only. If no published events exist, returns an empty `events` array instead of creating demo data.

Example response:

```json
{
  "events": [
    {
      "id": "event_id",
      "title": "Event title",
      "startTime": "2026-04-23T10:00:00.000Z",
      "location": "Campus hall",
      "organisation": {
        "name": "Society name"
      }
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  }
}
```

### `GET /api/public/events/[eventId]`

Returns public event details.

Rules:

- No auth required.
- Event must be `published`.
- Includes ticket types.
- Read-only. Does not run stale pending order cleanup or mutate orders/reservations.
- Organisation accounts are redirected at the route/proxy layer from `/events/[eventId]` to `/dashboard/events/[eventId]`; this API remains public-safe.

## Organisations

### `GET /api/orgs`

Returns organisations for the authenticated account.

Rules:

- Auth required.
- Uses `session.user.id`.
- Does not trust frontend organisation headers.
- Member accounts receive joined organisations.
- Organisation accounts receive their one owned organisation, if created.

### `POST /api/orgs`

Creates an organisation.

Request:

```json
{
  "name": "Engineering Society"
}
```

Rules:

- Auth required.
- Organisation account required.
- An organisation account can create only one organisation.
- Slug is normalised server-side.
- Slug uniqueness is enforced.
- The created organisation stores `accountUserId`.
- A transitional `org_owner` membership is also created for compatibility.

### `GET /api/orgs/[orgSlug]`

Fetches an organisation by slug.

Rules:

- Auth required.
- Signed-in organisation account must own the organisation, or a member account must have a membership during compatibility.

## Events

### `GET /api/events?orgId=...`

Lists events for one organisation.

Rules:

- Auth required.
- `orgId` is required.
- Signed-in user must be the organisation account that owns the organisation.
- Returns organisation-scoped events.
- Includes `ticketTypes`.

### `POST /api/events`

Creates an event and ticket types.

Rules:

- Auth required.
- Organisation account required.
- Signed-in organisation account must own the submitted `organisationId`.
- `startTime` must be before `endTime`.
- Ticket prices are integer cents.
- Ticket quantities must be greater than zero.

### `GET /api/events/[eventId]`

Fetches a dashboard event.

Rules:

- Auth required.
- Signed-in organisation account must own the event organisation.

### `PATCH /api/events/[eventId]`

Updates event fields and synchronises ticket types.

Rules:

- Auth required.
- Organisation account required.
- Does not own publish/unpublish status transitions.
- Request must include `organisationId`, but the API revalidates organisation ownership and scopes the event server-side.
- Existing ticket types are matched by `id`.
- New ticket types omit `id`.
- Omitted unsold ticket types are deleted.
- Ticket types with existing orders or issued tickets cannot be deleted, but their name, price, and quantity can be edited for future purchases.
- Ticket quantity may be `0` on update because sold-out inventory is valid.
- Ticket quantity must not be negative.

Expected request shape:

```json
{
  "organisationId": "organisation_id",
  "title": "Event title",
  "description": "Event description",
  "startTime": "2026-05-06T15:00:00.000Z",
  "endTime": "2026-05-06T17:00:00.000Z",
  "location": "Campus Hall",
  "ticketTypes": [
    {
      "id": "existing_ticket_type_id",
      "name": "General Admission",
      "price": 1000,
      "quantity": 0
    },
    {
      "name": "New Ticket",
      "price": 1500,
      "quantity": 20
    }
  ]
}
```

Response:

```json
{
  "event": {
    "id": "event_id",
    "organisationId": "organisation_id",
    "title": "Event title",
    "ticketTypes": []
  }
}
```

### `DELETE /api/events/[eventId]`

Deletes an event when permitted by the route handler rules.

### `PATCH /api/events/[eventId]/publish`

Toggles draft/published status.

Rules:

- Auth required.
- Event-management role required.
- Publishing requires at least one ticket type and positive total quantity.
- Unpublishing is blocked after orders exist.

### `POST /api/events/[eventId]/ticket-types`

Creates a ticket type for an event.

Rules:

- Auth required.
- Event-management role required.
- Price must be non-negative integer cents.
- Quantity must be greater than zero.

### `GET /api/events/[eventId]/tickets`

Lists issued tickets for one organiser-owned event with cursor pagination.

Rules:

- Auth required.
- Organisation account required.
- Event-management access required for the current organisation.
- The event must belong to the organisation owned by `session.user`.
- Access is resolved server-side; the frontend does not provide trusted organisation ownership.
- Returns actual `Ticket` rows only.
- Default page size is 25.
- Maximum page size is 100.
- Ordering is stable by `Ticket.createdAt ASC, Ticket.id ASC`.

Query params:

- `limit`: optional integer from 1 to 100.
- `cursor`: optional opaque cursor returned by `pageInfo.nextCursor` or `pageInfo.previousCursor`.
- `direction`: optional, either `next` or `prev`; defaults to `next`.

Response:

```json
{
  "event": {
    "id": "event_id",
    "title": "Event title"
  },
  "tickets": [
    {
      "id": "ticket_id",
      "status": "unused",
      "createdAt": "2026-05-03T10:00:00.000Z",
      "checkedInAt": null,
      "ticketTypeName": "General Admission",
      "orderId": "order_id",
      "buyerEmail": "buyer@example.com",
      "buyerName": "Buyer Name"
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  },
  "counts": {
    "total": 1,
    "unused": 1,
    "checkedIn": 0
  }
}
```

Status:

- `401` unauthenticated.
- `403` non-organisation account.
- `400` malformed `limit`, `cursor`, or `direction`.
- `404` event missing or not owned by the current organisation.

## Tickets

### `POST /api/tickets/[ticketId]/check-in`

Marks one issued ticket as checked in.

Rules:

- Auth required.
- Organisation account required.
- Event-management access required for the current organisation.
- Ticket must belong to an event owned by the organisation account.
- Only `Ticket.checkedInAt` is updated.
- Already checked-in tickets are rejected and the original timestamp is preserved.
- Does not modify order status, Stripe state, ticket ownership, or ticket type data.

Success response:

```json
{
  "ticket": {
    "id": "ticket_id",
    "status": "checked-in",
    "checkedInAt": "2026-05-03T10:05:00.000Z"
  }
}
```

Status:

- `401` unauthenticated.
- `403` non-organisation account.
- `404` ticket missing or not owned by the current organisation.
- `409` ticket is already checked in.

### `POST /api/tickets/[ticketId]/check-out`

Reverses check-in for one issued ticket.

Rules:

- Auth required.
- Organisation account required.
- Event-management access required for the current organisation.
- Ticket must belong to an event owned by the organisation account.
- Only `Ticket.checkedInAt` is updated.
- Only checked-in tickets can be checked out.
- Does not modify order status, Stripe state, ticket ownership, or ticket type data.

Success response:

```json
{
  "ticket": {
    "id": "ticket_id",
    "status": "unused",
    "checkedInAt": null
  }
}
```

Status:

- `401` unauthenticated.
- `403` non-organisation account.
- `404` ticket missing or not owned by the current organisation.
- `409` ticket is already unused.

## Orders

### `GET /api/orders?status=...&eventId=...&includeSystem=...&search=...&startDate=...&endDate=...&limit=...&cursor=...&direction=...`

Returns a bounded page of organisation-scoped orders grouped by event.

Rules:

- Auth required.
- Organisation account required.
- Finance access required.
- Runs stale pending order cleanup for the organisation before returning grouped orders.
- Normal `status` values are `all`, `paid`, `expired`, or `failed`.
- `pending` is an internal system status and is accepted only when `includeSystem=true`.
- Default `all` excludes `pending`.
- `eventId` is optional.
- When `eventId` is present, the API verifies the event belongs to the signed-in organisation account before filtering.
- Returned orders are authorised through `Order.event.organisationId`; `Order.organisationId` is denormalized storage and is not the access source of truth.
- `search` filters buyer email.
- `startDate` and `endDate` filter by order `createdAt`.
- Pagination is cursor-based using stable `(createdAt, id)` ordering.
- `limit` defaults to `25` and must be between `1` and `100`.
- `direction` is `next` or `prev`.
- Invalid pagination params return structured `400`.
- Groups are page-local; they do not imply complete event totals across all matching orders.
- Member accounts cannot access this endpoint.

Response:

```json
{
  "groups": [
    {
      "eventId": "event_id",
      "eventTitle": "Event title",
      "orders": [
        {
          "id": "order_id",
          "status": "paid",
          "ticketType": "General Admission",
          "quantity": 2,
          "totalAmount": 2400,
          "createdAt": "2026-04-29T10:00:00.000Z",
          "paidAt": "2026-04-29T10:05:00.000Z",
          "failedAt": null,
          "failureReason": null,
          "buyerEmail": "buyer@example.com"
        }
      ]
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  }
}
```

### `GET /api/orders/[orderId]`

Returns a safe organiser order detail payload.

Rules:

- Auth required.
- Organisation account required.
- Finance access required.
- The order must belong to an event owned by the current organisation account.
- Ownership is checked through `Order.event.organisationId`.
- Pending orders are not exposed through normal organiser UI.
- Unit price and total amount come from the order snapshot, not the current ticket type price.

Includes:

- order id, status, createdAt, paidAt, failedAt, failureReason
- compensation-review fields when paid local fulfilment failed
- buyer email and name when available
- event id/title
- ticket line with ticket type name, quantity, unit price, and total amount
- issued ticket ids
- Stripe session id
- manual refund and ticket email tracking fields

### `PATCH /api/orders/[orderId]/refund-manual`

Sets the local manual refund flag on an organiser-owned order.

Rules:

- Auth required.
- Organisation account required.
- Finance access required.
- The order must belong to an event owned by the current organisation account.
- This is internal bookkeeping only.
- Does not call Stripe.
- Does not change Stripe payment state.
- Does not change order `status`.

### `POST /api/orders/[orderId]/resend`

Queues ticket delivery email again for a paid organiser-owned order.

Rules:

- Auth required.
- Organisation account required.
- Finance access required.
- The order must belong to an event owned by the current organisation account.
- Order must be `paid`.
- Queues a manual `EmailOutbox` job even when `ticketEmailSentAt` is already set.
- Returns queued semantics; provider delivery runs from the outbox worker.
- On worker success, updates `Order.ticketEmailResentAt` and clears `Order.ticketEmailLastError`.
- On worker failure, updates `Order.ticketEmailLastError`.
- Does not modify order payment state, Stripe state, ticket ownership, or ticket check-in state.

Status:

- `400` unpaid order.
- `401` unauthenticated.
- `403` non-organisation account.
- `404` order missing or not owned by the current organisation.

## Payments

### `POST /api/payments/checkout/event`

Creates a Stripe Checkout Session for a ticket purchase.

Request:

```json
{
  "eventId": "event_id",
  "ticketTypeId": "ticket_type_id",
  "quantity": 1
}
```

Rules:

- Auth required.
- Member account required.
- Event must be published.
- Ticket type must belong to event.
- Organisation is resolved server-side from the event.
- Organisation must be Stripe-ready.
- Creates a local pending `Order`.
- Creates an active `TicketReservation` after checkout preconditions pass.
- Uses 30-minute reservation expiry and sets Stripe Checkout `expires_at` to match.
- Sets success URL to `/success?session_id={CHECKOUT_SESSION_ID}` for dev fallback diagnostics.
- Validates availability as `TicketType.quantity - activeReservedQuantity`.

### `POST /api/payments/webhook`

Stripe Checkout webhook.

Handles:

- `checkout.session.completed`
- `checkout.session.expired`

Responsibilities:

- Verify signature.
- Use the raw request body from `request.text()`.
- Reconcile against local order.
- Reduce inventory.
- Confirm or release the related reservation.
- Create tickets.
- Mark order paid.
- Store `paidAt` on success.
- Persist compensation-review state when Stripe confirms payment but local ticket fulfilment cannot complete.
- Enqueue automatic ticket delivery email only after successful payment fulfilment and ticket issuance.
- Store `ticketEmailSentAt` after automatic outbox worker success.
- Store `ticketEmailLastError` on worker failure.
- Do not enqueue duplicate automatic email jobs on duplicate webhook delivery.
- Mark normal reservation or Checkout expiry as `expired` without `failureReason`.
- Store `failedAt` and `failureReason` only on unexpected reconciliation failure.
- Do not issue tickets or send ticket email for compensation-required orders.
- Return `200` for signed but unhandled Stripe event types.

Email delivery enqueue/worker failure is non-blocking and must not roll back payment, inventory, reservation confirmation, or ticket issuance.

## Server-Rendered Order Views

### `GET /tickets`

Buyer-facing authenticated page.

Rules:

- Auth required.
- Reads orders by `session.user.id`.
- Shows paid orders only.
- Pending, expired, and failed orders are internal/system history and are not shown in the member ticket wallet.
- Shows ticket identifiers when tickets exist.
- Cursor-paginated using stable `(createdAt, id)` ordering.
- `limit` defaults to `25` and must be between `1` and `100`.
- `cursor` is an opaque value from the Previous/Next links.
- `direction` is `next` or `prev`.
- Invalid pagination params render the first page with a visible non-blocking warning.

### `GET /dashboard/orders`

Organiser-facing authenticated dashboard page.

Rules:

- Auth required.
- Organisation account required.
- Finance access required.
- Reads orders scoped through events owned by the current organisation account.
- Supports optional `eventId` and status filtering.
- Default view excludes internal pending orders.
- `Show system orders` exposes pending orders for debugging.
- Shows event-scoped order headers when filtered by event.

Legacy `/dashboard/[orgSlug]/orders` redirects to `/dashboard/orders` when the signed-in organisation account owns the slug.

## Stripe Connect

### `POST /api/stripe/connect/onboard`

Creates or reuses a Stripe Express account and returns an onboarding link.

Rules:

- Auth required.
- Organisation account required.
- Signed-in organisation account must own the submitted `organisationId`.
- Organisation is resolved server-side from `organisationId`.
- Existing `stripeAccountId` is reused and a fresh onboarding link is generated.
- Returns structured Stripe errors instead of a generic 500.
- Detects incomplete Stripe platform setup and returns `PLATFORM_NOT_READY` instead of raw Stripe text.

Response:

```json
{
  "url": "https://connect.stripe.com/setup/..."
}
```

Platform-not-ready response:

```json
{
  "state": "PLATFORM_NOT_READY",
  "message": "Stripe platform setup incomplete",
  "actionRequired": "Complete Stripe Connect platform profile",
  "actionUrl": "https://dashboard.stripe.com/settings/connect/platform-profile"
}
```

Status:

- `200` with `{ "url": "..." }` when onboarding can continue.
- `409` with `PLATFORM_NOT_READY` payload when Stripe blocks account creation because platform setup/profile is incomplete.

### `GET /api/stripe/connect/status?organisationId=...`

Retrieves and persists connected account status.

Rules:

- Auth required.
- Organisation account ownership required.
- Calls `stripe.accounts.retrieve`.
- Updates organisation Stripe flags.
- Maps Stripe account fields into a Thunderstrux lifecycle state.

Lifecycle states:

- `NOT_CONNECTED`: no `stripeAccountId`.
- `PLATFORM_NOT_READY`: Stripe platform profile is incomplete and Express account creation is blocked.
- `CONNECTED_INCOMPLETE`: account exists but `details_submitted` is false.
- `RESTRICTED`: details submitted but `charges_enabled` is false.
- `READY`: `charges_enabled` is true.
- `ERROR`: Stripe API failure or account mismatch.

Persists:

- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `stripeAccountStatus`

### `POST /api/stripe/connect/continue`

Creates a fresh onboarding link for an existing connected account.

Rules:

- Auth required.
- Organisation account ownership required.
- Organisation must already have `stripeAccountId`.

### `POST /api/stripe/connect/disconnect`

Disconnects the Stripe account locally.

Rules:

- Auth required.
- Organisation account ownership required.
- Clears local Stripe fields on the organisation.
- Does not delete or modify the account inside Stripe.
- Also clears `PLATFORM_NOT_READY` back to `NOT_CONNECTED`.

Response:

```json
{
  "disconnected": true,
  "status": {
    "state": "NOT_CONNECTED",
    "connected": false,
    "ready": false
  }
}
```

### `POST /api/stripe/connect/webhook`

Stripe Connect webhook.

Handles:

- `account.updated`

Responsibilities:

- Verify signature.
- Persist account status flags on the matching organisation.
