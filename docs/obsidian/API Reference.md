---
status: living
last-reviewed: 2026-10-27
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Database and Multi Tenancy]]"]
sources: [app/api, lib/api/errors.ts]
---

# API Reference

This is a concise reference for implemented API routes. Security and data-model rules are documented in [[Database and Multi Tenancy]].

## Society Assets

`POST /api/orgs/[orgSlug]/assets?kind=logo|cover|event|product` uploads one multipart file. Scoped asset GET provides private previews; DELETE rejects references and records recoverable tombstones. Public asset GET serves only ready public references. [[Society Profiles and Assets]] owns format, quota, permission, recovery and storage contracts.

## Society Profiles

`GET/PATCH /api/orgs/[orgSlug]/profile` requires organisation settings permission and staff MFA and returns private/no-store `{profile}`. PATCH supplies name, description, supportEmail, refundPolicy, pickupPolicy, timeZone, nullable logoAssetId/coverAssetId and expectedProfileVersion. Unknown fields are rejected; conflicts return 409 without saving. Completion requires name/description/public contact, and Stripe readiness is separate. Bootstrap retains its 201 `{organisation}` contract while rejecting a retained association or active staff authority. [[Society Profiles and Assets]] owns validation, locks, public output and recovery.

## Mutation Origin Guard

Custom cookie-authenticated mutation routes (`POST`, `PATCH`, `DELETE`) use a central trusted-origin guard.

Rules:

- If `Origin` exists, it must match `NEXT_PUBLIC_APP_URL` or `TRUSTED_APP_ORIGINS`.
- If `Origin` is missing and `Referer` exists, the `Referer` origin must be trusted.
- If both are missing, the request is rejected.
- Authenticated cookie mutations must also provide the session-bound CSRF token from `GET /api/security/csrf`.
- Stripe webhook routes are exempt and remain protected by Stripe signature verification on raw request bodies.

## Rate Limiting

High-risk mutation routes use central Redis-backed fixed-window rate limiting.

Protected routes:

- credentials login
- signup
- checkout creation
- ticket email resend
- organisation create, join, and leave
- ticket check-in and check-out
- Stripe Connect onboard, continue, and disconnect
- staff MFA setup and verification
- verification/recovery issuance and redemption
- authenticated password/email/closure mutations
- private staff invitation/handover actions, profile writes and asset upload/delete

Rules:

- Login, signup, verification/recovery, account-security mutations, organisation creation, staff MFA, private staff actions, profile writes and asset upload/delete fail closed if the required limiter backend is unavailable. Profile/delete allow 30 per actor/tenant per ten minutes; upload has actor and tenant 20/hour buckets.
- Checkout, resend, join/leave, check-in/check-out, and Stripe Connect mutations fail open with a structured warning if the limiter backend is unavailable.
- Limit responses use `429` with a safe retry message and `Retry-After` when available.
- Bucket keys are hashed before Redis storage; warning logs avoid request bodies, cookies, tokens, passwords, raw emails, raw user IDs, raw order IDs, Redis URLs, and unhashed bucket keys.
- Stripe webhook routes are not rate-limited.

## Health

### `GET /api/health`

Returns a minimal public-safe health payload for external health checks.

Response:

```json
{
  "status": "ok",
  "service": "thunderstrux"
}
```

The endpoint does not expose secrets, tenant data, database rows, or runtime configuration.

### `GET /api/health/ready`

Returns the same public-safe shape with `status: "ready"` only when the application-table query, required migration, MFA and legacy-access configuration, and enabled Redis dependency are ready. Returns `503` with `status: "unavailable"` on any failure and never exposes the internal reason.

## Operational Logs, Metrics, And Alerts

Thunderstrux emits MVP operational telemetry as structured JSON lines through `console.info`, `console.warn`, and `console.error`.

Log shape:

```json
{
  "level": "error",
  "event": "checkout.session.create_failed",
  "timestamp": "2026-06-27T11:00:00.000Z",
  "service": "thunderstrux",
  "environment": "production"
}
```

Redaction policy:

- Sensitive keys are redacted by default, including cookies, auth headers, tokens, passwords, API keys, secrets, raw request bodies, full payloads, email HTML, and provider secrets.
- Do not log full Stripe payloads, full webhook bodies, email HTML, cookies, auth headers, session tokens, passwords, or provider credentials.
- Log identifiers only when operationally necessary, and prefer route-normalised paths for abuse/security events.

Implemented stable events:

- `ops.alert`
- `ops.metric`
- `stripe.webhook.signature_failed`
- `stripe.webhook.received`
- `stripe.webhook.ignored`
- `stripe_connect.webhook.signature_failed`
- `stripe_connect.webhook.received`
- `stripe_connect.webhook.ignored`
- `checkout.session.create_started`
- `checkout.session.created`
- `checkout.session.create_failed`
- `email_outbox.batch.processed`
- `email_outbox.job.failed`
- `email_outbox.worker.completed`
- `email_outbox.worker.failed`
- `stale_orders.batch.processed`
- `stale_orders.batch.failed`
- `stale_orders.worker.completed`
- `stale_orders.worker.failed`
- `rate_limit.rejected`
- `rate_limit.backend_unavailable`
- `trusted_origin.rejected`

Implemented alert names:

