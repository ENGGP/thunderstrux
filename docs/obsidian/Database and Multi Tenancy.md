# Database and Multi Tenancy

## Core Model

Thunderstrux is multi-tenant by organisation.

```text
User
  -> OrganisationMember
  -> Organisation
       -> Event
            -> TicketType
       -> Order
       -> Ticket
```

The tenant boundary is `Organisation`. Dashboard access is granted by `OrganisationMember` rows.

## Users

`User` represents a local credentials account.

Important fields:

- `id`
- `email`
- `password`
- `createdAt`

Rules:

- `email` is unique.
- `password` stores a bcrypt hash.
- Auth.js sessions include `session.user.id`.
- Membership checks use the database user ID, not email.

## Organisations

`Organisation` represents a society or tenant.

Important fields:

- `id`
- `name`
- `slug`
- `stripeAccountId`
- `stripeAccountStatus`
- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `createdAt`

`slug` is the stable dashboard URL identifier used by `/dashboard/[orgSlug]`.

## Organisation Members

`OrganisationMember` joins users to organisations.

Important fields:

- `userId`
- `organisationId`
- `role`

Constraint:

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

Role checks come from the membership row for the authenticated user.

## orgSlug Routing

The browser route uses the slug:

```text
/dashboard/engineering-society
```

The route file receives:

```ts
params: Promise<{ orgSlug: string }>
```

The organisation dashboard layout calls `requireOrganisationMembershipBySlug(orgSlug)`. If the user is not a member, the route resolves as not found.

## Security Model

Trusted source of access:

- Auth.js session
- `session.user.id`
- `OrganisationMember` rows
- Server-side Prisma queries

Untrusted inputs:

- Frontend role state
- Frontend `organisationId`
- Request headers such as `x-org-id` or `x-user-role`

Private APIs may accept IDs as parameters, but they must verify membership and ownership server-side before reading or mutating data.

## Helper Files

- `lib/auth/access.ts` resolves authenticated users, memberships, and role-specific access.
- `lib/db/organisation-scope.ts` contains organisation scoping helpers and event ownership assertions.
- `lib/permissions/index.ts` maps roles to capabilities.

## Public vs Private Data

Public routes:

- Do not require auth.
- Return only published events.
- Do not expose internal organisation IDs unless needed for a public-safe response.

Private dashboard routes:

- Require auth.
- Require organisation membership.
- Use membership roles for permissions.

Checkout:

- Accepts `eventId`, `ticketTypeId`, and `quantity`.
- Resolves organisation from the published event server-side.
- Creates local orders with trusted server-side IDs.

