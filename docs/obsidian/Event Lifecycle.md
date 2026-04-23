# Event Lifecycle

## Statuses

Events use:

- `draft`
- `published`

Draft events are visible only in the organisation dashboard. Published events can appear on public discovery and public event detail pages.

## Creation Flow

Route:

```text
/dashboard/[orgSlug]/events/new
```

Main files:

- `app/(dashboard)/dashboard/[orgSlug]/events/new/page.tsx`
- `components/events/create-event-form.tsx`
- `app/api/events/route.ts`

Flow:

```text
Create event form
  -> resolves organisation by slug
  -> POST /api/events
  -> API validates authenticated membership and role
  -> API creates Event and TicketType rows
```

Allowed roles:

- `org_owner`
- `org_admin`
- `event_manager`

## Ticket Types

Ticket types belong to events.

Rules:

- `price` is integer cents.
- `price` must be non-negative.
- `quantity` must be greater than zero when creating.
- Public checkout validates requested quantity against remaining inventory.
- Webhook fulfilment reduces inventory after payment is confirmed.

## Publish And Unpublish

Dashboard controls live in:

```text
components/events/events-list.tsx
```

Status changes call:

```text
PATCH /api/events/[eventId]/publish
```

Publishing requires:

- Authenticated user.
- Event-management role in the event organisation.
- At least one ticket type.
- Total ticket quantity greater than zero.

Unpublishing is blocked once orders exist.

## Edit Boundary

General event editing uses:

```text
PATCH /api/events/[eventId]
```

The edit endpoint updates event fields and synchronises ticket types. It does not own the publish/unpublish lifecycle.

## Public Event APIs

Public APIs:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

Rules:

- Return only `published` events.
- Do not require auth.
- Do not support dashboard previews.

## Public Demo Event Loader

`lib/events/public-events.ts` ensures public discovery has demo events if there are no published events.

This is separate from `prisma/seed.mjs`. The seed is the preferred way to restore a full development database because it also creates users and memberships.