- `paid_but_unfulfilled_compensation_required`
- `stripe_webhook_signature_failure`
- `checkout_session_creation_failure`
- `email_outbox_retry_exhausted`
- `stale_order_worker_failed`
- `checkout_attempt_recovery_failed` (the recovery worker run failed)
- `checkout_attempt_recovery_abandoned` (an attempt stayed uncertain past Stripe's 24-hour idempotency window)
- `app_healthcheck_failed` is reserved for external healthcheck monitoring and is not emitted by app runtime code.
- `db_migration_failed` is reserved for deployment/migration automation and is not emitted by app runtime code.

Alert records use the alert name as the structured `event` field. Operators should query alert names directly, for example `event = paid_but_unfulfilled_compensation_required`.

Implemented metric names are console/log-derived only:

- `stripe_webhook_signature_failures_total`
- `checkout_session_create_failures_total`
- `email_outbox_jobs_failed_total`
- `email_outbox_jobs_sent_total`
- `stale_orders_expired_total`

There is no metrics backend, dashboard, external alert vendor, or automatic paging in the MVP implementation. Production must route these JSON logs through the hosting platform or log aggregator and configure alert rules there.

## Auth And Profile

### `POST /api/auth/signup`

Creates either a member account or an organisation account.

Request:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "accountRole": "member"
}
```

Rules:

- `accountRole` is `member` or `organisation`.
- Old email/password-only requests default to `member`.
- Member signup may include `firstName` and `lastName`.
- Signup returns generic `202 {accepted:true}` for both new and existing normalized emails. It does not return a user DTO or automatically log in. New account/token/encrypted notification creation is atomic; `callbackUrl` is optional and reduced to a safe internal path.
- New passwords are at least 8 characters and at most 72 UTF-8 bytes. Signup/verification issuance require enabled fail-closed Redis (25/IP/hour, 3/email/hour shared issuance budgets).

### Verification

POST `/api/auth/verification/request` accepts `{email, callbackUrl?}` and returns generic `202 {accepted:true}`. POST `/api/auth/verification/confirm` accepts `{token}` and returns `{verified:true, callbackUrl}` or generic invalid/expired-link `400`; IP/token redemption limits are 50/10 per ten minutes. Both require trusted origin, no-store responses and explicit POST. Email/token authority is independent of session cookies; these anonymous endpoints do not require cookie CSRF. Raw tokens travel in email fragments and POST bodies; no GET consumption. Latest token per purpose wins, expires after 24 hours and is single use. Disabled identities, wrong purpose/email/version, expiry, replay and superseded tokens are denied. Protected purchases/joins/bootstrap/invite acceptance require live verified identity; profile/login remain available while unverified.

### Guest access (T16a)

POST `/api/guest/email/request` accepts `{email, callbackUrl?}` and returns a generic `202 {accepted:true}` whatever the address. It creates or reuses the normalised `GuestIdentity`, revokes that identity's unused checkout links (cancelling their queued emails) and queues one encrypted `guest_access` email whose link is `/guest/access#token=…`, valid for 30 minutes and once. Limits fail closed: 20 per IP and 3 per address an hour.

POST `/api/guest/email/confirm` accepts `{token}` and returns `{callbackUrl}` (a safe local path, default `/events`) with an `HttpOnly`, `SameSite=Lax`, path `/` cookie `thunderstrux-guest` (`Secure` in production) holding a random session id for two hours; wrong, replayed, revoked, superseded or expired links get the generic invalid/expired-link `400`. Redemption limits are 50 per IP and 10 per token digest in ten minutes, failing closed. Both endpoints require a trusted origin and send `Cache-Control: no-store`; like account links they use email/token authority, so a stale login cookie does not demand the login CSRF token.

GET `/api/guest/session` returns `{email, expiresAt, csrfToken}` for a live guest session, or `401`; always `no-store`. `csrfToken` is an HMAC of the session id, checked with `verifyGuestCsrf` by guest writes (T16b). A guest session is not a login: it grants no member, staff or account access.

Since T16b a session has a purpose. A `checkout` session (from the checkout email link) can buy tickets and open the orders it bought. A `purchase` session (from a ticket email or recovery link) opens one order. POST `/api/guest/recover` accepts `{email}` and returns a generic `202 {accepted:true}`: for a known guest it revokes unused links for each paid guest order (up to the latest ten; orders a member has claimed are excluded) and queues one encrypted `guest_order_link` email per order, each link valid for 24 hours and once. It shares the fail-closed guest request limits, under its own keys. `/guest/orders/[orderId]` opens only for a session allowed that order; every other case, including a real order id without the session, shows the same "Open your order from your email" page.

POST `/api/guest/orders/[orderId]/claim` (T16c) adds a guest order to the signed-in member's account. It needs a trusted origin, the member's login and its CSRF token, and the guest session that opens the order. It returns `{claimed: true}`, or `{claimed: false}` when the order is already this member's; `401` without a login, `403` for an unverified account, `404` when the guest session does not open the order, and `409` with detail `reason` `email_mismatch` or `already_claimed`. `no-store`.

### `PATCH /api/me/profile`

Completes or updates member onboarding profile fields.

Rules:

- Auth required.
- Member account required.
- Stores first name, last name, and optional useful profile fields.

### `GET /api/security/csrf`

Requires an authenticated session and returns a short-lived token bound to that login. Cookie-authenticated browser mutations send it in the configured CSRF header. The response is never cached.

### Staff MFA routes

- `GET /api/me/mfa/status` returns enrollment and enforcement state for an eligible management user.
- `POST /api/me/mfa/setup` starts encrypted TOTP enrollment and fails closed when Redis rate limiting is unavailable.
- `POST /api/me/mfa/confirm` verifies setup, enables MFA, and returns the one-time recovery-code set.
- `POST /api/me/mfa/verify` accepts a TOTP or unused recovery code and creates a login-bound grant.

All MFA mutations require trusted origin, session CSRF, and the dedicated fail-closed MFA rate-limit policy.

## Dashboard context

- `GET /api/me/context`: live authorized staff organisations, role capabilities and selected context; private/no-store.
- `POST /api/me/context`: strict `{mode:"personal"}` or `{mode:"staff",organisationId}`; session CSRF/trusted origin and live staff permission/MFA for staff selection. Sets a signed login-bound preference; it never grants authority. Member staff start personal on each login.

## Named Staff

- `GET /api/orgs/[orgSlug]/staff` lists staff for callers with staff-management authority.
- `POST /api/orgs/[orgSlug]/staff/invites` creates an expiring invite and audit record.
- `PATCH /api/orgs/[orgSlug]/staff/[staffId]` changes live role/status, prevents removal of the final active owner, and writes an audit record. Only owners may change an owner row or grant owner authority.
- `POST /api/staff/invites/accept` accepts an invite for the authenticated matching user and writes an audit record.

Management decisions use the canonical tenant and live `OrganisationStaff` capability. `OrganisationMember` never grants management access; legacy ownership is available only under the configured migration mode.

## Organisation Search And Join

### `GET /api/public/organisations/search`

Anonymous public-safe discovery: `q` is a literal name/slug substring, trimmed and bounded to 120 characters; `limit` defaults to 25 and accepts 1..50. Forward `cursor` uses name ASC, id ASC and must match the query. Invalid bounds/cursors return 400. Returns `{organisations, pageInfo}` with public name/slug/description excerpt/logo and the next upcoming published event, never personalized joined state, staff, account email or Stripe fields. Public cache lifetime is 60 seconds. `/societies` consumes the shared read service directly.

### `GET /api/orgs/search?q=...`

Searches organisations by name or slug.

Rules:

