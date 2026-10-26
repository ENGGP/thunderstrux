---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle]]", "[[API Reference]]", "[[Ticket Check-in Implementation]]", "[[Memberships and Merchandise]]", "[[Society Profiles and Assets]]"]
sources: [lib/events/event-lifecycle.ts, lib/events/event-cancellation.ts, lib/events/event-readiness.ts, lib/events/inventory.ts, lib/events/public-events.ts, lib/events/event-changes.ts, lib/validators/events.ts, components/events/create-event-form.tsx, app/api/events]
---

# Event Lifecycle

**Owns:** event statuses, visibility, sales open and close, capacity and ticket types, the event builder, publish and unpublish, the edit boundary, inventory locks, cancelling an event, delete rules and the public event reads.
**Read when:** changing how events are created, edited, published or sold, what stock means, or who can see an event.
**Not here:** orders, holds and refunds ([[Payment Lifecycle]]); request and response shapes ([[API Reference]]); check-in ([[Ticket Check-in Implementation]]); member prices and members-only access ([[Memberships and Merchandise]]); image delivery ([[Society Profiles and Assets]]); event metrics ([[Analytics and Calendar]]); page guards ([[Frontend and Backend Flow]]).

## Code

| Concern | Where |
| --- | --- |
| Create, edit, publish, sales, delete | `lib/events/event-lifecycle.ts`: `createOrganisationEvent`, `updateOrganisationEvent`, `setOrganisationEventPublication`, `setOrganisationEventSaleState`, `deleteOrganisationEvent` |
| Cancel an event with sales (EVT-004) | `lib/events/event-cancellation.ts`: `cancelOrganisationEvent` |
| Dashboard reads | `lib/events/event-lifecycle.ts`: `listDashboardEvents` (views `upcoming`, `drafts`, `past`, `all`), `getDashboardEvent`, `getOrganisationEventForEditing` |
| Publish readiness and per-type buyability | `lib/events/event-readiness.ts`: `eventReadiness`, `salesOpen` |
| Locks and sellable stock | `lib/events/inventory.ts`: `lockEventInventory`, `readEventInventory`, `sellableQuantity` |
| Public reads | `lib/events/public-events.ts`: `getPublishedEvents`, `getPublishedEventDetail`, `getEventForViewer`, `getBookedEventDetail`, `getEventPreviewDetail`, `priceForViewer` |
| Time and place change notices | `lib/events/event-changes.ts`: `recordEventChange`, `fanOutEventChanges` |
| Validation | `lib/validators/events.ts`: `createEventSchema`, `updateEventSchema`, `eventPublicationSchema`, `eventSaleStateSchema`; prices `lib/validators/price.ts` |
| Error mapping | `lib/events/http.ts`: `eventRouteRules` |
| Routes | `POST /api/events`, `GET /api/events`, `GET`/`PATCH`/`DELETE /api/events/[eventId]`, `PATCH /api/events/[eventId]/publish`, `PATCH /api/events/[eventId]/sales`, `POST /api/events/[eventId]/cancel`, `GET /api/public/events`, `GET /api/public/events/[eventId]` |
| Builder and actions | `components/events/create-event-form.tsx`, `components/events/event-actions.tsx`, `components/events/readiness-checklist.tsx` |
| Pages | `/dashboard/events`, `/dashboard/events/new`, `/dashboard/events/[eventId]`, `/dashboard/events/[eventId]/edit`, `/dashboard/events/[eventId]/preview`, `/events/[eventId]` |
| Tests | `tests/integration/event-lifecycle.test.ts`, `tests/integration/event-policy.test.ts`, `tests/integration/inventory-locks.test.ts`, `tests/integration/event-hero.test.ts`, `tests/integration/dashboard-events.test.ts`, `tests/integration/public-event-pages.test.ts`, `tests/integration/members-only-events.test.ts`, `tests/integration/event-cancellation.test.ts` |

## States

