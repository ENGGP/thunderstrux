# Database and Multi Tenancy

## Tenant Boundary

The tenant boundary is `Organisation`.

Core model:

```text
User
  -> accountRole member | organisation

Organisation account User
  -> Organisation.accountUserId
       -> Event
            -> TicketType
       -> Order
       -> Ticket
       -> TicketReservation

Member account User
  -> OrganisationMember
  -> Organisation
```

Organisation dashboard access is granted by `Organisation.accountUserId`. `OrganisationMember` remains for member join relationships and migration compatibility, not MVP staff access.

## Schema Snapshot

Main models in `prisma/schema.prisma`:

- `User`
- `Organisation`
- `OrganisationMember`
- `Event`
- `TicketType`
- `Order`
- `Ticket`
- `TicketReservation`

Enums:

- `OrganisationRole`
- `EventStatus`
- `OrderStatus`
- `ReservationStatus`

## Users

Important fields:

- `id`
- `email` unique
- `password`
- `accountRole`
- `firstName`
- `lastName`
- `displayName`
- `phone`
- `studentNumber`
- `onboardingCompletedAt`
- `createdAt`

`password` stores the bcrypt hash, not the raw password.

## Organisations

Important fields:

- `id`
- `name`
- `slug` unique
- `accountUserId` unique nullable
- `stripeAccountId`
- `stripeAccountStatus`
- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `createdAt`

`slug` is the stable tenant-facing identifier used in dashboard routes.

Example:

```text
/dashboard
```

Legacy slug routes such as `/dashboard/engineering-society` currently redirect to slugless organisation dashboard routes for backwards compatibility.

Stripe fields are local cache/control fields for Connect:

- `stripeAccountId`: Stripe connected account id, e.g. `acct_...`.
- `stripeAccountStatus`: Thunderstrux lifecycle state string.
- `stripeChargesEnabled`: cached Stripe `charges_enabled`.
- `stripePayoutsEnabled`: cached Stripe `payouts_enabled`.
- `stripeDetailsSubmitted`: cached Stripe `details_submitted`.

Current lifecycle strings:

- `NOT_CONNECTED`
- `PLATFORM_NOT_READY`
- `CONNECTED_INCOMPLETE`
- `RESTRICTED`
- `READY`
- `ERROR`

These values are stored as strings, not a Prisma enum.

Meaning:

- `NOT_CONNECTED`: no connected account is stored locally.
- `PLATFORM_NOT_READY`: account creation was blocked because Stripe platform setup/profile is incomplete.
- `CONNECTED_INCOMPLETE`: a Stripe account exists, but onboarding details are not submitted.
- `RESTRICTED`: account details are submitted, but charges are not enabled.
- `READY`: charges are enabled.
- `ERROR`: an existing connected account could not be retrieved or synced.

Disconnect is local-only and clears the organisation Stripe fields. It does not delete the Stripe account. Reconnecting to the same old account requires manually restoring the old `acct_...` value into `stripeAccountId` and refreshing status.

## Organisation Members

Fields:

- `userId`
- `organisationId`
- `role`
- `createdAt`

Constraints:

```text
unique(userId, organisationId)
```

Current roles:

- `org_owner`
- `org_admin`
- `event_manager`
- `finance_manager`
- `content_manager`
- `member`

In the target MVP, these rows represent member-account joins. They are not staff invite records. Organisation committee access currently uses a shared organisation account login.

## Events

Fields:

- `organisationId`
- `title`
- `description`
- `startTime`
- `endTime`
- `location`
- `status`

Current statuses:

- `draft`
- `published`

## Ticket Types

Fields:

- `eventId`
- `name`
- `price` in integer cents
- `quantity`

Current rule:

- quantity must be positive on creation
- quantity means remaining inventory, not original capacity
- organiser analytics display `quantity` as remaining only
- sold counts and revenue are derived from paid orders

## Orders, Reservations, And Tickets

`Order` is the checkout and reconciliation record.

Important fields:

- `organisationId`
- `eventId`
- `ticketTypeId`
- `userId`
- `status`
- `quantity`
- `unitPrice`
- `totalAmount`
- `stripeSessionId` unique
- `isManuallyRefunded`
- `requiresCompensationReview`
- `fulfilmentFailedAt`
- `fulfilmentFailureReason`
- `ticketEmailSentAt`
- `ticketEmailLastError`
- `ticketEmailResentAt`

Order tenancy:

- `Event.organisationId` is the source of truth for organiser order access.
- `Order.organisationId` remains stored as a denormalized field for existing relations/reporting and checkout metadata.
- Checkout-created orders write `Order.organisationId` from `Event.organisationId`.
- Organiser order list/detail/action queries must scope through `Order.event.organisationId`, not trust `Order.organisationId` alone.
- Manual refund and manual resend access inherit the same event-based ownership check.
- Event analytics counts paid orders through event ownership.
- Checkout reconciliation validates Stripe organisation metadata against `Event.organisationId`. A stale `Order.organisationId` must not block fulfilment when the Stripe metadata matches the event owner, and reconciliation must not silently repair or overwrite the stale denormalized field.
- Paid Stripe sessions whose organisation metadata does not match `Event.organisationId` enter compensation review. Non-paid mismatches remain ordinary failed/ignored checkout outcomes.

Current statuses:

- `pending`
- `paid`
- `failed`
- `expired`

`pending` remains in the schema as an internal checkout reconciliation state. It is not part of normal organiser or member UX.

Each order maps to exactly one ticket type through `ticketTypeId`. Organiser analytics group paid orders by `ticketTypeId` and sum `quantity` and `totalAmount` for sold count and revenue.

Order management fields:

- `isManuallyRefunded`: local organiser bookkeeping flag only. It does not call Stripe, change Stripe payment state, or change order lifecycle status.
- `requiresCompensationReview`: marks paid Stripe sessions where local ticket fulfilment failed and operator review is required. These orders remain `status = failed`, are not valid member tickets, and must not trigger ticket email.
- `fulfilmentFailedAt`: first recorded timestamp for paid-but-unfulfilled local fulfilment failure. Treat as write-once diagnostics.
- `fulfilmentFailureReason`: first recorded machine-readable reason for paid-but-unfulfilled local fulfilment failure. Treat as write-once diagnostics.
- `ticketEmailSentAt`: first successful automatic ticket delivery email timestamp.
- `ticketEmailLastError`: most recent ticket email delivery error message.
- `ticketEmailResentAt`: most recent successful manual resend timestamp.

Ticket email delivery tracking is operational state only. It must not be used as payment truth, ticket ownership, refund state, or fulfilment truth.

`EmailOutbox` stores durable ticket delivery email jobs.

Important fields:

- `orderId`
- `mode`: `automatic` or `manual`
- `status`: `pending`, `processing`, `sent`, or `failed`
- `attempts`
- `nextAttemptAt`
- `processingStartedAt`
- `lastError`
- `providerMessageId`
- `deliveredToProviderAt`
- `sentAt`

Automatic jobs are unique per order through the raw partial index `EmailOutbox_automatic_order_unique`. Manual jobs are intentionally not unique so organiser resends can queue multiple delivery attempts.

`TicketReservation` is the temporary soft hold created before redirecting to Stripe Checkout.

Important fields:

- `orderId` unique
- `organisationId`
- `eventId`
- `ticketTypeId`
- `userId`
- `quantity`
- `status`
- `expiresAt`
- `confirmedAt`
- `releasedAt`
- `releaseReason`

Reservation tenancy:

- `Event.organisationId` is the source of truth for organisation-scoped reservation lifecycle operations.
- `TicketReservation.organisationId` remains stored as a denormalized field for existing relations/reporting and checkout metadata.
- Organisation-scoped stale reservation cleanup must scope through `TicketReservation.event.organisationId`, not trust `TicketReservation.organisationId` alone.

Reservation statuses:

- `active`
- `confirmed`
- `released`
- `expired`

Rules:

- active reservations reduce checkout availability
- reservation expiry is 30 minutes
- expired reservations do not reduce availability
- pending orders linked to expired reservations are marked `expired` by app-level stale cleanup
- legacy pending orders without reservations are marked `expired` by stale cleanup once they are older than 30 minutes
- organisation-scoped stale order cleanup uses event ownership, so stale denormalized order/reservation ownership cannot expire another organisation's event-owned rows
- normal reservation expiry does not set `Order.failureReason`
- Stripe Checkout `expires_at` matches the reservation expiry
- paid webhook reconciliation confirms reservations atomically with order payment, inventory decrement, and ticket creation