- Auth required.
- Member account required.
- Returns public-safe organisation fields and whether the member has joined.
- Uses the same bounded literal search and cursor ordering. Default requests preserve `{organisations:[{id,name,slug,joined}]}`; specifying limit or cursor also returns pageInfo. Responses are private/no-store.

### `POST /api/orgs/[orgSlug]/join`

Joins an organisation as a member.

Rules:

- Auth required.
- Member account required.
- Creates or updates an `OrganisationMember` row with role `member`.
- Requires live verified identity, trusted origin/CSRF and existing join/leave rate protection. User then Organisation locks fence session/version/closure races; replay returns success without duplicate relationships.

### `POST /api/orgs/[orgSlug]/leave`

Leaves an organisation as a member.

Rules:

- Auth required.
- Member account required.
- Deletes only the signed-in member account's `OrganisationMember` row for the resolved organisation.
- Organisation accounts cannot use this endpoint.
- If the member is already not joined, the endpoint still returns success.
- Retains trusted origin/CSRF, live identity/version and rate checks. Unverified callers may remove their existing affiliation. Staff authority, other users, paid orders and tickets are unaffected; joins never grant paid entitlements.

## Public Events

### `GET /api/public/events`

Returns published events for public discovery.

Rules:

- No auth required.
- Only `published`, `public` events that have not ended (`endTime` after now) are returned (PUB-001, T15b); drafts, link-only and members-only events never are.
- Response is public-safe.
- Cursor pagination uses stable `startTime ASC, id ASC` ordering.
- Query params:
  - `limit`: optional integer `1..100`, defaults to `25`.
  - `cursor`: optional opaque cursor from `pageInfo.nextCursor` or `pageInfo.previousCursor`.
  - `direction`: optional `next` or `prev`, defaults to `next`.
- Invalid pagination params return structured `400`.
- Each event carries its host society's public `name`, `slug` and IANA `timeZone`, so clients can link to `/societies/[slug]` and show dates in the society's zone. The detail response carries the same three fields.
- Read-only. If no published events exist, returns an empty `events` array instead of creating demo data.

Example response:

```json
{
  "events": [
    {
      "id": "event_id",
      "title": "Event title",
      "startTime": "2026-04-23T10:00:00.000Z",
      "location": "Campus hall",
      "organisation": {
        "name": "Society name",
        "slug": "engineering-society",
        "timeZone": "Australia/Brisbane"
      }
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  }
}
```

### `GET /api/public/events/[eventId]`

Returns public event details.

Rules:

- No auth required.
- Event must be `published` and not `members_only`; link-only (`unlisted`) events are readable by link.
- Includes ticket types with raw `quantity` preserved and advisory `availableQuantity`: since T15a the shared sellable stock, `min(quantity - that type's active holds, capacity - valid issued tickets - all active holds)`, never below 0.
- Each type carries `unavailable`: `sold_out`, `payments_unavailable` (a paid type while the society cannot take payments) or `null`, from the shared readiness rules. The event carries `salesOpen` and `salesCloseAt`, and the society its `supportEmail` and `refundPolicy`. The society's Stripe fields are never included.
- Only active, unexpired reservations reduce public availability.
- Read-only. Does not run stale pending order cleanup or mutate orders/reservations.

Example ticket type shape:

```json
{
  "id": "ticket_type_id",
  "name": "General Admission",
  "price": 1200,
  "quantity": 50,
  "availableQuantity": 42,
  "unavailable": null
}
```

## Organisations

### `GET /api/orgs`

Returns organisations for the authenticated account.

Rules:

- Auth required.
- Uses `session.user.id`.
- Does not trust frontend organisation headers.
- Member accounts receive their OrganisationMember joins. Organisation accounts receive the retained accountUserId-associated society only when legacy mode permits it; deny mode returns an empty list. This compatibility endpoint does not list named staff authority or select a tenant. `/api/me/context` owns live staff selection; personal joined pages use getAccessibleOrganisationsForCurrentAccount.

### `POST /api/orgs`

Creates an organisation.

Request:

```json
{
  "name": "Engineering Society"
}
```

Rules:

- Auth required.
- Organisation account required for initial tenant creation.
- An organisation account can create only one organisation.
- Slug is normalised server-side.
- Slug uniqueness is enforced.
- The created organisation stores `accountUserId`.
- A transitional `org_owner` membership is also created for compatibility.
- An active owner `OrganisationStaff` row is created as the normal management authority.
- Verified identity, trusted-origin/CSRF and fail-closed creation limits are required. User then sorted Organisation locks reject a retained bootstrap association OR active staff authority after pointer retirement; only slug conflicts retry. Organisation, compatibility join, owner and audit commit atomically. Success clears stale context for profile setup; historical revoked rows alone do not block bootstrap.

### `GET /api/orgs/[orgSlug]`

Fetches an organisation by slug.

Rules:

- Auth required.
- A management caller must have live staff access or explicitly enabled legacy access; a member caller must have a membership.

## Events

### `GET /api/events?orgId=...`

Lists events for one organisation.

Rules:

- Auth required.
- `orgId` is required.
- Caller must have live events:manage authority for the resolved tenant, including named member staff or explicitly permitted legacy access; accountRole alone is not authority.
- Returns organisation-scoped events.
- Includes `ticketTypes`.

### `POST /api/events`

Creates an event and ticket types.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Caller needs live events:manage authority for the submitted canonical tenant; organisationId is an input revalidated server-side.
- `startTime` must be before `endTime`.
- Ticket prices are integer cents.
- Ticket quantities must be greater than zero.
- Always creates a `draft` (T11); a submitted `status` is ignored. Publishing goes through `PATCH /api/events/[eventId]/publish`.
- Optional `capacity` (positive integer or null), `visibility` (`public` or `unlisted`; `members_only` is refused until memberships exist) and `salesCloseAt` (defaults to `startTime`, must not be after `endTime`).
- Optional `heroAssetId` (T11b): a ready, undeleted `event` asset of the same society; anything else returns 400 with `path: ["heroAssetId"]`. Times are ISO instants; the dashboard builder converts the society's wall-clock times before sending.
- The created event carries `version: 1`.

### `GET /api/events/[eventId]`

Fetches a dashboard event.

Rules:

- Auth required.
- Caller needs live events:manage authority for orgId and the event's canonical organisation; missing/foreign event reads are concealed.

### `PATCH /api/events/[eventId]`

