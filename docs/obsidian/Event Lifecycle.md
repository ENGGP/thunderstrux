---
status: living
last-reviewed: 2026-10-15
owner: engineering
related: ["[[API Reference]]", "[[Ticket Check-in Implementation]]"]
sources: [lib/events/event-lifecycle.ts, app/api/events]
---

# Event Lifecycle

## Statuses

Events use:

- `draft`
- `published`

Draft events are visible only in the organisation dashboard. Published events can appear on public discovery and public event detail pages.

Since T11 publication is one of several independent settings on an event:

- `visibility`: `public` events are listed; `unlisted` events open by direct link only; `members_only` is reserved for memberships (T24) and cannot be set yet.
- Sales: `saleState` (`open` or `closed`) plus `salesCloseAt`, which defaults to the start time. Tickets can be bought only while the event is published, sales are open and the close time is in the future. Closing sales does not unpublish.
- `capacity`: an optional event-wide ceiling, separate from each ticket type's remaining quantity. It cannot be set below valid issued tickets plus active holds. Existing events have none.
- `version`: increases on every edit, publication or sales change; a stale editor or action gets `409` instead of overwriting.

`lib/events/event-readiness.ts` is the only place that decides whether an event can be published and which ticket types can be bought. The publish API, the dashboard's disabled-Publish reason and checkout all use it.

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
- `lib/events/event-lifecycle.ts`

Flow:

```text
Authorised management user opens /dashboard/events/new
  -> route resolves the canonical organisation from live staff authority or the configured legacy fallback
  -> CreateEventForm resolves the organisation by slug for existing API compatibility
  -> POST /api/events
  -> API validates live event-management access for the canonical organisation
  -> event lifecycle service creates Event and TicketType rows
```

Access:

- Active staff authority or explicitly enabled legacy authority is required.
- The submitted `organisationId` must match the server-resolved canonical organisation.
- Members without live staff authority cannot create events; named staff with events:manage can, regardless of accountRole.

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
components/events/event-actions.tsx
```

They appear on each row of `/dashboard/events` and in the event workspace header. Unpublish and Delete ask for confirmation, and a disabled action shows why (no ticket types, orders exist). The reasons come from `getDashboardEvent` and `listDashboardEvents`; the routes below still enforce the rules.

Status changes call:

```text
PATCH /api/events/[eventId]/publish
```

Status changes send an explicit target and the version the page loaded: `{ targetStatus, version }`. Repeating a request for the current status is a no-op. Publishing requires:

- Live events:manage authority (active staff or explicitly allowed legacy owner) for the event organisation.
- Title, description and location, and an end after the start.
- A sales close time in the future and not after the end.
- At least one ticket type with remaining quantity, and at least one type that can be bought now: a free type, or a paid type once the society can take payments.

Events are always created as drafts, so a direct API call cannot skip these checks (EVT-003). Unpublishing is blocked once orders exist. `PATCH /api/events/[eventId]/sales` closes and reopens sales separately.

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
lib/events/event-lifecycle.ts
```

The event API routes and edit page call the same organisation-scoped lifecycle service. Routes retain request validation, authentication, permission checks, tenant mismatch handling, and HTTP responses. The service owns event/ticket-type persistence and the edit transaction.

Important rules:

- Existing ticket rows are matched by `id`, not by name.
- Submitted existing IDs must belong to the edited event.
- Omitted unsold ticket types are deleted.
- New ticket types have no `id` and are created.
- Ticket types with existing orders or issued tickets cannot be deleted.
- Ticket types with existing orders or issued tickets can still have `name`, `price`, and `quantity` edited for future purchases.
- Existing orders keep their historical `unitPrice` and `totalAmount`, and since T10 their purchased ticket type name and seller; old orders are not recalculated when a ticket type is renamed or repriced.
- Existing tickets remain linked to the same `ticketTypeId`.
- Sold-out ticket types with `quantity = 0` can be edited back to a positive quantity to reopen future availability.
- The edit form only disables removal for sold/issued ticket rows. Event fields and ticket name/price/quantity stay editable.

## Public Event APIs

Public APIs:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

Rules:

- Return only `published` events. Lists show only `public` events; detail also opens `unlisted` ones; `members_only` events are never returned.
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

- Live analytics:read authority and staff MFA are required for the organiser analytics route.
- The event must belong to the caller's server-resolved canonical organisation.
- Users without analytics:read are denied/redirected by the management-page helper; foreign events are concealed. Check-in staff use published event/attendance views rather than analytics.
- Draft and published events can be viewed by management users with live access to the owning organisation.
- The route shows event details and remaining/sold counts. Financial DTO fields and revenue-series queries/rendering require orders:read; event managers receive nonfinancial analytics.
- Sold and revenue values are derived from paid orders.
- The UI does not show total capacity because original capacity is not stored.

Public route behavior:

```text
/events/[eventId]
```

- Authenticated members use the buyer-facing event page; anonymous HTML requests currently redirect to login. The event API/listing is anonymous; T15 owns full anonymous detail.
- Organisation accounts are redirected to `/dashboard/events/[eventId]`.

## Public Demo Events

Demo public events are created by `prisma/seed.mjs`.

The public event runtime does not auto-create demo events. The seed is the preferred way to restore a full development database because it also creates users, organisation accounts, member accounts, memberships, orders, and tickets.

Seed is synthetic development setup, not restoration of real history. T08 public society profiles display up to 50 upcoming published events in the society timezone; this does not change existing checkout, event validity or organiser date behavior. [[Society Profiles and Assets]] and [[Seeding and Data]] distinguish these boundaries.
