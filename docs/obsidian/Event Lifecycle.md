# Event Lifecycle

## Statuses

Events use two statuses:

- `draft`
- `published`

Draft events are organisation-internal. Published events are public-safe and can appear in public discovery and public event detail pages.

## Dashboard Controls

Dashboard event status is controlled from:

- `components/events/events-list.tsx`

The dashboard shows:

- Colour-coded `Draft` and `Published` badges
- `Publish` for draft events
- `Unpublish` for published events
- `View Event` only for published events

Draft events do not link to the public event page because public APIs intentionally return only published events.

## Publish API

Endpoint:

```text
PATCH /api/events/[eventId]/publish
```

Allowed roles are the normal event-management roles:

- `org_owner`
- `org_admin`
- `event_manager`

Behaviour:

- If the event is `draft`, the endpoint attempts to publish it.
- If the event is `published`, the endpoint attempts to unpublish it.

## Publish Validation

A draft event can only be published when:

- The signed-in user has event-management access to the event's organisation
- The event has at least one ticket type
- Total ticket quantity across ticket types is greater than zero

If validation fails, the endpoint returns a `BAD_REQUEST` response with a clear message.

## Unpublish Validation

A published event cannot be unpublished after orders exist.

This keeps purchased event links and order history stable.

## Edit Form Boundary

The event edit form does not directly control `status`.

Normal event editing uses:

```text
PATCH /api/events/[eventId]
```

That endpoint updates event fields and synchronises ticket types, but status transitions are handled only by:

```text
PATCH /api/events/[eventId]/publish
```

## Public API Boundary

Public APIs continue to expose only published events:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

This behaviour must not be changed to support dashboard previews.