Updates event fields and synchronises ticket types.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Does not own publish/unpublish status transitions.
- Request must include the `version` the editor loaded. A different current version returns `409 CONFLICT` and nothing is saved; a successful edit increments it.
- Accepts the same optional `capacity`, `visibility`, `salesCloseAt` and `heroAssetId` as create; `heroAssetId: null` removes the image and omitting it keeps the current one. A close time still equal to the old start follows a changed start; an explicit one is kept. Capacity below valid issued tickets plus active holds returns 400.
- Request must include `organisationId`, but the API revalidates organisation ownership and scopes the event server-side.
- Existing ticket types are matched by `id`.
- New ticket types omit `id`.
- Omitted unsold ticket types are deleted.
- Ticket types with existing orders or issued tickets cannot be deleted, but their name, price, and quantity can be edited for future purchases.
- Ticket quantity may be `0` on update because sold-out inventory is valid.
- Ticket quantity must not be negative.
- An existing ticket type must send `expectedQuantity`, the remaining quantity the editor loaded. The edit runs under the event lock (T12): if sales changed the stock since and the submitted quantity is unchanged, the current stock is kept; if both changed, the response is `409 CONFLICT`.
- Remaining quantity cannot drop below that type's active checkout holds (400 on the type's `quantity` field).

Expected request shape:

```json
{
  "organisationId": "organisation_id",
  "title": "Event title",
  "description": "Event description",
  "startTime": "2026-05-06T15:00:00.000Z",
  "endTime": "2026-05-06T17:00:00.000Z",
  "location": "Campus Hall",
  "version": 3,
  "ticketTypes": [
    {
      "id": "existing_ticket_type_id",
      "name": "General Admission",
      "price": 1000,
      "quantity": 0,
      "expectedQuantity": 4
    },
    {
      "name": "New Ticket",
      "price": 1500,
      "quantity": 20
    }
  ]
}
```

Response:

```json
{
  "event": {
    "id": "event_id",
    "organisationId": "organisation_id",
    "title": "Event title",
    "ticketTypes": []
  }
}
```

### `DELETE /api/events/[eventId]`

Deletes an event when permitted by the route handler rules.

### `PATCH /api/events/[eventId]/publish`

Moves an event to an explicit status. Body: `{ "targetStatus": "published" | "draft", "version": 3 }`.

Rules:

- Auth required.
- Event-management role required.
- Asking for the status the event already has returns it unchanged (a retried request cannot flip it back). Otherwise a stale `version` returns `409 CONFLICT`.
- Publishing applies the shared readiness rules in `lib/events/event-readiness.ts`: title, description and location; end after start; a sales close time in the future and not after the end; at least one ticket type with remaining quantity; and at least one type that can be bought now (a free type, or a paid type when the society can take payments). Each blocker comes back as a 400 detail with its field.
- Unpublishing is blocked after orders exist.
- Each change is audited (`event.published`, `event.unpublished`) and increments `version`.

### `PATCH /api/events/[eventId]/sales`

Closes or reopens ticket sales without changing publication. Body: `{ "saleState": "closed" | "open", "version": 3 }`.

Rules:

- Same authority, idempotent same-state behaviour and `409` on a stale version as publish.
- Reopening is refused (400) once `salesCloseAt` has passed.
- Audited as `event.sales_closed` and `event.sales_reopened`. Checkout refuses closed sales with `400` and the message `Ticket sales are closed`.

### `POST /api/events/[eventId]/ticket-types`

Creates a ticket type for an event.

Rules:

- Auth required.
- Event-management role required.
- Price must be non-negative integer cents.
- Quantity must be greater than zero.

### `GET /api/events/[eventId]/tickets`

Lists issued tickets for one organiser-owned event with cursor pagination.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Live tickets:check_in permission required for the current organisation.
- The event must belong to the organisation owned by `session.user`.
- Access is resolved server-side; the frontend does not provide trusted organisation ownership.
- Returns actual `Ticket` rows only.
- Default page size is 25.
- Maximum page size is 100.
- Ordering is stable by `Ticket.createdAt ASC, Ticket.id ASC`.

Query params:

- `limit`: optional integer from 1 to 100.
- `cursor`: optional opaque cursor returned by `pageInfo.nextCursor` or `pageInfo.previousCursor`.
- `direction`: optional, either `next` or `prev`; defaults to `next`.
- `q`: optional search, 2 to 100 characters, by name, email, order or ticket reference (T19b). A search also returns void and under-review tickets.

Since T19b each ticket also carries `checkedInBy`, `validity`, `validityReason`, `validityChangedAt`, `issueSequence`, `orderQuantity` and `guest`. Errors map through `mapRouteError`.

Response:

```json
{
  "event": {
    "id": "event_id",
    "title": "Event title"
  },
  "tickets": [
    {
      "id": "ticket_id",
      "status": "unused",
      "createdAt": "2026-05-03T10:00:00.000Z",
      "checkedInAt": null,
      "ticketTypeName": "General Admission",
      "orderId": "order_id",
      "buyerEmail": "buyer@example.com",
      "buyerName": "Buyer Name"
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  },
  "counts": {
    "total": 1,
    "unused": 1,
    "checkedIn": 0
  }
}
```

Status:

- `401` unauthenticated.
- `403` insufficient live authority/capability or required MFA.
- `400` malformed `limit`, `cursor`, or `direction`.
- `404` event missing or not owned by the current organisation.

## Tickets

### `POST /api/tickets/[ticketId]/check-in`

Marks one issued ticket as checked in.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Live tickets:check_in permission required for the current organisation.
- Ticket.event.organisationId must match the caller's authorised tenant; denormalized ticket ownership is not authority.
- Ticket.checkedInAt and an actor-attributed AuditLog entry update atomically; payment and ticket ownership are unchanged.
- Already checked-in tickets are rejected and the original timestamp is preserved.
- Does not modify order status, Stripe state, ticket ownership, or ticket type data.

Success response:

```json
{
  "ticket": {
    "id": "ticket_id",
    "status": "checked-in",
    "checkedInAt": "2026-05-03T10:05:00.000Z"
  }
}
```

Status:

- `401` unauthenticated.
- `403` insufficient live authority/capability or required MFA.
- `404` ticket missing or not owned by the current organisation.
- `409` with detail `reason`: `already_checked_in`, `not_valid` (void) or `under_review` (disputed). Since T19b a void or under-review ticket is refused with its reason rather than as missing.

### `POST /api/tickets/[ticketId]/check-out`