`Ticket` is the issued unit created after a paid webhook reconciliation.

One paid order creates `quantity` ticket rows.

Important fields:

- `organisationId`
- `eventId`
- `ticketTypeId`
- `orderId`
- `checkedInAt`
- `createdAt`

Ticket check-in/check-out state:

- `checkedInAt = null`: unused.
- `checkedInAt != null`: checked in.
- Check-in is the only mutable ticket operational state in the MVP.
- Ticket access for visibility and check-in/check-out is authorised through `Ticket.event.organisationId`.
- `Ticket.organisationId` remains stored for existing relations/reporting, but event ownership is the access source of truth.
- Ticket issuance always writes `Ticket.organisationId` from `Event.organisationId`. If historical order data has a different `Order.organisationId`, webhook reconciliation logs the mismatch and still creates tickets with the event organisation.
- Check-in and check-out must not modify order status, Stripe data, ticket ownership, ticket type history, or payment state.
- Double check-in is prevented by atomically updating only tickets where `checkedInAt` is still `null`.
- Invalid check-out is prevented by atomically updating only tickets where `checkedInAt` is not `null`.
- Organiser ticket listing is cursor-paginated by event using stable ordering on `Ticket.createdAt` and `Ticket.id`.
- `Ticket(eventId, createdAt, id)` is indexed for event ticket cursor pagination.

Composite query indexes added in P1.10:

- `Event(status, startTime, id)` supports public event discovery ordered by start time.
- `Order(eventId, status, createdAt, id)` supports event/order reads and future event-scoped order pagination.
- `Order(userId, status, createdAt, id)` supports member ticket wallet and future member order pagination.
- `Order(status, createdAt)` supports current stale pending order cleanup.
- `TicketReservation(status, expiresAt)` supports global stale active reservation cleanup.

Non-blocking index notes:

- Existing single-column `Order(eventId)` and `Order(userId)` overlap with the left-most prefixes of the new composite order indexes. They were intentionally kept in P1.10; remove only after production query/index-usage evidence.
- `TicketReservation(orderId)` overlaps with the unique `TicketReservation(orderId)` backing index and predates P1.10. Treat removal as later DB hygiene, not part of the composite-index slice.

Current follow-up:

- Add pagination hardening coverage for same-`createdAt` cursor collisions and malformed limit/direction params.
- Add denormalized ownership drift reporting/repair tooling before relying on `Order.organisationId`, `Ticket.organisationId`, or `TicketReservation.organisationId` for performance-sensitive query shortcuts.

## Multi-Tenant Access Pattern

The backend resolves tenant access through:

- authenticated user
- account role
- organisation account ownership through `Organisation.accountUserId`
- member join relationships through `OrganisationMember`

Common patterns:

- `requireCurrentOrganisationAccount()`
- `getCurrentOrganisationAccount()`
- `requireOrganisationAccessBySlug(orgSlug)`
- `requireOrganisationAccessById(organisationId)`
- `requireOrganisationEventManagementAccess(organisationId)`
- `requireOrganisationFinanceAccess(organisationId)`
- `requireOrganisationStripeConnectAccess(organisationId)`

Organisation-management decisions are based on organisation-account ownership, not member join rows.

## Organisation Scope Helpers

File:

```text
lib/db/organisation-scope.ts
```

Important helpers:

- `requireOrganisationId`
- `requireOrganisationHeader`
- `requireMatchingOrganisationScope`
- `scopedByOrganisation`
- `assertEventBelongsToOrganisation`

Current note:

- The helper layer supports validating `x-org-id`, but the important security boundary is still the server-side account role and organisation ownership check.

## Public vs Private Data

Public APIs:

- return published event data only
- do not require authentication

Private APIs:

- require authentication
- require organisation account ownership for management routes
- require management roles for mutations

Checkout is public-facing in URL shape, but still requires an authenticated member account and server-side event resolution.
