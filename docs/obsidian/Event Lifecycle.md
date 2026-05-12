# Event Lifecycle

## Statuses

Events use:

- `draft`
- `published`

Draft events are visible only in the organisation dashboard. Published events can appear on public discovery and public event detail pages.

## Creation Flow

Current route:

```text
/dashboard/events/new
```

Legacy compatibility route:

```text
/dashboard/[orgSlug]/events/new
```

Main files:

- `app/(dashboard)/dashboard/events/new/page.tsx`
- `app/(dashboard)/dashboard/events/layout.tsx`
- `components/events/create-event-form.tsx`
- `app/api/events/route.ts`

Flow:

```text
Organisation account opens /dashboard/events/new
  -> route resolves current organisation from Organisation.accountUserId
  -> CreateEventForm resolves the organisation by slug for existing API compatibility
  -> POST /api/events
  -> API validates organisation account ownership and event-management access
  -> API creates Event and TicketType rows
```

Access:

- Organisation account required.
- The signed-in organisation account must own the submitted `organisationId`.
- Member accounts cannot create events.

## Ticket Types

Ticket types belong to events.

Rules:

- `price` is integer cents.
- `price` must be non-negative.
- `quantity` must be greater than zero when creating.
- `quantity` may be zero when editing because sold-out inventory is represented as `0`.
- Public checkout validates requested quantity against remaining inventory minus active reservations.
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

- Organisation account.
- Event-management access to the event organisation.
- At least one ticket type.
- Total ticket quantity greater than zero.

Unpublishing is blocked once orders exist.

## Edit Boundary

General event editing uses:

```text
PATCH /api/events/[eventId]
```

The edit endpoint updates event fields and synchronises ticket types. It does not own the publish/unpublish lifecycle.

Current edit route:

```text
/dashboard/events/[eventId]/edit
```

Legacy compatibility route:

```text
/dashboard/[orgSlug]/events/[eventId]/edit
```

Source files:

```text
app/(dashboard)/dashboard/events/layout.tsx
app/(dashboard)/dashboard/events/[eventId]/edit/page.tsx
app/(dashboard)/dashboard/[orgSlug]/events/layout.tsx
app/(dashboard)/dashboard/[orgSlug]/events/[eventId]/edit/page.tsx
components/events/create-event-form.tsx
app/api/events/[eventId]/route.ts
lib/validators/events.ts
```

Important rules:

- Existing ticket rows are matched by `id`, not by name.
- Submitted existing IDs must belong to the edited event.
- Omitted unsold ticket types are deleted.
- New ticket types have no `id` and are created.
- Ticket types with existing orders or issued tickets cannot be deleted.
- Ticket types with existing orders or issued tickets can still have `name`, `price`, and `quantity` edited for future purchases.
- Existing orders keep their historical `unitPrice` and `totalAmount`; old orders are not recalculated when a ticket type price changes.
- Existing tickets remain linked to the same `ticketTypeId`.
- Sold-out ticket types with `quantity = 0` can be edited back to a positive quantity to reopen future availability.
- The edit form only disables removal for sold/issued ticket rows. Event fields and ticket name/price/quantity stay editable.

## Public Event APIs

Public APIs:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

Rules:

- Return only `published` events.
- Do not require auth.
- Do not support dashboard previews.
- Public event reads are read-only and do not create demo data or run stale pending order cleanup.
- If no published events exist, `GET /api/public/events` returns an empty list.

## Organiser Event View

Current route:

```text
/dashboard/events/[eventId]
```

Rules:

- Organisation account required.
- The event must belong to the signed-in organisation account.
- Member accounts are redirected to `/`.
- Draft and published events can be viewed by the owning organisation account.
- The route shows event details, remaining tickets, sold tickets, and revenue.
- Sold and revenue values are derived from paid orders.
- The UI does not show total capacity because original capacity is not stored.

Public route behavior:

```text
/events/[eventId]
```

- Members and logged-out users use the public buyer-facing event page.
- Organisation accounts are redirected to `/dashboard/events/[eventId]`.

## Public Demo Events

Demo public events are created by `prisma/seed.mjs`.

The public event runtime does not auto-create demo events. The seed is the preferred way to restore a full development database because it also creates users, organisation accounts, member accounts, memberships, orders, and tickets.
