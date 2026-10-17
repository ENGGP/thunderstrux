---
status: living
last-reviewed: 2026-10-17
owner: engineering
related: ["[[Event Lifecycle]]", "[[Database and Multi Tenancy]]"]
sources: [lib/tickets/check-in.ts, app/api/tickets]
---

# Ticket Check-in Implementation

This note documents the current organiser ticket check-in and check-out implementation. Read with [[API Reference]] and [[Database and Multi Tenancy]].

## State Model

Ticket attendance state is stored only on:

```text
Ticket.checkedInAt
```

Meaning:

- `null`: unused.
- non-null timestamp: checked in.

`Ticket.validity` (T10) is separate from attendance: only `active` tickets appear in the attendee list and its counts. Since T19b check-in or undo on a `void` or `refund_review` ticket is refused with its reason (`409`, `not_valid` or `under_review`) and the ticket's attendance record is left as it was; a search still finds such tickets so staff can say why they don't admit. Who checked a ticket in is read from its latest `ticket.checked_in` audit entry (no extra column). The list shows the ticket type name purchased with the order. There is no QR token. Check-in/out append an actor-attributed AuditLog transactionally; no order/Stripe state or ticket ownership is changed.

## APIs

Routes:

- `GET /api/events/[eventId]/tickets`
- `POST /api/tickets/[ticketId]/check-in`
- `POST /api/tickets/[ticketId]/check-out`

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- The live tickets:check_in capability is required for listing and check-in/out.
- Authority is verified server-side from `session.user` through live `OrganisationStaff` status and capabilities; the legacy owner path is used only when explicitly configured.
- Ticket access is scoped through `Ticket.event.organisationId`.
- `Ticket.organisationId` remains stored, but event ownership is the source of truth for ticket visibility and check-in/check-out authorization.
- Webhook ticket issuance writes `Ticket.organisationId` from `Event.organisationId`, and logs/corrects the ticket organisation value if historical order data is inconsistent.

Ticket listing pagination:

- `GET /api/events/[eventId]/tickets` defaults to `limit=25`.
- Maximum `limit` is 100.
- Supported query params are `limit`, `cursor`, `direction` and `q`.
- `direction` is `next` or `prev`; default is `next`.
- Cursors are opaque and encode the ticket `createdAt` and `id`, through the shared `lib/pagination/cursor.ts` helpers (T19b; this was one of the PAG-001 copies).
- `q` (2 to 100 characters) searches this event's tickets by name, email, order or ticket reference: every word must match a buyer name or email field (purchase snapshot, member account or guest email), or the whole query appears in the ticket or order id. A search includes void and under-review tickets; shorter or empty `q` lists the tickets that admit.
- Ordering is stable by `Ticket.createdAt ASC, Ticket.id ASC`.
- The response includes `pageInfo` and global event ticket `counts`.

Invalid transitions (`409` with detail `reason`):

- Checking in an already checked-in ticket: `already_checked_in`. Two staff admitting the same ticket at once get one `200` and one `409`.
- Checking out an unused ticket: `not_checked_in`.
- A void ticket: `not_valid`; an under-review (disputed) ticket: `under_review`.
- Tickets belonging to another organisation, or a draft event's tickets for check-in staff, return `404`.

The three routes map errors through `lib/tickets/http.ts` and `mapRouteError` (T19b, narrowing API-001).

## Service Layer

File:

```text
lib/tickets/check-in.ts
```

Important functions:

- `getOrganisationEventTickets(organisationId, eventId, { limit, cursor, direction, query })`
- `checkInOrganisationTicket(organisationId, ticketId, actorUserId)`
- `checkOutOrganisationTicket(organisationId, ticketId, actorUserId)`

Concurrency safety:

- Check-in uses a conditional update where `checkedInAt = null` and `validity = active`.
- Check-out uses a conditional update where `checkedInAt IS NOT null` and `validity = active`.
- If the conditional update affects zero rows, the ticket is re-read: a ticket voided meanwhile is `not_valid`, otherwise the transition conflict.

## UI

File:

```text
components/tickets/check-in-console.tsx
```

The attendees page (`/dashboard/events/[eventId]/tickets`) is the check-in console (T19b, design round A2 batch 3), built phone first:

- "{n} of {total} checked in", then a large "Find a ticket" field: results update as staff type, from 2 characters, and a late answer to an older search never replaces a newer one. With no search the page lists the tickets that admit, with Previous and Next cursor links.
- One card per ticket: the buyer, the ticket type, the short reference and "n of m", the email (with "guest" for a guest order), and a verdict: Valid (Check in), Checked in ("Already checked in at {time} by {name}", Undo check-in), Don't admit (refunded or cancelled on a date, or reversed after a dispute; no button) or Under review ("Ask an owner or finance manager before admitting"; no button). Buttons name the attendee for screen readers.
- After any answer from the server, the card re-reads the ticket (`?q={ticketId}`) and the page refreshes its counts. With no answer within 10 seconds it shows "Status unknown" and Reload ticket: it never claims a check-in it can't confirm, and reloading a check-in that did save shows it as already checked in.

## Tests

Coverage lives in:

```text
tests/integration/ticket-check-in.test.ts
```

The suite covers own-organisation visibility, member denial, cross-organisation denial, cursor pagination, invalid cursor handling, check-in, double check-in conflict, check-out, invalid check-out conflict, and order/payment state preservation. Since T19b it also covers two check-ins at once admitting once with the checker's name, refunded and disputed tickets refused with their reasons and attendance kept, search by name, email, order and ticket reference within one event, and check-in staff limited to published events. `tests/e2e/check-in.spec.ts` drives the console at 390 and 1280px, including a check-in whose answer is lost after it saved.
It also covers inconsistent `Ticket.organisationId` data to confirm event ownership remains the access source of truth, plus webhook issuance consistency for newly created tickets.
