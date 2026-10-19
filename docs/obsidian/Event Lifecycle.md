---
status: living
last-reviewed: 2026-10-25
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

- `visibility`: `public` events are listed; `unlisted` events open by direct link only; `members_only` events (T24b2) are never listed and open only to members whose membership unlocks them; anyone else gets the members-only gate. Publishing one needs a published plan that unlocks members-only events. See [[Memberships and Merchandise]].
- Sales: `saleState` (`open` or `closed`) plus `salesCloseAt`, which defaults to the start time. Tickets can be bought only while the event is published, sales are open and the close time is in the future. Closing sales does not unpublish.
- `capacity`: an optional event-wide ceiling, separate from each ticket type's remaining quantity. It cannot be set below valid issued tickets plus active holds. Existing events have none.
- `version`: increases on every edit, publication or sales change; a stale editor or action gets `409` instead of overwriting.

`lib/events/event-readiness.ts` is the only place that decides whether an event can be published and which ticket types can be bought. The publish API, the dashboard's disabled-Publish reason and checkout use it; checkout passes each type's sellable stock from `lib/events/inventory.ts` (T12). T15a makes the public event page read each type's state from it.

Free types are checkout-eligible without payments (T13), so a free-only event publishes without Stripe and a mixed event publishes and sells its free types while its paid types wait for payments. When no type can be bought because every one is sold out or held, the blocker is "Every ticket type is sold out or held in checkouts."

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
  -> the page passes the canonical organisation id and the society time zone to CreateEventForm
  -> POST /api/events
  -> API validates live event-management access for the canonical organisation
  -> event lifecycle service creates Event and TicketType rows
