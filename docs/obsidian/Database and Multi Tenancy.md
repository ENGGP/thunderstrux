# Database and Multi Tenancy

## Tenant Boundary

The tenant boundary is `Organisation`.

Core model:

```text
User
  -> OrganisationMember
  -> Organisation
       -> Event
            -> TicketType
       -> Order
       -> Ticket
```

Dashboard access is granted by `OrganisationMember` rows.

## Schema Snapshot

Main models in `prisma/schema.prisma`:

- `User`
- `Organisation`
- `OrganisationMember`
- `Event`
- `TicketType`
- `Order`
- `Ticket`

Enums:

- `OrganisationRole`
- `EventStatus`
- `OrderStatus`

## Users

Important fields:

- `id`
- `email` unique
- `password`
- `createdAt`

`password` stores the bcrypt hash, not the raw password.

## Organisations

Important fields:

- `id`
- `name`
- `slug` unique
- `stripeAccountId`
- `stripeAccountStatus`
- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `createdAt`

`slug` is the stable tenant-facing identifier used in dashboard routes.

Example:

```text
/dashboard/engineering-society
```

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

## Orders and Tickets

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

`Ticket` is the issued unit created after a paid webhook reconciliation.

One paid order creates `quantity` ticket rows.

## Multi-Tenant Access Pattern

The backend resolves tenant access through:

- authenticated user
- organisation membership
- role-specific checks

Common patterns:

- `requireOrganisationMembershipBySlug(orgSlug)`
- `requireOrganisationMembershipById(organisationId)`
- `requireEventManagementAccess(organisationId)`

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

- The helper layer supports validating `x-org-id`, but the important security boundary is still the server-side membership and role check.

## Public vs Private Data

Public APIs:

- return published event data only
- do not require authentication

Private APIs:

- require authentication
- require organisation membership
- require management roles for mutations

Checkout is public-facing in URL shape, but still requires an authenticated user and server-side event resolution.