Reverses check-in for one issued ticket.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Live tickets:check_in permission required for the current organisation.
- Ticket.event.organisationId must match the caller's authorised tenant; denormalized ticket ownership is not authority.
- Ticket.checkedInAt and an actor-attributed AuditLog entry update atomically; payment and ticket ownership are unchanged.
- Only checked-in tickets can be checked out.
- Does not modify order status, Stripe state, ticket ownership, or ticket type data.

Success response:

```json
{
  "ticket": {
    "id": "ticket_id",
    "status": "unused",
    "checkedInAt": null
  }
}
```

Status:

- `401` unauthenticated.
- `403` insufficient live authority/capability or required MFA.
- `404` ticket missing or not owned by the current organisation.
- `409` with detail `reason`: `not_checked_in`, `not_valid` or `under_review`.

## Orders

### `GET /api/orders?status=...&eventId=...&includeSystem=...&search=...&startDate=...&endDate=...&limit=...&cursor=...&direction=...`

Returns a bounded page of organisation-scoped orders grouped by event.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Finance access required.
- Read-only. Does not run stale pending order cleanup before returning grouped orders.
- Stale pending orders are expired by the scheduled stale-order worker; checkout still performs local authoritative cleanup before reservation creation.
- Normal `status` values are `all`, `paid`, `expired`, or `failed`.
- `pending` is an internal system status and is accepted only when `includeSystem=true`.
- Default `all` excludes `pending`.
- `eventId` is optional.
- When `eventId` is present, the API verifies the event belongs to the authorised management user before filtering.
- Returned orders are authorised through `Order.event.organisationId`; `Order.organisationId` is denormalized storage and is not the access source of truth.
- `search` filters buyer email.
- `startDate` and `endDate` filter by order `createdAt`.
- Pagination is cursor-based using stable `(createdAt, id)` ordering.
- `limit` defaults to `25` and must be between `1` and `100`.
- `direction` is `next` or `prev`.
- Invalid pagination params return structured `400`.
- Groups are page-local; they do not imply complete event totals across all matching orders.
- Member accounts without live staff authority cannot access this endpoint.

Response:

```json
{
  "groups": [
    {
      "eventId": "event_id",
      "eventTitle": "Event title",
      "orders": [
        {
          "id": "order_id",
          "status": "paid",
          "projection": "paid",
          "ticketType": "General Admission",
          "quantity": 2,
          "totalAmount": 2400,
          "createdAt": "2026-04-29T10:00:00.000Z",
          "paidAt": "2026-04-29T10:05:00.000Z",
          "failedAt": null,
          "failureReason": null,
          "buyerEmail": "buyer@example.com"
        }
      ]
    }
  ],
  "pageInfo": {
    "limit": 25,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "nextCursor": null,
    "previousCursor": null
  }
}
```

### `GET /api/orders/[orderId]`

Returns a safe organiser order detail payload.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Finance access required.
- The order must belong to an event owned by the authorised organisation.
- Ownership is checked through `Order.event.organisationId`.
- Pending orders are not exposed through normal organiser UI.
- Unit price, total amount and ticket type name come from the order snapshot, not the current ticket type. Orders created before T10 did not record the name; their `purchasedTicketType` is today's name followed by `(historical label unavailable)`.

Includes:

- order id, status, createdAt, paidAt, failedAt, failureReason
- compensation-review fields when paid local fulfilment failed
- buyer email and name when available
- event id/title
- ticket line with the purchased ticket type name (`purchasedTicketType`), quantity, unit price, and total amount
- `paymentKind` (`stripe` or `free`) and `projection`, the displayed status (`processing`, `paid`, `free`, `review`, `failed`, `expired`)
- issued ticket ids
- Stripe session id
- manual refund and ticket email tracking fields

The server-rendered organiser order detail page also reads a separate, bounded lifecycle timeline. It is not included in this API payload. History pages use `historyCursor=<sequence>` and `historyDirection=older|newer`, with 25 events per page and the same event-owned tenant boundary.

### `POST /api/orders/[orderId]/refunds`

Refunds the whole order through Stripe (T18a). Body `{reason, confirmation, mfaCode?}`: a reason of 8 to 500 characters, the order's short reference typed back, and a fresh authenticator code unless staff MFA is off. Requires the current society's `orders:refund` (owners and finance managers) and a trusted origin with the CSRF token. Answers `200 {refundRequestId, status: "succeeded"}` when Stripe confirmed, or `202` with `status` `pending` or `uncertain`. Refusals: `400` with detail `confirmation` for a wrong reference or `mfaCode` for a wrong code; `404` for another society's or a missing order; `409` with detail `reason` `not_refundable`, `in_progress`, `already_refunded`, `disputed`, `verification_failed` or `provider_refused`. After a partial refund made in Stripe it refunds the remainder. See [[Payment Lifecycle]].

### `POST /api/payments/checkout/membership` and `POST /api/payments/checkout/merchandise`

Commerce checkout (T21). Body `{organisationId, selection, expectedTotal, idempotencyKey}`: `selection` is checked by the family's own schema, `expectedTotal` is the total in cents the buyer was shown, and `idempotencyKey` follows the ticket rule (16 to 128 letters, digits, `-` or `_`). Requires a trusted origin and a signed-in verified member account; merchandise also accepts a guest's live checkout session with its CSRF header. The checkout rate limit applies. Answers `200 {kind: "stripe", url}`, `200 {kind: "fulfilled", commerceOrderId}` for a free total or a finished replay, or `202 {attemptId, status: "processing"}` while Stripe's answer is confirmed (poll `GET /api/payments/checkout/attempts/[attemptId]`, which now also answers commerce attempts). Refusals: `404` while the family is not on sale (no family is registered before T22 and T27); `400` for a non-member, a guest buying a membership, a society that can't take payments or an invalid selection; `409` for a changed total, the same key with another selection, or a purchase the family can no longer honour; `503` when Stripe is not configured. See [[Payment Lifecycle]].

### `GET /api/commerce/orders/[orderId]`

One membership or merchandise order (T20). Requires a signed-in account (`401` otherwise). The buyer gets `{view: "buyer", order}`: family, status, payment kind, currency, total, seller name and support email, lines (number, name, variant, quantity, unit and line amounts, membership term) and a history of types and times, with no buyer contact, fee or provider ids. Staff of the current society with `orders:read` get `{view: "finance", order}`, adding the buyer snapshot, fee and fee policy, guest flag, Stripe references, review reason, paid and failed facts, and the full history with actors. A ticket order id, another member's order and another society's order are the same `404`. `no-store`.

### `GET /api/purchases/tickets/[orderId]/status`