```

Access:

- Active staff authority or explicitly enabled legacy authority is required.
- The submitted `organisationId` must match the server-resolved canonical organisation.
- Members without live staff authority cannot create events; named staff with events:manage can, regardless of accountRole.

### Builder (T11b)

The new and Edit pages share `components/events/create-event-form.tsx`:

- **Times are society wall-clock times.** The form shows and edits `datetime-local` values in `Organisation.timeZone` and sends ISO instants; the browser's own zone is never used. `lib/zoned-time.ts` converts both ways. A time inside a daylight-saving gap is refused ("clocks go forward"); a time inside an overlap shows a choice of the first or second occurrence, and an edit keeps whichever was saved. The Schedule card names the zone, for example "Sydney time (AEDT, UTC+11)".
- **Sales close** shows the start time until it is changed and then sends its own value. The server already treats a close time equal to the start as the default that follows it.
- **Prices are dollars.** The "$" field is parsed to cents without floating point (`parseMoneyInput` in `lib/format.ts`); the API stays in cents. Closes EVT-002.
- **Access** offers Public, Link only (`unlisted`) and Members only (warning while no published plan unlocks members-only events). Capacity is optional and the hint names the tickets already issued or held.
- **Event image.** An optional 16:9 image uploads as an `event` asset (`POST /api/orgs/[slug]/assets?kind=event`, needs events:manage) and previews through the private asset route; the event stores it on save. Replace and Remove change it on the next save.
- Each existing ticket type shows sold (active tickets) and held (live checkout holds); a type with orders or tickets cannot be removed.
- Saving an edit stays on the page and shows "Event saved"; a stale version shows "This event changed since you opened it" and keeps the edits on screen; changed stock after sales shows "Ticket stock changed while you were editing". Unsaved changes are marked and leaving the page asks first.
- A draft's Edit page shows the readiness checklist beside the form.

### Event hero image

`Event.heroAssetId` references `(Asset.id, organisationId)`, so an event can only use an image of its own society. Create and edit lock the Asset row after the Event lock and accept only a ready, undeleted `event` asset ("That image is no longer available. Upload it again, then save."). Every change refreshes `unreferencedAt` on the old and new image, and deleting an event releases its image, so the 24-hour cleanup delay applies as for society images. A referenced image cannot be deleted. Public delivery (`/api/public/assets/[id]`) serves it only while the event is published and not members-only; it shows above the title on the public event page and at the top of event cards. See [[Society Profiles and Assets]].

## Ticket Types

Ticket types belong to events.

Rules:

- `price` is integer cents.
- `price` must be non-negative.
- `memberPrice` (T24b) is optional integer cents, at most `price` (validator and database check). A member account whose running membership in the society carries `member_prices` pays it; everyone else, guests included, pays `price`. See [[Memberships and Merchandise]].
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
- A new start, end or location on an event with active tickets records an `EventChange` in the same transaction (T30); the notification worker emails each valid holder once after a five-minute pause, so a quick correction or undo sends one email or none. Title, description, price and stock edits email nobody. The published-event notice on the edit page says so. See [[Email Delivery Implementation]].

### Inventory locks (T12)

`lib/events/inventory.ts` is the only place that locks an Event and its ticket types or computes sellable stock. Lock order: the buyer's User row on paths that fence it, then the Event, then its ticket types by ascending id, then orders and holds; no path locks an Order and then an Event or ticket type. Checkout, webhook fulfilment, edits and delete take these locks; publish and sales changes are compare-and-set on the event version, which takes the Event row first.

- Sellable stock is `min(remaining - that type's active holds, capacity - occupancy)`, where occupancy is valid issued tickets plus every active hold; without a capacity only the first limit applies.
- An edit cannot set capacity below occupancy, or a type's remaining quantity below its active holds.
- Remaining quantity is decremented by sales, so the edit form sends the quantity it loaded as `expectedQuantity`. If sales moved the stock and the organiser left the field alone, the current stock is kept; if both changed, the save is a 409 and the organiser reloads.
- Checkout compares the buyer's `expectedUnitPrice` with the locked price and refuses a changed price with 409 before creating a hold. Orders are capped at 10 tickets.
- Fulfilment re-checks the capacity ceiling once; an order that would exceed it goes to compensation review instead of issuing tickets.
- Holds count while `status = active` and `expiresAt` is after the transaction's single application-clock reading. The suite drives expiry with fake timers, so the database clock is not used; app and database share the host clock in every supported deployment.

## Public Event APIs

Public APIs:

- `GET /api/public/events`
- `GET /api/public/events/[eventId]`

Rules:

- Return only `published` events. Lists show only `public` events; detail also opens `unlisted` ones; `members_only` events are never returned by the public API. The event page reads through `getEventForViewer`, which opens a members-only event only for a member it is open to (T24b2).
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
- The route shows event details, units and check-ins from `lib/analytics` (T31): tickets sold are issued units on fulfilled orders, checked in is valid checked-in over valid issued. Money (net sales, gross per type, Sales over time) needs `orders:read` as well as `analytics:read`; event managers get the same page without money, decided on the server. Sales over time buckets by day in the society's zone. See [[Analytics and Calendar]].
- The header shows dates in the society time zone, the sales close time and, for a published event, a selling badge: Sales open, Sold out (no remaining stock) or Sales closed.
- The ticket table shows price, sold, held (live checkout holds) and left. When the event has a capacity, a Capacity tile shows issued tickets plus live holds against it.
- A draft shows the readiness checklist ("Ready to publish?"): the five publish checks, each with the shared readiness message and a link to the Edit page field, or to payment setup. A published event shows its selling status instead.
- **More** offers Close sales on a published event with open sales, and Reopen sales when they are closed; reopening is unavailable once the close time has passed ("Move it later on the Edit page first"). Both call `PATCH /api/events/[eventId]/sales` with the loaded version.
- The events list shows the selling badge beside Published, "Link only" after the location of an unlisted event, and start times in the society time zone.

Public route behavior:

```text
/events/[eventId]
```

- Anyone can open a published public or link-only event (T15a); drafts and wrong ids are the standard not-found page. A members-only event shows members it is open to the full page and everyone else the members-only gate, which names only the society (T24b2). Society accounts see the page as buyers do.
- Each ticket type shows its price or Free and its advisory availability from the shared readiness module: N left, Sold out, or "Paid tickets unavailable right now" while the society cannot take payments. Closed sales replace the choices with the close time. The page shows the organiser link and, when set, the society's support email and refund policy.
- The ticket box action depends on the viewer: "Continue as guest" and "Sign in to buy" for a visitor who is not signed in (T16b; signing in comes straight back to the same checkout), "Verify your email to get tickets", "Society accounts can't buy tickets", or "Buy tickets"/"Get free tickets" for a verified member.
- `/dashboard/events/[eventId]/preview` (events:manage) renders the same page for a draft under a "Draft preview" banner with buying off; the workspace header shows Preview only for drafts, and a published event redirects to its public page.

## Public Demo Events

Demo public events are created by `prisma/seed.mjs`.

The public event runtime does not auto-create demo events. The seed is the preferred way to restore a full development database because it also creates users, organisation accounts, member accounts, memberships, orders, and tickets.

Seed is synthetic development setup, not restoration of real history. T08 public society profiles display up to 50 upcoming published events in the society timezone; this does not change existing checkout, event validity or organiser date behavior. [[Society Profiles and Assets]] and [[Seeding and Data]] distinguish these boundaries.
