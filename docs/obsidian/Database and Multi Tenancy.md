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

Enums:

- `OrganisationRole`
- `EventStatus`
- `OrderStatus`

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
- account role
- organisation account ownership through `Organisation.accountUserId`
- member join relationships through `OrganisationMember`

Common patterns:

- `requireCurrentOrganisationAccount()`
- `getCurrentOrganisationAccount()`
- `requireOrganisationMembershipBySlug(orgSlug)`
- `requireOrganisationMembershipById(organisationId)`
- `requireEventManagementAccess(organisationId)`

`requireOrganisationMembershipBySlug` and `requireOrganisationMembershipById` still exist for compatibility. Organisation-management decisions should prefer organisation-account ownership, not member join rows.

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
- require organisation membership
- require management roles for mutations

Checkout is public-facing in URL shape, but still requires an authenticated user and server-side event resolution.
