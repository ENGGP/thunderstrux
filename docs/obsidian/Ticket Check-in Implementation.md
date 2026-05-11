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

No status enum, QR token, check-in actor, audit log, refund validity rule, order mutation, or Stripe mutation exists in this MVP.

## APIs

Routes:

- `GET /api/events/[eventId]/tickets`
- `POST /api/tickets/[ticketId]/check-in`
- `POST /api/tickets/[ticketId]/check-out`

Rules:

- Auth required.
- Organisation account required.
- Event-management access required.
- Ownership is verified server-side from `session.user` through `Organisation.accountUserId`.
- Ticket access is scoped through `Ticket.event.organisationId`.
- `Ticket.organisationId` remains stored, but event ownership is the source of truth for ticket visibility and check-in/check-out authorization.

Invalid transitions:

- Checking in an already checked-in ticket returns `409`.
- Checking out an unused ticket returns `409`.
- Tickets belonging to another organisation return `404`.

## Service Layer

File:

```text
lib/tickets/check-in.ts
```

Important functions:

- `getOrganisationEventTickets(organisationId, eventId)`
- `checkInOrganisationTicket(organisationId, ticketId)`
- `checkOutOrganisationTicket(organisationId, ticketId)`

Concurrency safety:

- Check-in uses a conditional update where `checkedInAt = null`.
- Check-out uses a conditional update where `checkedInAt IS NOT null`.
- If the conditional update affects zero rows after the initial state read, the API returns `409`.

## UI

File:

```text
components/tickets/ticket-check-in-button.tsx
```

Behavior:

- Unused tickets show `Check in`.
- Checked-in tickets show timestamp and `Check out`.
- Successful actions update local state and call `router.refresh()` so server-rendered counts refresh.

## Tests

Coverage lives in:

```text
tests/integration/ticket-check-in.test.ts
```

The suite covers own-organisation visibility, member denial, cross-organisation denial, check-in, double check-in conflict, check-out, invalid check-out conflict, and order/payment state preservation.
It also covers inconsistent `Ticket.organisationId` data to confirm event ownership remains the access source of truth.
