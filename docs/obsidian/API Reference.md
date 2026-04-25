# API Reference

This is a concise reference for implemented API routes. Security and data-model rules are documented in [[Database and Multi Tenancy]].

## Public Events

### `GET /api/public/events`

Returns published events for public discovery.

Rules:

- No auth required.
- Only `published` events are returned.
- Response is public-safe.

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
  ]
}
```

### `GET /api/public/events/[eventId]`

Returns public event details.

Rules:

- No auth required.
- Event must be `published`.
- Includes ticket types.

## Organisations

### `GET /api/orgs`

Returns organisations where the authenticated user is a member.

Rules:

- Auth required.
- Uses `session.user.id`.
- Does not trust frontend organisation headers.

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
- Slug is normalised server-side.
- Slug uniqueness is enforced.
- Creator becomes `org_owner`.

### `GET /api/orgs/[orgSlug]`

Fetches an organisation by slug.

Rules:

- Auth required.
- Signed-in user must be an organisation member.

## Events

### `GET /api/events?orgId=...`

Lists events for one organisation.

Rules:

- Auth required.
- `orgId` is required.
- Signed-in user must be a member.
- Returns organisation-scoped events.
- Includes `ticketTypes`.

### `POST /api/events`

Creates an event and ticket types.

Allowed roles:

- `org_owner`
- `org_admin`
- `event_manager`

Rules:

- Auth required.
- `startTime` must be before `endTime`.
- Ticket prices are integer cents.
- Ticket quantities must be greater than zero.

### `GET /api/events/[eventId]`

Fetches a dashboard event.

Rules:

- Auth required.
- Signed-in user must have access to the event organisation.

### `PATCH /api/events/[eventId]`

Updates event fields and synchronises ticket types.

Rules:

- Auth required.
- Event-management role required.
- Does not own publish/unpublish status transitions.

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
- Event must be published.
- Ticket type must belong to event.
- Organisation is resolved server-side from the event.
- Organisation must be Stripe-ready.
- Creates a local pending `Order`.

### `POST /api/payments/webhook`

Stripe Checkout webhook.

Handles:

- `checkout.session.completed`
- `checkout.session.expired`

Responsibilities:

- Verify signature.
- Reconcile against local order.
- Reduce inventory.
- Create tickets.
- Mark order paid.
- Store `paidAt` on success.
- Store `failedAt` and `failureReason` on reconciliation failure.

## Server-Rendered Order Views

### `GET /tickets`

Buyer-facing authenticated page.

Rules:

- Auth required.
- Reads orders by `session.user.id`.
- Shows paid, pending, and failed orders.
- Shows ticket identifiers when tickets exist.

### `GET /dashboard/[orgSlug]/orders`

Organiser-facing authenticated dashboard page.

Rules:

- Auth required.
- Organisation membership required.
- Finance access required.
- Reads orders scoped to the resolved organisation id.

## Stripe Connect

### `POST /api/stripe/connect/onboard`

Creates or reuses a Stripe Express account and returns an onboarding link.

Allowed roles:

- `org_owner`
- `finance_manager`

Rules:

- Auth required.
- User must have Stripe Connect access through organisation membership.
- Organisation is resolved server-side from `organisationId`.
- Existing `stripeAccountId` is reused and a fresh onboarding link is generated.
- Returns structured Stripe errors instead of a generic 500.

Response:

```json
{
  "url": "https://connect.stripe.com/setup/..."
}
```

### `GET /api/stripe/connect/status?organisationId=...`

Retrieves and persists connected account status.

Rules:

- Auth required.
- Organisation membership required.
- Calls `stripe.accounts.retrieve`.
- Updates organisation Stripe flags.
- Maps Stripe account fields into a Thunderstrux lifecycle state.

Lifecycle states:

- `NOT_CONNECTED`: no `stripeAccountId`.
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

Allowed roles:

- `org_owner`
- `finance_manager`

Rules:

- Auth required.
- User must have Stripe Connect access.
- Organisation must already have `stripeAccountId`.

### `POST /api/stripe/connect/disconnect`

Disconnects the Stripe account locally.

Allowed roles:

- `org_owner`
- `finance_manager`

Rules:

- Auth required.
- User must have Stripe Connect access.
- Clears local Stripe fields on the organisation.
- Does not delete or modify the account inside Stripe.

### `POST /api/stripe/connect/webhook`

Stripe Connect webhook.

Handles:

- `account.updated`

Responsibilities:

- Verify signature.
- Persist account status flags on the matching organisation.
