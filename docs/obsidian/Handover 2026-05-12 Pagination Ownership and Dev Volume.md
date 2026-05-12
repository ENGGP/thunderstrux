# Handover 2026-05-12 - Pagination, Ownership, and Dev Volume

Read [[Current Handover]] first. This handover records the current state after the ownership-consistency, ticket pagination, TypeScript validation, and Docker development volume work.

## Session Focus

Completed and documented the post-MVP organiser stability work around:

- Event-based ownership checks for tickets and orders.
- Consistency guards for denormalized ticket/order organisation fields.
- Ticket list cursor pagination.
- TypeScript validation stability.
- Docker development `node_modules` volume naming.
- Obsidian documentation sync.

No Stripe payment state, order payment lifecycle, QR scanning, RBAC, or API error-standardisation work was added in this branch.

## Ownership Consistency

Ticket access now treats the event relation as the source of truth:

```text
Ticket.event.organisationId
```

Order organiser access now follows the same pattern through:

```text
Order.event.organisationId
```

The denormalized fields remain in the schema:

- `Ticket.organisationId`
- `Order.organisationId`

They are still stored for relations/reporting compatibility, but they are not the authority for organiser access.

## Creation Guards

Webhook ticket issuance writes:

```text
Ticket.organisationId = Event.organisationId
```

Checkout order and reservation creation writes:

```text
Order.organisationId = Event.organisationId
TicketReservation.organisationId = Event.organisationId
Stripe metadata organisationId = Event.organisationId
```

This preserves consistency without trusting frontend-supplied tenancy data.

## Ticket Pagination

Implemented cursor pagination for:

- `GET /api/events/[eventId]/tickets`
- `/dashboard/events/[eventId]/tickets`

Query params:

- `limit`
- `cursor`
- `direction`

Defaults and limits:

- default limit: `25`
- max limit: `100`
- default direction: `next`

Ordering:

```text
Ticket.createdAt ASC
Ticket.id ASC
```

Cursor contents:

```text
createdAt
id
```

The API response preserves the existing `event` and `tickets` fields and adds:

- `pageInfo`
- `counts`

The Prisma schema now includes:

```prisma
@@index([eventId, createdAt, id])
```

Migration:

```text
20260503050000_ticket_event_cursor_index
```

## Pagination Review Notes

A focused review found no blocking pagination bugs before commit.

Non-blocking follow-ups:

- Add same-`createdAt` cursor collision regression coverage.
- Add malformed `limit` and `direction` regression coverage.
- Optionally make stale empty-cursor `pageInfo` booleans stricter so they do not report available navigation when no page rows exist.

## TypeScript Validation Stability

Normal TypeScript validation now excludes volatile Next dev generated route types and keeps stable production generated types:

```json
".next-build/types/**/*.ts"
```

`scripts/clean-next-dev.mjs` clears:

- `.next/dev`
- `.next/types`

It does not remove:

- `.next-build`

This keeps `pnpm exec tsc --noEmit` from being blocked by stale `.next/dev/types/validator.ts`.

## Docker Dev Volume

The dev app container now uses a named dependency volume:

```yaml
node_modules:/app/node_modules
```

Docker creates it as:

```text
thunderstrux_node_modules
```

This replaced the previous anonymous hash-named volume mounted at `/app/node_modules`.

Database data remains separate:

```text
thunderstrux_postgres_data
```

The old anonymous `node_modules` volume was removed after confirming it was no longer mounted.

## Validation

Recent validation completed:

```bash
pnpm exec tsc --noEmit
git diff --check
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm test:integration
docker compose exec app pnpm test:smoke
```

Observed results:

- TypeScript validation passed after Prisma Client generation inside the new named `node_modules` volume.
- Integration tests passed with 10 files and 56 tests.
- Smoke test passed with 22 checks.
- `git diff --check` passed with only expected CRLF warnings on Windows.

## Current Next Work

Recommended next small task:

- Add ticket pagination hardening tests for same-timestamp cursors and malformed pagination params.

Keep separate:

- stale pending cleanup lifecycle review
- API error standardisation
- UI state consistency cleanup
- QR scanning
- RBAC/staff accounts
- async email outbox

## High-Risk Rules To Preserve

- Do not mark orders paid outside Stripe webhook reconciliation.
- Do not mutate Stripe payment state from Thunderstrux backend actions.
- Do not trust frontend organisation or order ownership values.
- Keep organiser access scoped through `session.user` and event ownership.
- Ticket check-in/check-out must only mutate `Ticket.checkedInAt`.
- Ticket delivery email must only run after paid fulfilment and ticket issuance.
- Pagination must not weaken ownership checks or expose another organisation's tickets.