An event has four independent settings ([[Database and Multi Tenancy#Models]]):

| Setting | Values | Meaning |
| --- | --- | --- |
| `status` | `draft`, `published` | Drafts are dashboard-only. Every event is created as a draft. |
| `visibility` | `public`, `unlisted`, `members_only` | Public events are listed; unlisted ("Link only") open by direct link; members-only open only to members whose membership unlocks them. |
| `saleState` + `salesCloseAt` | `open`, `closed` + a time | Tickets sell only while published, `saleState = open` and now is before `salesCloseAt`. Closing sales doesn't unpublish. |
| `capacity` | null or a positive number | Optional event-wide ceiling, separate from each type's remaining `quantity`. |

`cancelledAt` (with `cancellationReason`) marks a published event the society cancelled; it is set once and never cleared. A cancelled event stays `published` so buyers keep its page, but nothing about it can change again.

`version` increases on every edit, publish, unpublish, sales change and cancellation. Each action sends the version it loaded; a stale one is 409 ("This event changed since you opened it"), never an overwrite.

## Rules

### Access

- All event routes need live `events:manage` staff authority and staff MFA ([[Authentication and Dashboard Access]]); mutations also need a trusted origin.
- `POST /api/events` names the society in the body `organisationId`; the route checks authority on it. Edit, publish, sales and delete act on the selected dashboard society; an edit whose body `organisationId` differs is 403. Another society's event is 404.
- Every read and write scopes by `Event.organisationId` ([[Database and Multi Tenancy#Tenant boundary]]).

### Creating

- `createOrganisationEvent` always writes `status = draft`, so a direct API call can't skip publish checks (EVT-003).
- `salesCloseAt` defaults to `startTime`; `visibility` defaults to `public`; `compensationRefundMode` defaults to `automatic_full` (see Compensation below).
- Writes the event, its ticket types and `event.created` in one transaction.

### Validation limits (`lib/validators/events.ts`)

- Title 1 to 180 characters, description up to 5000, location up to 240. End after start. `salesCloseAt` not after the end.
- A draft saves without a description or location, so an organiser can stop half-way; readiness (`details_missing`) asks for both before publishing, and an edit of a published event that empties either is 400 on the field.
- `capacity` positive, at most 1,000,000.
- At most 50 ticket types (`MAX_TICKET_TYPES`, SEC-025): the API refuses more; the builder disables "Add ticket type" at the limit.
- Ticket type name 1 to 120 characters. `price` and `memberPrice` follow `priceAmountSchema`: 0 (free) or $0.50 to $999,999.99 in cents. `memberPrice` at most `price` (validator and `TicketType_member_price_chk`).
- `quantity`: 1 to 1,000,000 on create; 0 to 1,000,000 on edit, including types added in an edit (the edit schema allows sold-out `0`).
- Checkout caps an order at 10 tickets (`maxTicketsPerOrder` in `lib/validators/payments.ts`).

### Builder

`components/events/create-event-form.tsx` serves both the new and Edit pages.

- **Society time.** Times are shown and edited in `Organisation.timeZone`, never the browser's zone; `lib/zoned-time.ts` converts both ways. A time in a daylight-saving gap is refused ("clocks go forward"); a time in an overlap offers the first or second occurrence, and an edit keeps the one saved. The Schedule card names the zone.
- **Sales close** shows the start time until changed, then sends its own value. On edit, a close time still equal to the old start follows a new start; an explicit one stays.
- **Prices are dollars.** The `$` field is parsed to cents without floating point (`parseMoneyInput` in `lib/format.ts`); the API takes cents (EVT-002).
- **Access** offers Public, Link only and Members only, with a warning while no published plan unlocks members-only events. Each ticket type has an optional Member price, with a warning while no published plan unlocks member prices.
- **Capacity** hint names tickets already issued or held. Each existing type shows sold (valid tickets) and held (live holds); a type with orders or tickets can't be removed.
- **Event image:** optional 16:9, uploaded as an `event` asset (`POST /api/orgs/[orgSlug]/assets?kind=event`), previewed privately; Replace and Remove apply on save.
- **If tickets cannot be issued:** "Refund the buyer automatically in full" (`automatic_full`, the default) or "Review it manually" (`manual_review`).
- Saving an edit stays on the page ("Event saved"). A stale version or moved stock keeps the edits on screen with the server's message. Leaving with unsaved changes asks first, whether by closing the tab or by following any link in the app (Cancel, the sidebar, "set up payments"), because in-app links never unload the page. A draft's Edit page shows the readiness checklist.

### Publish and unpublish

`PATCH /api/events/[eventId]/publish` with `{ targetStatus, version }`. Asking for the current status is a no-op, so a retry can't flip it back.

- **Readiness** (`eventReadiness`, the one rule for the button, the checklist, the API, checkout and the public page). Blockers, by `code`:
  - `details_missing`: title, description and location.
  - `schedule_invalid`: end after start.
  - `sales_close_after_end`; `sales_window_past`: close time in the future and not after the end.
  - `members_only_unavailable`: a members-only event needs a published plan still to end that unlocks `members_only_events`.
  - `no_ticket_types`; `no_stock`; `payments_unavailable` (every stocked type is paid and the society can't take charges); `sold_out` ("Every ticket type is sold out or held in checkouts.").
- **Per-type buyability** is separate: a free type is buyable without Stripe; a paid type needs charges ready. A mixed event publishes and sells its free types while paid ones wait, and readiness returns the non-blocking warning `paid_tickets_waiting` so the checklist and the Summary's selling status tell the organiser buyers can't pay yet. Checkout and the public page pass each type's sellable stock.
- Publishing a members-only event checks the plan once; it stays published after the plan ends, and members keep access while their memberships run.
- **Unpublish** is refused once any order exists ("Keep this event published for purchasers and order history"). The count is rechecked under the event lock that checkout takes (SEC-009).
- Audits `event.published` / `event.unpublished`.

### Sales

`PATCH /api/events/[eventId]/sales` with `{ saleState, version }` closes or reopens sales without touching `status`. Reopening after `salesCloseAt` has passed is 400 on `salesCloseAt` ("Move the sales close time later before reopening sales"). Audits `event.sales_closed` / `event.sales_reopened`.

### Cancelling

`POST /api/events/[eventId]/cancel` (`cancelOrganisationEvent`) cancels a published event that hasn't ended. It needs `events:manage` and `orders:refund`, the event title typed back, a message to ticket holders, and one fresh authenticator code for the whole event.

- **One transaction under the event lock** (all ticket types, then each order), so no checkout, fulfilment or edit interleaves: `cancelledAt`, `cancellationReason`, `saleState = closed`, `version` + 1.
- **Paid Stripe orders:** each gets a `RefundRequest` through `openOrderRefund`, the same checks and fence as a staff refund, left `pending` for the refunds worker ([[Payment Lifecycle Refunds and Disputes#Order refunds]]). Tickets stay valid until Stripe confirms each refund, then are voided as with any refund. Orders it can't refund are skipped and returned in `skipped` with the reason: `disputed` (the bank settles it), `already_refunded`, `in_progress`, `not_refundable` (in compensation or marked refunded outside Thunderstrux).
- **Free registrations** are cancelled with `cancelFreeOrder` (no stock back: nothing sells again).
- **Holders:** every order that still had a valid ticket gets one `event_cancelled` email with the society's message and what happens to their money ([[Email Delivery Implementation]]).
- **Late payments:** a checkout still open at cancellation can't issue tickets: fulfilment sees `cancelledAt` under the event lock and sends the payment to compensation (`event_cancelled_before_fulfilment`, [[Payment Lifecycle]]).
- **Afterwards:** edits, publish changes and reopening sales are refused (400 "This event was cancelled"); the Edit page shows a notice instead of the form. The event leaves Explore, society profiles and discovery counts; its own page and buyers' order pages say it was cancelled. A repeat answers `already_cancelled`.
- Audits `event.cancelled` with the counts and skipped orders, plus each order's own `order.refund_requested` or `order.free_cancelled`.
- **Why one code and the worker:** refunding one order at a time took a fresh code each, so a 300-ticket event took hours (EVT-004). Luma and Eventbrite cancel with one confirmation that refunds everyone and emails attendees; the worker spreads the Stripe calls and retries unknown answers. Only before the end: payouts wait until two days after the event, so the society's balance still holds the money to refund.
- **Not done here:** memberships and merchandise aren't event-owned and are untouched; check-in doesn't separately refuse a cancelled event (its tickets are voided as refunds land).

### Editing

`PATCH /api/events/[eventId]` (`updateEventSchema`) updates fields and synchronises ticket types under the event lock. It never changes `status` or `saleState`.

- Ticket types match by `id`, never by name; submitted ids must belong to the event and appear once (400).
- A type without `id` is created. An omitted type is deleted only if it has no orders and no tickets; otherwise it is kept.
- Types with orders or tickets stay editable (name, price, member price, quantity) for future purchases. Orders keep their `unitPrice`, `totalAmount` and purchase snapshots; tickets keep their `ticketTypeId`.
- **Stock fence:** each existing type sends `expectedQuantity` (what the editor loaded). If sales moved stock and the field is untouched, the current stock is kept; if both changed, 409 "Ticket stock changed while you were editing".
- A type's remaining quantity can't go below its active holds; `capacity` can't go below occupancy (issued tickets that aren't void, which includes tickets under dispute review, plus active holds). Both are 400 on the field.
- **End time (SEC-004):** an edit can't move `endTime` earlier to a time already past (400 on `endTime`), because payouts wait until two days after the end. Later, or earlier but still future, is fine: payouts hold the event's money until two days after the latest end it has had (`EventChange.previousEndTime`, SEC-029), so moving it earlier releases nothing.
- A published event keeps its description and location (400 on the field), since buyers can see it.
- **Time and place changes:** a new start, end or location on an event with active tickets records an `EventChange` in the same transaction. A newer unsent change supersedes the older one and keeps the original "was"; changing back before any email sends nothing. The notification worker emails each valid holder once after a five-minute pause (`eventChangeDelayMs`). Title, description, price and stock edits email nobody ([[Email Delivery Implementation]]).
- Audits `event.updated` with before and after per field and ticket types added, removed or edited.

### Inventory and locks

`lib/events/inventory.ts` is the only place that locks an Event and its ticket types or computes sellable stock.

- **Lock order:** the buyer's User row on paths that fence it, then the Event, then its ticket types by ascending id, then orders and holds. No path locks an order and then an event or type ([[Database and Multi Tenancy#Lock order]]). Checkout (including free issuance inside it), paid fulfilment, edits, unpublish and delete take it; publish and sales changes are compare-and-set on `version`.
- **Sellable** = `max(0, min(remaining − that type's active holds, capacity − occupancy))`; without a capacity only the first limit applies. Occupancy counts tickets that aren't void, so a ticket under dispute review keeps its place and restoring it after a won dispute can't oversell (DEF-056).
- `TicketType.quantity` is remaining stock. Paid fulfilment (`lib/payments/checkout-reconciliation.ts`) and free registration at checkout (`lib/payments/free-ticket-issuance.ts`) both decrement it with a `quantity >= n` guard.
- Holds count while `status = active` and `expiresAt` is after the transaction's single application-clock reading (not the database clock; tests drive it with fake timers). Hold lifetime: [[Payment Lifecycle#Holds]].
- Checkout compares the buyer's `expectedUnitPrice` with the locked price and refuses a change with 409 before holding stock. Fulfilment rechecks capacity once; an order that would exceed it goes to compensation review.

### Compensation refund mode

`Event.compensationRefundMode` decides what happens to a payment that arrives when tickets can't be issued (sold out meanwhile, or paid after the hold lapsed). `createEventSchema` defaults it to `automatic_full`; the schema column defaults to `manual_review`, so events created outside the API (seed, tests, scripts) review manually. Checkout copies it to `Order.compensationRefundModeSnapshot`, and the order keeps that choice. Behaviour: [[Payment Lifecycle]].

### Hero image

`Event.heroAssetId` references `(Asset.id, organisationId)`, so an event can only use its own society's image. Create and edit lock the Asset after the Event and accept only a ready, undeleted `event` asset (400 on `heroAssetId`: "That image is no longer available. Upload it again, then save."). Every change, and deleting the event, refreshes `unreferencedAt` on old and new images. Delivery and cleanup: [[Society Profiles and Assets]].

### Deleting

`DELETE /api/events/[eventId]` is refused (400 on `eventId`) once the event has any order or ticket, rechecked under the event lock. Otherwise it deletes the event and its ticket types, releases its image and audits `event.deleted`.

### Public reads

- `GET /api/public/events` (`getPublishedEvents`): published, `public`, not cancelled, not yet ended (PUB-001), ordered by start with cursor pages. No auth; no demo data; no stale-order cleanup.
- `GET /api/public/events/[eventId]` (`getPublishedEventDetail`): published, `public` or `unlisted`; never `members_only`.
- `/events/[eventId]` reads through `getEventForViewer`: drafts and wrong ids are 404; a members-only event opens only for a verified member whose live membership of the society carries `members_only_events`, and everyone else gets the gate ([[Memberships and Merchandise]]). Prices per viewer come from `priceForViewer`. The buyer's confirmation page uses `getBookedEventDetail`, so a ticket holder keeps the page.
- Society profiles list up to 50 upcoming public events, never cancelled ones ([[Society Profiles and Assets]]).
- A cancelled event's detail still reads (`cancelled: true`): the page shows "Event cancelled" and the buy box sells nothing.
- Demo events come only from `prisma/seed.mjs`, never from a public read ([[Seeding and Data]]).
- Contracts: [[API Reference]].

### Dashboard surfaces

- `/dashboard/events` (`events:read`) lists events with a selling badge (Sales open, Sold out, Sales closed, Event cancelled), "Link only" for unlisted, and times in the society zone; sales columns need `analytics:read`.
- `/dashboard/events/[eventId]` (`analytics:read`) shows details, the ticket table (price, sold, held, left), a Capacity tile, and for a draft the readiness checklist with links to the field or payment setup. More offers Close sales and Reopen sales. Money needs `orders:read` too ([[Analytics and Calendar]]).
- `/dashboard/events/[eventId]/preview` (`events:manage`) renders a draft as the public page under "Draft preview" with buying off; a published event redirects to its public page.
- `components/events/event-actions.tsx` shows Publish, Unpublish and Delete with confirmation and the reason an action is disabled; the routes still enforce the rules. On the event's own page, staff who may also refund see "Cancel event" (typed title, message, code; `cancelBlocker` says why it's unavailable). A cancelled event shows no actions.
- Legacy `/dashboard/[orgSlug]/events/...` pages redirect to the slugless routes.

## Traps

- Don't trust the client's organisation id for authority; resolve the society, then check live staff authority.
- Don't add a second place that computes stock or locks events; extend `lib/events/inventory.ts`.
- Don't read the database clock for hold expiry inside a transaction; take one application `now`.
- New blockers go in `eventReadiness` so the button, checklist, API and checkout agree.
- Seeded events use the schema default `manual_review`, unlike events created in the app.

## Failure and recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| 409 on save | Stale `version`, or stock moved while editing | Reload; the form keeps the edits on screen |
| Publish 400 with blockers | Readiness failed | Fix each `field` named; paid-only events need payments set up |
| Can't unpublish or delete | Orders or tickets exist | Close sales instead, or Cancel event to refund everyone |
| Cancel event reports skipped orders | Disputed, already refunded, or in compensation | Settle each in Orders; a dispute is settled by the bank |

## Related

[[Payment Lifecycle]] · [[Ticket Check-in Implementation]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]] · [[Analytics and Calendar]] · [[Email Delivery Implementation]] · [[Seeding and Data]] · [[API Reference]] · [[Database and Multi Tenancy]]