The status of the caller's own ticket order, for the payment return page to poll (T19a). Answers `200 {status}` (the order projection: `processing`, `paid`, `free`, `review`, `refund-processing`, `refunded`, `disputed`, `cancelled`, `failed` or `expired`) only to the member who bought it or a guest session allowed to open it (`canOpenGuestOrder`); everyone else, including an anonymous caller with a real order id, gets the same `404`. `no-store`. It never changes the order: only the signed webhook fulfils.

### `POST /api/orders/[orderId]/cancel`

Cancels a confirmed free registration (T18c). Body `{reason, mfaCode?}`: a reason of 8 to 500 characters and a fresh authenticator code unless staff MFA is off. Requires the current society's `orders:refund` and a trusted origin with the CSRF token. Answers `200 {status: "cancelled", cancelledAt}`, or `200 {status: "already_cancelled", cancelledAt}` for a repeat. Refusals: `400` for a short reason or with detail `mfaCode` for a missing or wrong code; `404` for another society's or a missing order; `409` with detail `reason` `not_cancellable` for a paid, pending or unfulfilled order. Moves no money and restores no stock. See [[Payment Lifecycle]].

### `POST /api/orders/[orderId]/review`

Staff decisions after Stripe reports a dispute or a refund made outside Thunderstrux (T18b). Neither moves money. Requires the current society's `orders:refund` and a trusted origin with the CSRF token. Body `{action: "restore_tickets", reason}` (8 to 500 characters) restores the tickets of a dispute Stripe closed in the society's favour; `{action: "mark_reviewed"}` records that a partial outside refund was reviewed (repeating it is a no-op). Answers `200 {ok: true}`; `400` for a short reason; `404` for another society's or a missing order; `409` with detail `reason` `not_allowed` when there is no won dispute or partial refund to act on.

### `PATCH /api/orders/[orderId]/refund-manual`

Sets the local manual refund flag on an organiser-owned order. Since T18a it reads "Refund recorded outside Thunderstrux": bookkeeping only, no money moves, and it is refused while the order has a Thunderstrux refund.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Finance access required.
- The order must belong to an event owned by the authorised organisation.
- This is internal bookkeeping only.
- Does not call Stripe.
- Does not change Stripe payment state.
- Does not change order `status`.
- Appends an actor-attributed `manual_refund_marked` lifecycle event on the first state change.

### `POST /api/orders/[orderId]/resend`

Queues ticket delivery email again for a paid organiser-owned order.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Finance access required.
- The order must belong to an event owned by the authorised organisation.
- Order must be `paid`.
- Queues a manual `EmailOutbox` job even when `ticketEmailSentAt` is already set.
- Returns queued semantics; provider delivery runs from the outbox worker.
- On worker success, updates `Order.ticketEmailResentAt` and clears `Order.ticketEmailLastError`.
- On worker failure, updates `Order.ticketEmailLastError`.
- Does not modify order payment state, Stripe state, ticket ownership, or ticket check-in state.
- Appends an actor-attributed manual `email_enqueued` lifecycle event.

Status:

- `400` unpaid order.
- `401` unauthenticated.
- `403` insufficient live staff authority, finance permission or required MFA.
- `404` order missing or not owned by the current organisation.

### `POST /api/orders/[orderId]/email-jobs/[jobId]/requeue`

Requeues one terminal failed email job for an order in the caller's canonical tenant. Requires live finance authority, trusted origin, session CSRF, and an actor-attributed audit/lifecycle entry. It never changes payment or ticket state.

### `POST /api/orders/[orderId]/compensation-refund/confirm`

Confirms a manual compensation refund only after retrieving and verifying matching Stripe refund evidence for the order, job, amount, currency, PaymentIntent, and charge. Requires live finance authority, trusted origin, session CSRF, and writes fenced lifecycle/audit evidence. It cannot be used as an unverified local refund marker.

## Payments

### `POST /api/payments/checkout/event`

Starts a ticket purchase. The locked price decides the path: a free type is registered and fulfilled in the same transaction (T13); a paid type gets a Stripe Checkout Session. The dashboard reaches it from the checkout page `/events/[eventId]/checkout`.

Request:

```json
{
  "eventId": "event_id",
  "ticketTypeId": "ticket_type_id",
  "quantity": 1,
  "expectedUnitPrice": 1200,
  "idempotencyKey": "client-generated-per-purchase-intent"
}
```

Rules:

