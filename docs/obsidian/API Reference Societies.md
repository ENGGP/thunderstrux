---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[API Reference]]", "[[API Reference Commerce]]", "[[Event Lifecycle]]", "[[Ticket Check-in Implementation]]", "[[Society Profiles and Assets]]", "[[Memberships and Merchandise]]"]
sources: [app/api/orgs, app/api/events, app/api/tickets, app/api/public, app/api/staff/invites/accept/route.ts, app/api/merchandise/quote/route.ts, lib/organisations/http.ts, lib/events/http.ts, lib/tickets/http.ts, lib/memberships/http.ts, lib/merchandise/http.ts, lib/staff/invite-http.ts]
---

# API Reference Societies

**Owns:** the request and response contract of society, staff, profile, asset, calendar, event, attendance, public-read and catalogue routes. Shared conventions (error envelope, pagination, 401/403/404 meaning) are in [[API Reference#Conventions]].
**Read when:** calling or changing one of these routes.
**Not here:** guard order and rate numbers ([[Route Security Inventory]]); event rules ([[Event Lifecycle]]); check-in behaviour ([[Ticket Check-in Implementation]]); profile and image rules ([[Society Profiles and Assets]]); plan and product rules ([[Memberships and Merchandise]]); order actions ([[API Reference Commerce]]).

## Code

| Concern | Where |
| --- | --- |
| Slug routes: sign-in, slug, permission | `lib/organisations/http.ts`: `organisationActor`, `organisationError` (unknown slug and no role are one 404) |
| Event routes' errors | `lib/events/http.ts`: `eventRouteRules` |
| Ticket routes' errors | `lib/tickets/http.ts`: `ticketRouteRules` |
| Plan and product helpers | `lib/memberships/http.ts`: `planMutation`, `planRead`; `lib/merchandise/http.ts`: `productMutation`, `productRead` |
| Invitation helpers | `lib/staff/invite-http.ts`: `manageStaffInviteRequest`, `invitationIssuanceLimits`, `staffInviteFailure` |

## Societies and joining

| Route | Auth, bucket | Body / query | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `GET /api/orgs` | session | — | `{organisations: [{id, name, slug, createdAt, role}]}` | members: their joins. Organisation accounts: the legacy-pointer society as `org_owner`, only while it still gives them a live role. Never lists named staff authority (`GET /api/me/context` does) |
| `POST /api/orgs` | verified `organisation` account; `organisation_create` | `lib/validators/orgs.ts:createOrganisationSchema` (`name`, optional `slug`) | 201 `{organisation}`; deletes the context cookie | 400 slug can't be made or stays taken (`path: ["slug"]`; only slug conflicts retry); 403 wrong account kind, unverified, or an existing pointer or active staff authority. One transaction: society, compatibility `org_owner` join, owner `OrganisationStaff`, audit `organisation.created` |
| `GET /api/orgs/search` | `member` account | `q` (literal name or slug substring, at most 120), `limit` 1 to 50 (default 25), forward `cursor` bound to the query | `{organisations: [{id, name, slug, joined}]}`, plus `pageInfo` when `limit` or `cursor` was sent | 400 bad bounds or cursor; 403 organisation account |
| `GET /api/orgs/[orgSlug]` | any live staff role, or a member's join | — | `{organisation: {id, name, slug, createdAt, role}}` | 404 otherwise |
| `POST /api/orgs/[orgSlug]/join` | verified `member`; `organisation_join_leave` | none | `{organisation: {id, name, slug, joined: true}}` | 403 unverified or organisation account; 404 unknown slug. Upserts an `OrganisationMember` (`member`) under User then Organisation locks; a replay succeeds without a duplicate. No paid entitlement, no staff authority |
| `POST /api/orgs/[orgSlug]/leave` | `member` (unverified allowed); `organisation_join_leave` | none | `{organisation: {…, joined: false}}` | deletes only the caller's join row; succeeds when not joined. Staff rows, orders and tickets are untouched |

## Profile, assets and calendar

| Route | Auth, bucket | Body / query | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `GET /api/orgs/[orgSlug]/profile` | `organisation:settings` +MFA | — | `{profile}` | `private, no-store` |
| `PATCH /api/orgs/[orgSlug]/profile` | same; `organisation_profile` | `lib/organisations/profile.ts:profileSchema` (strict; includes `expectedProfileVersion`, nullable `logoAssetId`/`coverAssetId`, `timeZone`), read with an 80 KB cap | `{profile}` | 413 too large, 400 bad JSON or field, 409 stale version (nothing saved). Audit `organisation.profile_updated` |
| `POST /api/orgs/[orgSlug]/assets?kind=` | `logo`/`cover`: `organisation:settings`; `event`: `events:manage`; `product`: `merchandise:manage` (+MFA); `asset_upload` (actor and tenant buckets) | one multipart image | 201 `{asset}` | 400 bad kind or image, 413 over 5 MiB, 429 storage quota, 503 storage unverifiable. Audit `asset.uploaded` |
| `GET /api/orgs/[orgSlug]/assets/[assetId]` | the asset kind's permission +MFA | — | the stored bytes (private preview) | 404 unknown image (after authentication). `private, no-store` |
| `DELETE /api/orgs/[orgSlug]/assets/[assetId]` | same; `asset_delete` | none | `{deleted: true}` | 409 still referenced or still uploading; 404. Audit `asset.deleted` |
| `GET /api/orgs/[orgSlug]/calendar?from=&to=` | `events:read` +MFA | `from`, `to`: real `YYYY-MM-DD` days in the society's zone, at most 93 days (`maxCalendarDays`) | `{from, to, timeZone, events, truncated, membershipEnds}` (events capped at 500) | 400 bad range (`path: ["from"]`); drafts only with `events:manage`; `membershipEnds` only with `members:read`. `private, no-store` |

Profile errors and asset errors use the envelope with their own status. Formats, quotas and recovery: [[Society Profiles and Assets]].

## Staff

All answer `private, no-store`. Responses carry invitation metadata only, never a token or link. An unknown slug is 404; a society where the caller has no role is 403 "Organisation not found or access denied" (these routes use `organisationAccessRule`, not the slug helper).

| Route | Auth, bucket | Body | Success | Errors and effects |
| --- | --- | --- | --- | --- |
| `GET /api/orgs/[orgSlug]/staff` | `staff:manage` +MFA | — | `{staff, invites}` (at most 100 of each) | 404 unknown slug |
| `PATCH /api/orgs/[orgSlug]/staff/[staffId]` | `staff:manage` +MFA | `lib/validators/staff.ts:updateStaffSchema` (`role` and/or `status` `active`/`revoked`) | `{staff}` | 404 missing, 401 stale, 409 would leave no active owner or activate a disabled account, 403 an owner row or owner grant by a non-owner. Audit `staff.updated`; revoking also revokes their pending invites to the society |
| `POST /api/orgs/[orgSlug]/staff/invites` | verified, `staff:manage` +MFA; `staff_invite_actor`, `staff_invite_email` | strict `{email, role}` | 201 `{invite}` | 403 owner invite by a non-owner. Encrypted `staff_invite` email (seven days). Audit `staff.invite.created` |
| `POST /api/orgs/[orgSlug]/staff/invites/[inviteId]/resend` | same; both invite buckets | strict `{}` | `{invite}` | 400 "Invitation is unavailable" for a foreign or unusable id. Rotates token and version, replaces the issuer, cancels older emails. Audit `staff.invite.resent` |
| `POST /api/orgs/[orgSlug]/staff/invites/[inviteId]/revoke` | same; `staff_invite_actor` | strict `{}` | `{invite}` | as resend. Cancels pending delivery. Audit `staff.invite.revoked` |
| `POST /api/staff/invites/accept` | verified invitee; `account_token_ip`, `account_token_digest` | `lib/validators/staff.ts:acceptStaffInviteSchema` (43 base64url characters) | `{inviteId, staff, alreadyAccepted}` | 400 wrong identity, expired, revoked or superseded (one message), 409 conflict. Keeps an existing active role; never restores revoked access. Audit `staff.invite.accepted`. The page `/staff/invites/accept#token=…` posts it; a GET does nothing |
| `POST /api/orgs/[orgSlug]/staff/handover` | verified owner +MFA; `account_security_change` | `lib/validators/staff.ts:staffHandoverSchema` (`incomingStaffId`, `outgoingAccess` `admin`/`revoked`, `currentPassword`, `acknowledgement: "HAND OVER OWNERSHIP"`) | `{handedOver: true, incomingStaffId, outgoingAccess, legacyOwnershipRetired: true}` | 400 wrong password, 401 stale, 403 not an owner or MFA, 409 one generic answer for foreign, self, missing or ineligible targets and concurrent changes. Audit `staff.ownership.handed_over` |

Rules behind these: [[Authentication and Dashboard Access#Staff invitations]], [[Authentication and Dashboard Access#Owner handover]].

## Events

Writes use the selected dashboard context and need `events:manage` +MFA; errors map through `eventRouteRules` (400 validation with field details, 403 context mismatch, 404 foreign or missing event, 409 stale version). Rules: [[Event Lifecycle]].

| Route | Body / query | Success | Notable refusals and effects |
| --- | --- | --- | --- |
| `GET /api/events?orgId=` | `orgId` required (400 `path: ["orgId"]`) | `{events}` with `ticketTypes` | `events:manage` on `orgId` |
| `POST /api/events` | `lib/validators/events.ts:createEventSchema` (includes `organisationId`, rechecked) | 201 `{event}`, always `draft`, `version: 1` | 400 more than 50 ticket types (`MAX_TICKET_TYPES`, `path: ["ticketTypes"]`), `heroAssetId` not a ready event image of this society, sales close after the end. Audit `event.created` |
| `GET /api/events/[eventId]?orgId=` | `orgId` | `{event}` | 404 foreign |
| `PATCH /api/events/[eventId]` | `updateEventSchema`: `organisationId` (must be the selected society, else 403), `version`; existing types by `id` with `expectedQuantity`, new types without `id` | `{event}`, `version` + 1 | 409 stale `version`, or stock changed by sales and by the editor. 400 capacity below issued plus held, remaining below active holds (the type's `quantity`), end moved earlier into the past (SEC-004), a repeated type or one of another event. `heroAssetId: null` removes, omitted keeps. Omitted types are deleted only if they have no orders or tickets; sold ones are kept silently. Audit `event.updated` with `changes` |
| `DELETE /api/events/[eventId]` | none | `{deleted: true}` | 400 once any order or ticket exists (`path: ["eventId"]`). Audit `event.deleted` |
| `PATCH /api/events/[eventId]/publish` | `eventPublicationSchema`: `{targetStatus: "published" \| "draft", version}` | `{event}` | same status returns it unchanged; 400 one detail per readiness blocker (`lib/events/event-readiness.ts`, including `members_only_unavailable`), 400 unpublish after orders. Audit `event.published` / `event.unpublished` |
| `PATCH /api/events/[eventId]/sales` | `eventSaleStateSchema`: `{saleState: "open" \| "closed", version}` | `{event}` | same state unchanged; 400 reopening after `salesCloseAt`, or on a cancelled event. Audit `event.sales_closed` / `event.sales_reopened` |
| `POST /api/events/[eventId]/cancel` | `{confirmation, reason, mfaCode?}`: the event title typed back (case and outer spaces ignored), a message to ticket holders (8 to 500), a fresh authenticator code unless MFA is `off`. Needs `events:manage` and `orders:refund` | 200 `{status: "cancelled", cancelledAt, refundsQueued, freeCancelled, notified, skipped: [{orderId, reason}], checkoutsClosed}` (`checkoutsClosed`: unpaid orders whose Stripe page was closed afterwards); a repeat answers `already_cancelled`, changes nothing else, and closes any page still open | 400 `confirmation`, a draft, an ended event, `mfaCode` missing or wrong; 403 without `orders:refund`; 404 foreign. Effects: [[Event Lifecycle#Cancelling]]. Audit `event.cancelled` |

Ticket types are created and edited only through these two event writes, which version-check, lock the event and keep the 50-type cap. A type's optional `memberPrice` is at most `price`; `null` clears it.

## Attendance

| Route | Auth, bucket | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/events/[eventId]/tickets` | ctx, `tickets:check_in` +MFA | `{event, tickets, pageInfo, counts}`; query `limit`, `cursor`, `direction`, `q`. `no-store` | 400 bad paging, 404 foreign event (drafts are 404 to `check_in_staff`) |
| `POST /api/tickets/[ticketId]/check-in` | same; `ticket_check_in_out` | `{ticket: {id, status: "checked-in", checkedInAt}}` | 404 foreign; 409 `reason` `already_checked_in`, `not_valid`, `under_review` |
| `POST /api/tickets/[ticketId]/check-out` | same | `{ticket: {id, status: "unused", checkedInAt: null}}` | 409 `not_checked_in`, `not_valid`, `under_review` |

Search, counts, ticket fields and concurrency: [[Ticket Check-in Implementation]]. Audit `ticket.checked_in` / `ticket.checked_out`.

## Public reads

| Route | Answer | Rules |
| --- | --- | --- |
| `GET /api/public/events` | `{events, pageInfo}`; each event carries its society's `name`, `slug`, `timeZone` | `published`, `public`, not ended; ordered `startTime`, `id`; standard paging. Never drafts, link-only or members-only. Read-only |
| `GET /api/public/events/[eventId]` | `{event}`: fields, `membersOnly`, `salesOpen`, `salesCloseAt`, society `name`, `slug`, `timeZone`, `supportEmail`, `refundPolicy`; ticket types with `price`, `memberPrice`, raw `quantity`, advisory `availableQuantity` and `unavailable` (`sold_out`, `payments_unavailable` or `null`) | `published` and not `members_only` (link-only readable); 404 otherwise. Stripe fields never included. Availability counts only active, unexpired holds; it writes nothing and checkout decides again under locks |
| `GET /api/public/organisations/search` | `{organisations, pageInfo}`: name, slug, description excerpt, logo, next upcoming published event | same `q`, `limit`, `cursor` rules as `GET /api/orgs/search`; no joined state, staff, emails or Stripe fields. `public, max-age=60` |
| `GET /api/public/assets/[assetId]` | `image/webp` bytes with `ETag`; 304 on a match; `HEAD` answered from the row | an image on public use (`public, max-age=300`), or a members-only event's image to a member it is open to (`private, no-store`); else 404 |
| `POST /api/merchandise/quote` | `{quote: {society, lines, problems, total, version, pickupPolicy, refundPolicy, supportEmail, checkoutEnabled}}` | public, no origin check or limit (nothing is held). Body `lib/merchandise/shop.ts:quoteSchema` (`society` slug, up to 50 `items` of `{variantId, quantity 1-100}`). Lines merge repeats, cap at 10 each and at stock; `problems`: `reduced`, `sold_out` (kept at 0), `unavailable`, `too_many_lines` (past ten lines). `version` changes with any price, quantity or line; checkout compares it. 404 unknown society. `no-store` |

## Membership plans and merchandise products

Every route needs live `memberships:manage` or `merchandise:manage` +MFA for the slug's society (another society's slug is 404; this society's staff without the permission get 403), a trusted origin to write, and answers `private, no-store`. Writes return `{plan}` or `{product}`. Rules: [[Memberships and Merchandise]].

| Route | Body | Success | Notable refusals |
| --- | --- | --- | --- |
| `GET /api/orgs/[orgSlug]/memberships` | — | plans, newest term first, with `firstDay`, `lastDay`, `startsAt`, `endsAt`, `standing` (`draft`, `published`, `ended`, `archived`), `version`, holder count | — |
| `POST /api/orgs/[orgSlug]/memberships` | `lib/memberships/plans.ts:planFieldsSchema` | 201 draft | 400 fields. Audit `membership_plan.created` |
| `PATCH /api/orgs/[orgSlug]/memberships/[planId]` | `updatePlanSchema` (`expectedVersion`) | plan | 409 stale, archived, or anything but the description once sold; a published plan must still pass the publish check |
| `POST /api/orgs/[orgSlug]/memberships/[planId]/publish`, `/api/orgs/[orgSlug]/memberships/[planId]/archive` | `planVersionSchema` | plan; a repeat returns it unchanged | publish 409, one detail per blocker: `term_past`, `overlap`, `payments_unavailable`; an archived plan never republishes |
| `GET /api/orgs/[orgSlug]/merchandise` | — | products, newest first, with cover, status, options on sale, stock, price range | — |
| `POST /api/orgs/[orgSlug]/merchandise` | `lib/merchandise/catalogue.ts:productFieldsSchema` (up to 4 photos, up to 50 options; blank SKU generated, stored upper case) | 201 draft | 400 taken SKU, repeated option, unusable photo (`variants.N.sku`, `variants.N.size`, `imageAssetIds`) |
| `GET /api/orgs/[orgSlug]/merchandise/[productId]` | — | product with photo ids, options (each with `version`), `stoppedOptions`, `pickupPolicy`, publish `blockers` | 404 |
| `PATCH /api/orgs/[orgSlug]/merchandise/[productId]` | `updateProductSchema` (`expectedVersion`; each kept option its `id` and `expectedVersion`) | product | 409 stale product or option, archived. An omitted option is deleted until first published, then stops selling; a published product keeps a photo and an option |
| `POST /api/orgs/[orgSlug]/merchandise/[productId]/publish`, `/api/orgs/[orgSlug]/merchandise/[productId]/archive`, `/api/orgs/[orgSlug]/merchandise/[productId]/restore` | `productVersionSchema` | product; a repeat returns it unchanged; restore makes an archived product a draft | publish 409 per blocker: `photo_missing`, `no_options`, `no_stock`, `payments_unavailable`, `pickup_missing` |

Membership and merchandise order actions (revoke, cancel, refund, pickups, returns) are in [[API Reference Commerce]].

## Traps

- A slug route must authenticate before it reveals whether an id exists (`organisationActor` first, then the lookup), as the asset routes do.
- `POST /api/events` takes its society from the body and checks it; every other event write takes it from the selected context and refuses a body `organisationId` that differs.

## Related

[[API Reference]] · [[API Reference Commerce]] · [[Event Lifecycle]] · [[Ticket Check-in Implementation]] · [[Society Profiles and Assets]] · [[Memberships and Merchandise]] · [[Route Security Inventory]]
