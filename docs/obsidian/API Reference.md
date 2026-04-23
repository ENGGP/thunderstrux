# API Reference

## Public Events

### `GET /api/public/events`

Returns all published events for public discovery.

Response shape:

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

Rules:

- No auth required
- No `x-org-id` required
- Only published events are returned
- If no published events exist, the shared public event loader creates two idempotent MVP demo events with ticket types

### `GET /api/public/events/[eventId]`

Returns public-safe event detail data.

Response shape:

```json
{
  "event": {
    "id": "event_id",
    "title": "Event title",
    "description": "Details",
    "startTime": "2026-04-23T10:00:00.000Z",
    "endTime": "2026-04-23T12:00:00.000Z",
    "location": "Campus hall",
    "organisation": {
      "name": "Society name",
      "slug": "society-name"
    },
    "ticketTypes": [
      {
        "id": "ticket_type_id",
        "name": "General admission",
        "price": 1000,
        "quantity": 50
      }
    ]
  }
}
```

Rules:

- No auth required
- Only returns events where `status = published`
- Does not expose internal organisation IDs

## Organisations

### `GET /api/orgs`

Returns organisations where the authenticated user is a member.

Rules:

- Auth required
- Uses `session.user.id`
- Does not trust frontend organisation headers

### `POST /api/orgs`

Creates an organisation.

Request:

```json
{
  "name": "Engineering Society"
}
```

Response shape:

```json
{
  "organisation": {
    "id": "organisation_id",
    "name": "Engineering Society",
    "slug": "engineering-society",
    "createdAt": "2026-04-23T10:00:00.000Z"
  }
}
```

Notes:

- Slug is normalised server-side
- Slug uniqueness is enforced
- Auth required
- Creator is added as `org_owner`
- Used by `/dashboard/create` after a newly signed-in user has no organisations

### `GET /api/orgs/[orgSlug]`

Fetches an organisation by slug.

Used by dashboard pages and some client helpers.

Rules:

- Auth required
- User must be an `OrganisationMember`

## Events

### `GET /api/events?orgId=...`

Lists events for a specific organisation.

Rules:

- `orgId` query param is required
- Auth required
- Signed-in user must be an organisation member
- Returns organisation-scoped events only

Current response includes ticket types for each event:

```json
{
  "events": [
    {
      "id": "event_id",
      "organisationId": "organisation_id",
      "title": "Event title",
      "description": "Event details",
      "startTime": "2026-04-23T10:00:00.000Z",
      "endTime": "2026-04-23T12:00:00.000Z",
      "location": "Campus hall",
      "status": "published",
      "createdAt": "2026-04-22T10:00:00.000Z",
      "ticketTypes": [
        {
          "id": "ticket_type_id",
          "name": "General admission",
          "price": 1000,
          "quantity": 50
        }
      ]
    }
  ]
}
```

The dashboard frontend still treats `ticketTypes` as optional defensively.

### `POST /api/events`

Creates an event.

Allowed roles:

- `org_owner`
- `org_admin`
- `event_manager`

Request includes:

- `organisationId`
- `title`
- `description`
- `startTime`
- `endTime`
- `location`
- `ticketTypes`

Rules:

- Auth required
- Signed-in user must have an event-management role in the organisation
- `startTime` must be before `endTime`
- Ticket type price must be non-negative integer cents
- Ticket type quantity must be greater than zero

### `POST /api/events/[eventId]/ticket-types`

Creates a ticket type for an event.

Rules:

- Auth required
- Signed-in user must have an event-management role in the organisation
- Event must belong to the provided organisation
- Price must be non-negative integer cents
- Quantity must be greater than zero

## Payments

### `POST /api/payments/checkout/event`

Starts Stripe Checkout for a ticket purchase.

Request:

```json
{
  "eventId": "event_id",
  "ticketTypeId": "ticket_type_id",
  "quantity": 1
}
```

Rules:

- Event must exist
- Event must be published
- Ticket type must belong to event
- Quantity must be valid
- Organisation must have a ready Stripe Connect account
- Server resolves `organisationId` from the event
- Server creates a pending `Order`

Response:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### `POST /api/payments/webhook`

Stripe Checkout webhook.

Handles:

- `checkout.session.completed`

Responsibilities:

- Verify Stripe signature
- Reconcile session metadata and amount against local order
- Atomically claim pending order
- Reduce inventory
- Create tickets
- Mark order paid

Frontend success redirects are not trusted.

## Stripe Connect

### `POST /api/stripe/connect/onboard`

Creates a Stripe Express account and returns an onboarding link.

Allowed roles:

- `org_owner`
- `finance_manager`

Rules:

- Auth required
- Signed-in user must have Stripe Connect access for the organisation
- Organisation must exist
- Onboarding cannot be triggered twice if `stripeAccountId` already exists

### `GET /api/stripe/connect/status?organisationId=...`

Retrieves and persists connected account status.

Persists:

- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`

Rules:

- Auth required
- Signed-in user must be an organisation member

### `POST /api/stripe/connect/webhook`

Stripe Connect webhook.

Handles:

- `account.updated`

Responsibilities:

- Verify Connect webhook signature
- Persist account capability/status flags on the matching organisation
