# Database and Multi Tenancy

## Core Multi-Tenant Model

The core tenant entity is `Organisation`.

Most important resources belong directly or indirectly to an organisation:

- `OrganisationMember`
- `Event`
- `Order`
- `Ticket`
- `TicketType` through `Event`

## Prisma Models

### User

Represents a platform user.

Fields:

- `id`
- `email`
- `password`
- `createdAt`

Relations:

- Organisation memberships
- Orders

Authentication uses Auth.js credentials login. `password` stores a bcrypt hash, never a plain password.

### Organisation

Represents a society or tenant.

Fields:

- `id`
- `name`
- `slug`
- `stripeAccountId`
- `stripeAccountStatus`
- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `createdAt`

Relations:

- Members
- Events
- Orders
- Tickets

Stripe Connect status lives here because each organisation will receive payments independently.

### OrganisationMember

Joins users to organisations with a role.

Fields:

- `id`
- `userId`
- `organisationId`
- `role`
- `createdAt`

Constraints:

- Unique on `userId + organisationId`
- Indexed by `userId`
- Indexed by `organisationId`

### OrganisationRole

Current roles:

- `org_owner`
- `org_admin`
- `event_manager`
- `finance_manager`
- `content_manager`
- `member`

Roles are enforced from `OrganisationMember` rows for the authenticated `session.user.id`.

### Event

Represents an organisation event.

Fields:

- `id`
- `organisationId`
- `title`
- `description`
- `startTime`
- `endTime`
- `location`
- `status`
- `createdAt`

Rules:

- Belongs to exactly one organisation
- Public APIs only return `published` events
- Dashboard APIs must scope by organisation

### TicketType

Represents a purchasable ticket category for an event.

Fields:

- `id`
- `eventId`
- `name`
- `price`
- `quantity`
- `createdAt`

Rules:

- `price` is integer cents
- Validation requires non-negative price
- Validation requires quantity greater than zero when creating
- Checkout and webhook enforce inventory availability

### Order

Represents a Stripe Checkout purchase attempt.

Fields:

- `id`
- `organisationId`
- `eventId`
- `ticketTypeId`
- `userId`
- `status`
- `quantity`
- `unitPrice`
- `totalAmount`
- `stripeSessionId`
- `createdAt`

Purpose:

- Store enough local data for webhook reconciliation
- Avoid trusting Stripe metadata alone
- Support idempotent fulfilment

### Ticket

Represents an issued ticket after webhook-confirmed payment.

Fields:

- `id`
- `orderId`
- `eventId`
- `ticketTypeId`
- `organisationId`
- `createdAt`

Tickets are created only in the webhook after successful reconciliation.

## Multi-Tenancy Helpers

File:

- `lib/db/organisation-scope.ts`
- `lib/auth/access.ts`

Responsibilities:

- Require organisation IDs where needed
- Resolve authenticated users from Auth.js sessions
- Load organisation memberships and roles from `OrganisationMember`
- Build organisation-scoped Prisma query filters
- Assert that an event belongs to an organisation before mutation

## Public vs Private Tenancy Rules

Private/dashboard routes:

- Require authentication
- Require organisation membership
- Use `OrganisationMember.role` for permissions
- Do not trust frontend role or organisation headers

Public routes:

- Do not require auth or `x-org-id`
- Only expose public-safe data
- Only expose published events

Checkout:

- Does not require frontend `organisationId`
- Resolves organisation from the published event server-side
- Still records `organisationId` on the order for reconciliation