- A verified member account, or (T16b, no login cookie) a live guest `checkout` session from the `thunderstrux-guest` cookie with its `x-thunderstrux-guest-csrf` token; a missing or ended guest session is `401`, a wrong token `403`. A guest order has no `userId`; it records `guestIdentityId`, the guest's email as the buyer snapshot and provenance `verified_guest`, and the attempt's actor is the guest session (`actorKind: guest`).
- Event must be published.
- Ticket type must belong to event.
- Organisation is resolved server-side from the event.
- Paid types: the organisation must be Stripe-ready; checkout creates a pending `Order` and an active `TicketReservation`.
- Free types: no Stripe configuration is read and nothing is held. One transaction creates a fulfilled `Order` (`paymentKind: free`, `status: paid`, total and fee 0), its tickets, one stock decrement, the `order_created` and `free_fulfilled` lifecycle events and the automatic ticket email. If the email cannot be queued, nothing is created.
- Uses 30-minute reservation expiry and sets Stripe Checkout `expires_at` to match.
- Sets success URL to `/success?session_id={CHECKOUT_SESSION_ID}`, which shows the member's order as it really stands (and, outside production only, runs the dev fallback); for a guest, to `/guest/orders/[orderId]`, which only their session opens. The cancel URL is `/cancel?order={orderId}`, which names the order only to its buyer (T19a).
- Since T12 every rule is checked under the buyer, event and ticket type locks: publication, sale state and close time, the shared readiness eligibility, and sellable stock = min(remaining minus that type's active holds, capacity minus valid issued tickets and all active holds).
- `quantity` is 1 to 10 per order.
- `idempotencyKey` (16–128 letters, digits, `-` or `_`) identifies one purchase intent. Repeating it with the same selection returns the same checkout; with a different selection it is `409 CONFLICT`.
- Responses: `200 { kind: "stripe", url }` to redirect to Stripe; `200 { kind: "fulfilled", orderId }` for a free registration, or a replay of a checkout whose order is already fulfilled; or `202 { attemptId, status: "processing" }` when Stripe's answer is not known yet (the order and hold are kept).
- `expectedUnitPrice` is the unit price in cents the buyer was shown. If the locked price differs, the response is `409 CONFLICT` with a `expectedUnitPrice` detail naming the new price, and no order or hold is created.
- Every checkout refusal detail carries `reason`, the refusal kind (`sales_closed`, `sold_out`, `stripe_not_ready`, `quote_changed`, `insufficient_availability`, `event_draft`, `idempotency_conflict`). The `quote_changed` detail adds `value`, the new unit price in cents; the `insufficient_availability` detail (400, path `quantity`) adds `value`, the tickets still sellable. Clients choose what to show from `reason` and `value`, never from `message`.

### `GET /api/payments/checkout/attempts/[attemptId]`

Status of the caller's own checkout attempt, for polling after a 202. A signed-in member, or a guest whose checkout session made the attempt; another actor's or a missing attempt is the same 404. `no-store`.

Response: `{ attemptId, status }` where status is `ready` (with `url`), `processing`, `completed` (with `orderId`) or `failed`.

### `POST /api/payments/webhook`

Stripe Checkout webhook.

Handles:

- `checkout.session.completed`
- `checkout.session.expired`
- `refund.created`, `refund.updated`, `refund.failed`: dispatched to ordinary refunds (`refundRequestId`), compensation (`compensationRefundJobId`) or, with neither, a refund made outside Thunderstrux (T18b)
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` (T18b)
- Since T21 a `checkout.session.*` event whose Session carries `family` (`membership` or `merchandise`) goes to commerce reconciliation; anything else stays a ticket event, except a commerce order's Session without a family, which is ignored with an alert.

See [[Payment Lifecycle]] for how refund, dispute and commerce events are verified and projected.

Responsibilities:

- Verify signature.
- Use the raw request body from `request.text()`.
- Reconcile against local order.
- Reduce inventory.
- Confirm or release the related reservation.
- Create tickets.
- Mark order paid.
- Store `paidAt` on success.
- Persist compensation-review state when Stripe confirms payment but local ticket fulfilment cannot complete.
- Enqueue automatic ticket delivery email only after successful payment fulfilment and ticket issuance.
- Store `ticketEmailSentAt` after automatic outbox worker success.
- Store `ticketEmailLastError` on worker failure.
- Do not enqueue duplicate automatic email jobs on duplicate webhook delivery.
- Mark normal reservation or Checkout expiry as `expired` without `failureReason`.
- Store `failedAt` and `failureReason` only on unexpected reconciliation failure.
- Reject metadata/session identities that resolve to different orders without mutating either order and emit `payment_reconciliation_ambiguous_order`.
- Append typed business transitions to `OrderLifecycleEvent`; duplicate webhook delivery must not append duplicate state changes.
- Do not issue tickets or send ticket email for compensation-required orders.
- Return `200` for signed but unhandled Stripe event types.

Automatic EmailOutbox insertion is part of the fulfilment transaction; failure rolls fulfilment back. Provider/worker failure after commit does not reverse payment, inventory, reservations or tickets.

## Server-Rendered Order Views

### `GET /tickets`

Buyer-facing authenticated page.

Rules:

- Auth required.
- Reads orders by `session.user.id`.
- Shows paid orders only.
- Pending, expired, and failed orders are internal/system history and are not shown in the member ticket wallet.
- Shows ticket identifiers when tickets exist.
- Cursor-paginated using stable `(createdAt, id)` ordering.
- `limit` defaults to `25` and must be between `1` and `100`.
- `cursor` is an opaque value from the Previous/Next links.
- `direction` is `next` or `prev`.
- Invalid pagination params render the first page with a visible non-blocking warning.

### `GET /dashboard/orders`

Organiser-facing authenticated dashboard page.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Finance access required.
- Reads orders scoped through events owned by the authorised organisation.
- Supports optional `eventId` and status filtering.
- Default view excludes internal pending orders.
- `Show system orders` exposes pending orders for debugging.
- Shows event-scoped order headers when filtered by event.

Legacy `/dashboard/[orgSlug]/orders` redirects to `/dashboard/orders` when the authorised management user owns the slug.

## Stripe Connect

### `POST /api/stripe/connect/onboard`

Creates or reuses a Stripe Express account and returns an onboarding link.

Rules:

- Auth required.
- Active staff authority or explicitly enabled legacy authority required.
- Caller needs live stripe:manage capability and staff MFA for the resolved organisation, regardless of account role.
- Organisation is resolved server-side from `organisationId`.
- Existing `stripeAccountId` is reused and a fresh onboarding link is generated; a newly created account is audited as `stripe_connect.account_created`.
- Since T17 all four Connect routes use the central mapper (`lib/stripe/http.ts`): a missing or unreachable tenant is the same 404, and an unexpected provider failure is a generic 500 that never echoes Stripe's text.
- Detects incomplete Stripe platform setup and returns `PLATFORM_NOT_READY` instead of raw Stripe text.

Response:

```json
{
  "url": "https://connect.stripe.com/setup/..."
}
```

Platform-not-ready response:

```json
{
  "state": "PLATFORM_NOT_READY",
  "message": "Stripe platform setup incomplete",
  "actionRequired": "Complete Stripe Connect platform profile",
  "actionUrl": "https://dashboard.stripe.com/settings/connect/platform-profile"
}
```

Status:

- `200` with `{ "url": "..." }` when onboarding can continue.
- `409` with `PLATFORM_NOT_READY` payload when Stripe blocks account creation because platform setup/profile is incomplete.

### `GET /api/stripe/connect/status?organisationId=...`

Retrieves and persists connected account status.

Rules:

- Auth required.
- Live stripe:manage authority and staff MFA required for the target, including authorised named member staff; client organisationId is not authority.
- Calls `stripe.accounts.retrieve`.
- Updates organisation Stripe flags.
- Maps Stripe account fields into a Thunderstrux lifecycle state.

Lifecycle states:

- `NOT_CONNECTED`: no `stripeAccountId`.
- `PLATFORM_NOT_READY`: Stripe platform profile is incomplete and Express account creation is blocked.
- `CONNECTED_INCOMPLETE`: account exists but `details_submitted` is false.
- `RESTRICTED`: details submitted but `charges_enabled` is false.
- `READY`: `charges_enabled` is true.
- `ERROR`: Stripe API failure. The last known flags are kept and returned, with `error: "Thunderstrux couldn't reach Stripe to refresh this account."`.

A connected status also includes `openObligations`: orders that still depend on the account and block disconnect.

Persists:

- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeDetailsSubmitted`
- `stripeAccountStatus`

### `POST /api/stripe/connect/continue`

Creates a fresh onboarding link for an existing connected account.

Rules:

- Auth required.
- Organisation account ownership required.
- Organisation must already have `stripeAccountId`.

### `POST /api/stripe/connect/disconnect`

Disconnects the Stripe account locally.

Request: `{ "organisationId": "...", "mfaCode": "123456" }`; `mfaCode` is required unless staff MFA is `off`.

Rules:

- Auth required; live stripe:manage authority and staff MFA for the target, then the Connect rate limit, then the staff verification limit when a code is sent.
- A missing code is `400` (`path: ["mfaCode"]`); a wrong or reused code is `400`; no enrolled authenticator is `403`.
- `409 CONFLICT` while orders still depend on the account (pending, under compensation review, or with an unresolved compensation refund); the message names the count.
- Clears local Stripe fields on the organisation and writes `stripe_connect.disconnected`.
- Does not delete or modify the account inside Stripe.
- Also clears `PLATFORM_NOT_READY` back to `NOT_CONNECTED`.

Response:

```json
{
  "disconnected": true,
  "status": {
    "state": "NOT_CONNECTED",
    "connected": false,
    "ready": false
  }
}
```

### `POST /api/stripe/connect/webhook`

Stripe Connect webhook.

Handles:

- `account.updated`

Responsibilities:

- Verify signature.
- Persist account status flags on the matching organisation.

## General Notifications

GET `/api/notifications?cursor=...` returns a private 25-job page of failed business notifications and `nextCursor`. Live current-tenant `orders:email_resend` authority is required; security jobs, recipients and encrypted payloads are excluded. Invalid cursor returns 400. POST `/api/notifications/[jobId]/requeue` accepts strict `{ reason }` (8 to 500 characters), requires trusted origin/session CSRF and resend rate limits, conceals foreign/security targets as 404 and returns `{ queued: true }`. Ineligible or changed jobs return 409; an audit is committed with the queue update. `/dashboard/notifications` uses the same scoped read service.

## Account Recovery And Settings

| Route | Authority and result |
| --- | --- |
| POST `/api/auth/password/request` | Trusted origin, required Redis IP/email limits; strict email/callback input; generic 202 `{accepted:true}`. |
| POST `/api/auth/password/confirm` | Trusted origin, required IP/token-digest limits; explicit token/newPassword; 200 `{reset:true,callbackUrl}` or generic invalid/expired 400; no login. |
| GET `/api/me/account` | Active matching-version session; private no-store selected profile/MFA/security-events DTO; 401 for stale sessions. |
| PATCH `/api/me/profile` | Existing member contract plus locked session-version recheck; profile fields only. |
| POST `/api/me/account/password` | Trusted origin/session CSRF, live matching-version session, required five/hour account limit, current password and enrolled MFA; 200 `{changed:true,signInRequired:true}`. |

Reset/signup/verification anonymous exceptions are exact paths and never authorize protected mutations. New password validation rejects more than 72 UTF-8 bytes. Security ledgers/notifications are private to the account and are never included in tenant notification or audit listings.

## Email Change

POST `/api/me/account/email/request` accepts strict `{currentPassword,newEmail}` and returns generic 202 `{accepted:true}`. POST `/api/me/account/email/confirm` accepts `{currentPassword,token}`, adds required IP/token-digest redemption limits, and returns `{changed:true,signInRequired:true}`. POST `/api/me/account/email/cancel` accepts `{currentPassword}` and returns `{cancelled:true}`. All require live matching-version authentication, trusted origin/session CSRF, required account limits and enrolled MFA. Invalid/expired/foreign/occupied-address confirmation is a generic 400; revoked sessions are 401. GET `/api/me/account` adds private `pendingEmailChange:{email,expiresAt}|null`, excluding raw tokens/digests.

## Permanent Account Closure

GET /api/me/account/closure requires a live matching-version account and returns private, no-store {eligible,blockers}, containing no foreign account information. It is advisory: POST rechecks eligibility under account/order locks. POST accepts strict {currentPassword,acknowledgement:"CLOSE MY ACCOUNT"}, requires trusted origin/session CSRF, live authentication, fail-closed account limits and any enrolled login MFA. Successful closure returns 200 {closed:true,signInRequired:true}; blockers return 409, input 400, password/MFA denial 403, stale/disabled sessions 401 and unavailable required Redis 503. The transaction anonymises login/editable profile, retains business identity and revokes credentials/authority with a private notice. Permanent closure is not a deletion of business, attendance, audit/security or retained buyer records.

## Staff invitation lifecycle

`POST /api/orgs/[orgSlug]/staff/invites` accepts strict `{email, role}` and returns `{invite}` metadata (201), never a raw token or URL. Owner/admin staff management, verified identity, staff MFA, trusted origin/session CSRF and required Redis quotas apply: actor/tenant 20 per hour and tenant/address 3 per hour. `POST .../invites/[inviteId]/resend` and `/revoke` accept strict `{}` and return metadata; resend rotates token/version. Owner invitations require an owner. Foreign or unavailable invite IDs disclose no token/status. GET staff listing is private/no-store and bounded to 100 staff and 100 pending invitations.

`POST /api/staff/invites/accept` accepts strict `{token}` (43 base64url characters). Trusted origin/session CSRF, required IP 50/10-minute and digest 10/10-minute limits precede verified identity and transactional authority checks. Success returns `{inviteId, staff, alreadyAccepted}` with private/no-store headers. Active roles are preserved; repeat acceptance never restores revoked access. Wrong identity, expiry, revocation, obsolete version or lost issuer authority cannot create access. `/staff/invites/accept#token=...` is the public, explicit acceptance UI; GET is inert.

## Owner handover

`POST /api/orgs/[orgSlug]/staff/handover` accepts strict `{incomingStaffId, outgoingAccess: "admin" | "revoked", currentPassword, acknowledgement: "HAND OVER OWNERSHIP"}`. Trusted origin/session CSRF, verified identity, live owner permission/staff MFA and the required actor account-security quota (5/hour) apply. The transaction rechecks current password, enrolled-login MFA (including off mode), live ownership and eligible target; enforce requires both enrollments. Success returns `{handedOver, incomingStaffId, outgoingAccess, legacyOwnershipRetired}` with private/no-store headers. Wrong password is 400; stale identity 401; authority/MFA denial 403; foreign/self/missing/ineligible targets and concurrent pointer changes are concealed by a generic 409. Admins cannot hand over. Accepted handover replay by the outgoing non-owner cannot repeat the mutation or audit.
