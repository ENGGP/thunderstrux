---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Architecture Overview]]", "[[Authentication and Dashboard Access]]", "[[Payment Lifecycle]]", "[[Production Operations]]"]
sources: [prisma/schema.prisma, prisma/migrations, config/schema-contract.json, lib/db/organisation-scope.ts, lib/db/organisation-drift.ts, lib/ops/integrity-audit.ts, lib/staff/live-authority.ts]
---

# Database and Multi Tenancy

**Owns:** the tenant boundary, every Prisma model and enum, indexes, database constraints and triggers, lock order, the integrity audit, migration policy and worker leases.
**Read when:** adding or changing a model, enum, index, constraint or migration; writing a query that crosses societies; taking row locks.
**Not here:** what each order, ticket or hold state means ([[Payment Lifecycle]]); Connect account states ([[Stripe Payments and Connect#Connect account states]]); roles and permissions ([[Authentication and Dashboard Access#Roles and permissions]]); check-in rules ([[Ticket Check-in Implementation]]); deploy and backups ([[Production Operations]]).

## Code

| Concern | Where |
| --- | --- |
| Schema (every field) | `prisma/schema.prisma` |
| Migrations | `prisma/migrations/` (SQL; constraints and triggers live only here) |
| Newest migration the app needs | `config/schema-contract.json` `requiredMigration`, checked by `checkDatabaseReadiness` in `lib/ops/readiness.ts` |
| Prisma client | `lib/db/index.ts` |
| Scope helpers | `lib/db/organisation-scope.ts`: `requireOrganisationId`, `scopedByOrganisation`, `OrganisationScopeError` (400), `OrganisationMismatchError` (403) |
| Live staff authority | `lib/staff/live-authority.ts`: `liveStaffRole`, `legacyOrganisationAccessMode` |
| Integrity audit | `lib/ops/integrity-audit.ts`: `runDatabaseIntegrityAudit`; CLI `scripts/audit-db-integrity.ts` (`pnpm db:integrity:audit`) |
| Drift repair | `lib/db/organisation-drift.ts`: `repairOrganisationDrift`; `pnpm db:organisation-drift:repair` |
| Worker leases | `lib/ops/worker.ts` |
| Tests | `tests/integration/organisation-tenancy.test.ts`, `tests/integration/organisation-creation.test.ts`, `tests/integration/organisation-drift-repair.test.ts`, `tests/integration/integrity-audit.test.ts`, `tests/integration/account-closure.test.ts` |

## Tenant boundary

The tenant is `Organisation` (a society).

- **Event-owned rows:** `Event.organisationId` is the only owner of an event's `TicketType`, `Order`, `Ticket`, `TicketReservation` and `EventChange` rows. Organiser reads and actions scope through `<row>.event.organisationId` (or load the event with `scopedByOrganisation(organisationId, { id: eventId })` first).
- **Denormalised copies are not authority.** `Order.organisationId`, `Ticket.organisationId` and `TicketReservation.organisationId` are written from `Event.organisationId` at creation and kept for relations and reporting. Never authorise from them. Webhook reconciliation checks Stripe metadata against `Event.organisationId`: a stale `Order.organisationId` doesn't block fulfilment, isn't repaired silently, and tickets are issued with the event's organisation. A paid Session whose metadata names another organisation goes to compensation review ([[Payment Lifecycle]]).
- **Rows with their own owner:** commerce, membership, merchandise, asset, refund, dispute and payout rows carry `organisationId` as their owner. Children reach it through composite foreign keys (`(id, organisationId)`), so the database refuses a line, grant, image or option of another society.
- **Client ids, headers and membership rows grant nothing.** A route resolves the target society server-side (the selected dashboard context or a slug) and then needs live staff authority on it. `requireOrganisationId` only checks an id is present (400 `OrganisationScopeError`). An edit whose body `organisationId` differs from the selected society is 403 (`OrganisationMismatchError`).
- **Live staff authority:** an active `OrganisationStaff` row, read from the database on every protected request, with permissions derived from its role (`lib/permissions/index.ts`, never stored). Any staff row for the society, active or not, supersedes the legacy owner pointer. `Organisation.accountUserId` grants owner only while `LEGACY_ORGANISATION_ACCESS_MODE` allows it (unset allows in development and denies in production). Disabled accounts hold no authority.
- **`OrganisationMember` is free affiliation** (the Joined badge). It grants no management access and no membership rights; paid rights live on `MembershipGrant`.
- Helpers: `requireOrganisationPermission` and wrappers in `lib/auth/access.ts`; `lockOrganisationActor` in `lib/organisations/authority.ts` rechecks under lock.

## Models

Fields, defaults and relations: `prisma/schema.prisma`. Amounts are integer cents; `currency` defaults to `aud`.

### Accounts and security

| Model | Purpose and notable rules |
| --- | --- |
| `User` | One account (`accountRole` `member` or `organisation`). `password` is a bcrypt hash. `authVersion` invalidates sessions; `disabledAt`, `closedAt` (closure is permanent, see below). `renewalReminders` is the one optional-mail switch. |
| `AuthToken` | Emailed account token: purpose (`verify_account`, `reset_password`, `email_change`), digest only (`tokenHash` unique), bound to email and `authVersion`, expiry, consumed or invalidated. |
| `AccountSecurityEvent` | Private per-account ledger (password reset or change, email change steps, `account_closed`). Restrict on user delete. |
| `UserMfa` | Encrypted TOTP secret (and pending one during enrolment), `lastAcceptedStep` against replay. |
| `MfaRecoveryCode` | One-time recovery code digests. |
| `MfaGrant` | A session's MFA verification: keyed by session digest, with expiry. The stale-orders worker deletes expired grants. |

### Societies and staff

| Model | Purpose and notable rules |
| --- | --- |
| `Organisation` | A society. Unique `slug`. Public profile fields (`description`, `supportEmail`, `refundPolicy`, `pickupPolicy`, `timeZone` default `Australia/Brisbane`, `profileVersion`, `onboardingCompletedAt`) and `logoAssetId`/`coverAssetId` through `(assetId, id)` composite keys ([[Society Profiles and Assets]]). Cached Connect fields `stripeAccountId`, `stripeAccountStatus` (a string, not an enum), `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted` ([[Stripe Payments and Connect#Connect account states]]). `payoutCheckedAt` is the payouts claim. `accountUserId` (unique) is the legacy owner pointer. |
| `Asset` | An uploaded image: owner society, uploader, unique `storageKey`, `kind` (`logo`, `cover`, `event`, `product`), processed size, dimensions, `sha256`, `status` string (`pending`, `ready`, `failed`, `deleted`), `unreferencedAt` cleanup clock. Bytes live in object storage ([[Society Profiles and Assets]]). |
| `OrganisationMember` | Free join, unique `(userId, organisationId)`, `role` `OrganisationRole` (joins write `member`; bootstrap writes `org_owner`). No authority. |
| `OrganisationStaff` | Named staff: unique `(organisationId, userId)`, role, status, who invited, accepted, revoked. |
| `OrganisationStaffInvite` | Expiring invite: hashed token, intended role, positive `version` that fences re-sends. |
| `AuditLog` | Society history: action, target, metadata, actor. `actorRole` is filled by the `AuditLog_actor_role` trigger from the actor's active staff row. Cascades with the society ([[Audit Coverage]]). |

### Events and tickets

| Model | Purpose and notable rules |
| --- | --- |
| `Event` | Owner `organisationId`; `status`, `visibility`, `saleState`, `salesCloseAt`, optional `capacity` (positive), `version` (compare-and-swap, positive), `compensationRefundMode`, optional `heroAssetId` through `(heroAssetId, organisationId)`, optional `cancelledAt` and `cancellationReason` (EVT-004) ([[Event Lifecycle]]). End after start (check). |
| `TicketType` | `price`, optional `memberPrice` (at most `price`, check), `quantity` = remaining stock (never original capacity; non-negative). |
| `Ticket` | One admission. `issueSequence` unique per order and positive; `validity`, `validityReason`, `validityChangedAt` (set by refunds, disputes, cancellations); `checkedInAt` (check-in). |
| `EventChange` | A time or place change to an event with active tickets: old and new start, end and location, unique `(eventId, eventVersion)`, fan-out `cursor`, `notifiedCount`, `completedAt` with `outcome` `sent` or `superseded` (both null or both set). |

### Ticket orders, checkout and money

| Model | Purpose and notable rules |
| --- | --- |
| `Order` | One ticket purchase of one ticket type. `status`, `paymentKind` (required, no default), amounts, `stripeSessionId` (unique), `stripePaymentIntentId`, buyer snapshots with provenance (immutable once captured), purchase snapshots (`purchasedTicketTypeName`, seller, `feeAmount`, `feePolicyVersion`, `snapshotVersion`), `compensationRefundModeSnapshot` (copied from the event at checkout), `refundStatus`, `disputeStatus`, `externalRefundedAmount`, free cancellation (`cancelledAt`, who, reason), `membershipGrantId` with `membershipEntitlementVersion` for member prices, review and email-delivery fields. `userId` or `guestIdentityId` names the buyer. |
| `OrderLifecycleEvent` | Append-only order history, unique `(orderId, sequence)`, typed and sourced. |
| `TicketReservation` | A ticket hold, unique per order. `status`, `expiresAt`, confirmed or released facts ([[Payment Lifecycle#Holds]]). |
| `CheckoutAttempt` | One intended checkout: actor and client key unique per family and operation (`CheckoutAttempt_actor_key_key`), unique `providerOperationKey` (Stripe idempotency key), `providerRequest` replayed by recovery, `state`, `reconcileDueAt`. Binds `orderId` (ticket family only) or `commerceOrderId` (commerce only), never both. |
| `CompensationRefundJob` | Ticket-only automatic refund for a paid order that couldn't be fulfilled; fenced worker lease (`processingToken`). |
| `RefundRequest` | One staff whole-order refund of an `Order` or a `CommerceOrder` (exactly one, check), reason 8 to 500 characters, unique `operationKey` and Stripe refund id, lease. Commerce compensation refunds also run here. |
| `StripeRefundWebhookEvent` | Dedupe journal of refund, dispute and outside-refund webhook events, keyed by Stripe event id. |
| `PurchaseDispute` | A Stripe dispute on an order or commerce order (exactly one), staff restore with reason, and the lost-dispute transfer reversal with its own lease. |
| `SocietyPayout` | A Stripe payout from a society's balance: unique `stripePayoutId`, positive amount, status as Stripe reports. |
| `GuestIdentity` | A proven email for buying without an account (normalised lower-case, check). Never a login. |
| `GuestAccessGrant` | One emailed guest link: token digest, purpose `checkout` (no order) or `purchase` (exactly one of `orderId`, `commerceOrderId`), expiry, consumed or revoked, and the redeemed session digest. A checkout link also keeps the name the guest gave (`buyerFirstName`, `buyerLastName`, nullable; migration `20261116010000_guest_checkout_name`), which reaches an order only through the session the link opens. |

### Commerce (memberships and merchandise)

| Model | Purpose and notable rules |
| --- | --- |
| `CommerceOrder` | One society, one family (`kind`). A member buyer or, merchandise only, a guest, never both. `status` and `paymentKind` reuse the ticket enums. Fee at most total; free totals zero with no Session. Buyer and seller snapshots and amounts are frozen by `CommerceOrder_preserve_snapshot`. `expiresAt` ends a paid order's hold. `version`, `refundStatus`, `disputeStatus`, `externalRefundedAmount`, free cancellation, `pickupStatus` (merchandise only). Unique `(id, organisationId, kind)`. |
| `CommerceOrderLine` | Reaches its order through `(orderId, organisationId, kind)`, so the database refuses another family or society. Line number and quantity 1 to 10, membership quantity exactly 1, `lineAmount = quantity × unitAmount`, name and option snapshots, membership term. `membershipProductId` (membership lines) or `merchandiseVariantId` (merchandise lines, unique per order). Append-only. |
| `CommerceLifecycleEvent` | Append-only commerce history, unique `(commerceOrderId, sequence)`, appended under the order lock. |
| `MembershipProduct` | A plan: price, half-open term `[startsAt, endsAt)`, `entitlements` with `entitlementVersion`, `status` with matching `publishedAt`/`archivedAt`, `version`. `MembershipProduct_preserve_sold` freezes name, term, price and rights once sold and never lets a plan change society. |
| `MembershipGrant` | One member's membership from one line (unique `commerceOrderLineId`, pinned to the grant's society). Copied term and rights; `MembershipGrant_preserve_facts` allows only one revocation (reason up to 600 characters). |
| `MerchandiseProduct` | A product for pickup: `status`, `firstPublishedAt` (never cleared), `version`. Never deleted. |
| `MerchandiseProductImage` | Up to four photos, `position` 0 to 3, composite keys to the product and to an `Asset` of the same society. |
| `MerchandiseVariant` | An option: colour, size, `sku` unique per society for good, price, `remaining` (non-negative), `position`, `version`, `archivedAt`. |
| `MerchandiseReturn` | One return of one line: quantity 1 to 10, `restocked`, reason 3 to 500 characters, unique `operationKey`, composite key to the line's society. |

### Messaging and operations

| Model | Purpose and notable rules |
| --- | --- |
| `EmailOutbox` | Ticket email jobs per order, `mode` and `status`, rotating `processingToken` lease. One automatic job per order (partial unique index `EmailOutbox_automatic_order_unique`); manual resends may repeat. |
| `NotificationOutbox` | Every other email: encrypted payload, unique `(eventKey, recipient, templateVersion)` (the idempotency key), `privacy` `security` (no society) or `business` (a society), status string (`pending`, `processing`, `sent`, `failed`, `cancelled`), lease, links to the invite, token or guest grant it serves ([[Email Delivery Implementation]]). |
| `WorkerLease` | One row per scheduled job plus `all` (global pause). See [[#Worker leases]]. |

## Enums

Values are a contract: code, SQL checks and stored rows use them. Adding a value needs a migration; renaming or removing one needs a data migration.

| Enum | Values |
| --- | --- |
| `AccountRole` | `member`, `organisation` |
| `OrganisationRole` | `org_owner`, `org_admin`, `event_manager`, `finance_manager`, `content_manager`, `member` (join rows; no authority) |
| `OrganisationStaffRole` | `owner`, `admin`, `event_manager`, `finance_manager`, `check_in_staff` |
| `OrganisationStaffStatus` | `invited`, `active`, `revoked` |
| `EventStatus` | `draft`, `published` |
| `EventVisibility` | `public`, `unlisted`, `members_only` |
| `EventSaleState` | `open`, `closed` |
| `CompensationRefundMode` | `manual_review`, `automatic_full` |
| `CompensationRefundState` | `review_required`, `auto_queued`, `auto_processing`, `refund_pending`, `refunded`, `refund_failed`, `recovered` |
| `PaymentKind` | `stripe`, `free` |
| `TicketValidity` | `active`, `void`, `refund_review` |
| `OrderStatus` | `pending`, `paid`, `failed`, `expired` (orders and commerce orders) |
| `ReservationStatus` | `active`, `confirmed`, `released`, `expired` |
| `OrderRefundStatus` | `processing`, `refunded` (the refund fence) |
| `OrderDisputeStatus` | `open`, `won`, `lost` |
| `RefundRequestStatus` | `pending`, `uncertain`, `succeeded`, `failed` |
| `DisputeReversalStatus` | `pending`, `uncertain`, `succeeded`, `failed` |
| `SocietyPayoutStatus` | `pending`, `paid`, `failed` |
| `EmailOutboxMode` | `automatic`, `manual` |
| `EmailOutboxStatus` | `pending`, `processing`, `sent`, `failed` |
| `CheckoutFamily` | `ticket`, `membership`, `merchandise` |
| `CheckoutActorKind` | `user`, `guest` |
| `CheckoutAttemptState` | `created`, `provider_uncertain`, `provider_attached`, `failed` |
| `CommerceKind` | `membership`, `merchandise` |
| `MembershipPlanStatus` | `draft`, `published`, `archived` |
| `MembershipEntitlement` | `member_prices`, `members_only_events` |
| `MerchandiseProductStatus` | `draft`, `published`, `archived` |
| `MerchandisePickupStatus` | `pending`, `ready`, `collected` |
| `OrderLifecycleSource` | `checkout`, `stripe_webhook`, `development_fallback`, `stale_cleanup`, `staff_action`, `email_worker`, `refund_worker`, `checkout_recovery`, `legacy`, `buyer_action` (also the source of commerce history) |

`OrderLifecycleEventType`: `legacy_baseline`, `order_created`, `stripe_session_attached`, `order_failed`, `order_expired`, `compensation_required`, `payment_fulfilled`, `free_fulfilled`, `compensation_recovered`, `manual_refund_marked`, `compensation_refund_queued`, `compensation_refund_started`, `compensation_refund_pending`, `compensation_refunded`, `compensation_refund_failed`, `refund_requested`, `refund_pending`, `refunded`, `refund_failed`, `dispute_opened`, `dispute_closed`, `dispute_resolved`, `dispute_funds_recovered`, `external_refund_recorded`, `external_refund_reviewed`, `free_cancelled`, `email_enqueued`, `email_retry_scheduled`, `email_provider_accepted`, `email_delivery_exhausted`.

`CommerceLifecycleEventType`: `order_created`, `stripe_session_attached`, `payment_fulfilled`, `free_fulfilled`, `order_failed`, `order_expired`, `compensation_required`, `free_cancelled`, `refund_requested`, `refund_pending`, `refunded`, `refund_failed`, `pickup_ready`, `pickup_collected`, `return_recorded`, `dispute_opened`, `dispute_closed`, `dispute_funds_recovered`, `external_refund_recorded`, `external_refund_reviewed`.

What each state means: [[Payment Lifecycle]] (orders, holds, refunds, disputes, compensation, attempts), [[Event Lifecycle]] (event status, visibility, sales), [[Memberships and Merchandise]] (plans, grants, products, pickups).

## Indexes

Composite indexes and the reads they serve. Every index is in `prisma/schema.prisma`.

| Index | Serves |
| --- | --- |
| `Event(status, startTime, id)` | Public event lists ordered by start |
| `Event(organisationId, status)` | Dashboard event lists and the calendar month (`readCalendar` in `lib/events/calendar.ts` filters this society, optionally `published`, then the time window; there is no time index for it) |
| `Order(eventId, status, createdAt, id)` | Event order reads and pages |
| `Order(userId, status, createdAt, id)` | The member's ticket purchases |
| `Order(status, createdAt)` | Stale pending-order selection |
| `Order(eventId, fulfilledAt)`, `CommerceOrder(organisationId, kind, fulfilledAt)` | Analytics sales by fulfilment time ([[Analytics and Calendar]]) |
| `Ticket(eventId, createdAt, id)`, `Ticket(eventId, checkedInAt)` | Attendee list pages and check-in counts |
| `TicketReservation(ticketTypeId, status, expiresAt)`, `TicketReservation(status, expiresAt)` | Live holds per type; stale-hold cleanup |
| `CommerceOrder(organisationId, createdAt, id)`, `(organisationId, pickupStatus, createdAt, id)`, `(userId, createdAt, id)`, `(status, expiresAt)` | Organiser Orders tabs; Pickups tab; buyer Purchases; stale commerce expiry |
| `MembershipGrant(userId, organisationId, startsAt)`, `(organisationId, startsAt, id)`, `(endsAt)` | Entitlement checks; roster pages; renewal and expiry scan |
| `MembershipProduct(organisationId, status, startsAt, id)`, `MerchandiseProduct(organisationId, status, createdAt, id)`, `MerchandiseVariant(productId, position, id)` | Plan and product lists; option order |
| `AuditLog(organisationId, createdAt)`, `(organisationId, actorUserId, createdAt)` | History pages and its Who filter |
| `Organisation(name, id)` | Society directory pages |
| `NotificationOutbox(organisationId, privacy, status, createdAt)` | The society's failed-notification list |
| `EmailOutbox(status, nextAttemptAt, createdAt)`, `NotificationOutbox(status, nextAttemptAt)`, `CompensationRefundJob(state, nextAttemptAt, createdAt)`, `RefundRequest(status, nextAttemptAt)`, `PurchaseDispute(reversalStatus, reversalNextAttemptAt)`, `CheckoutAttempt(state, reconcileDueAt)`, `EventChange(completedAt, createdAt)` | Worker claim queries; the outbox and compensation tables also index `processingStartedAt` for lease recovery |

- Indexes are plain `CREATE INDEX`, which blocks writes to the table while it builds (seconds at current volumes).
- Known overlaps, kept until production index-usage evidence says otherwise: `Order(eventId)` and `Order(userId)` are prefixes of the composites; `TicketReservation(orderId)` duplicates its unique index; `Event(organisationId)` is a prefix of `Event(organisationId, status)`; `Ticket(orderId)` is a prefix of the unique `(orderId, issueSequence)`.

## Constraints and triggers

Database checks back the validators; a write that breaks one fails with a Postgres error, not a 400. Find each by name in `prisma/migrations/`.

- **Numeric:** `TicketType_quantity_nonnegative_chk`, `TicketType_price_nonnegative_chk`, `TicketType_member_price_chk`, `Order_quantity_positive_chk`, `Order_unitPrice_nonnegative_chk`, `Order_totalAmount_nonnegative_chk`, `Order_paid_total_matches_units_chk` (a paid order's total is unit price × quantity), `Order_feeAmount_bounds_chk`, `Order_externalRefundedAmount_chk`, `TicketReservation_quantity_positive_chk`, `Ticket_issueSequence_positive_chk`, `Event_capacity_positive_chk`, `Event_version_positive_chk`, `CommerceOrder_amounts_chk`, `CommerceOrderLine_amount_chk`, `MerchandiseVariant_remaining_chk`, `RefundRequest_amount_chk`, `PurchaseDispute_reversalAmount_chk`, `SocietyPayout_amount_chk`.
- **Lifecycle:** `Event_endTime_after_startTime_chk`; `Order_paid_requires_paidAt_chk`, `Order_expired_has_no_paidAt_chk`, `Order_failed_requires_failedAt_chk`, `Order_fulfilled_requires_paid_chk`, `Order_free_has_zero_total_chk`; `Order_cancellation_chk` and `CommerceOrder_cancellation_chk` (only a free, paid-status order is cancelled, with a reason of 8 to 500 characters); `CommerceOrder_free_chk`, `CommerceOrder_fulfilled_chk`, `CommerceOrder_refund_chk`, `CommerceOrder_pickup_chk`; `CheckoutAttempt_ticket_order_chk`, `CheckoutAttempt_commerce_order_chk`, `CheckoutAttempt_attached_session_chk`; `PurchaseDispute_resolution_chk`; `MembershipProduct_published_chk`, `MembershipProduct_archived_chk`; `EventChange_completed_chk`.
- **Shape:** `Order_buyer_capture_check` (snapshot all-or-nothing; provenance `current_account_at_capture`, `purchase` or `verified_guest`), `Order_member_price_chk` (grant and version together), `CommerceOrder_buyer_chk`, `GuestAccessGrant_purpose_scope_chk`, `GuestAccessGrant_session_chk`, `GuestIdentity_email_normalised_chk`, `RefundRequest_purchase_chk`, `PurchaseDispute_purchase_chk`, `NotificationOutbox_privacy_check`, `Organisation_profile_bounds_chk`, `User_closed_disabled_check`.
- **Triggers:** `Order_preserve_buyer_capture` (buyer capture immutable), `Order_preserve_member_price`, `CommerceOrder_preserve_snapshot`, `CommerceOrderLine_append_only`, `CommerceLifecycleEvent_append_only`, `MembershipProduct_preserve_sold`, `MembershipGrant_preserve_facts`, `User_permanent_closure` (a closed account can't reopen), `AuditLog_actor_role`.
- **Audit-only (no constraint):** cross-row checks such as reservation versus order, ticket count versus quantity, and grant overlap. Grant overlap needs an exclusion constraint on `btree_gist`, which waits for the hosting decision.

## Lock order

Take row locks (`SELECT ... FOR UPDATE`) in this order, or two transactions can deadlock:

1. `User` rows (the buyer, member or actor; several users sorted by id), or the `GuestIdentity` in place of the buyer's User.
2. `Organisation` (`lockOrganisationActor`, which also rechecks live authority and MFA after waiting).
3. The resource: `Event`, then its `TicketType` rows by ascending id (`lockEventInventory` in `lib/events/inventory.ts`); or a plan; or a product, then its options by ascending id; or merchandise options alone in ascending id (checkout never locks the product); then any `Asset` rows (sorted).
4. The order (`lockOrder`, `lockCommerceOrder`), then its refund request, dispute, tickets and holds.

No path locks an order and then an event, ticket type, plan or option. Invites and staff rows come after the Organisation; account closure, email change and handover share the User-first order.

## Integrity audit

`pnpm db:integrity:audit` runs the read-only checks in `lib/ops/integrity-audit.ts`; `scripts/verify-restored-database.mjs`, `scripts/rehearse-upgrade.mjs` and `tests/integration/integrity-audit.test.ts` run the same list.

- Each check has a class: `numeric`, `lifecycle-risk` or `relationship/audit-only`. Output per check: name, class, violation count, up to 10 sample ids, a recommendation.
- A check may carry a `legacy` explanation for rows older than its feature (orders fulfilled before purchase snapshots; orders whose buyer was cleared before account closure existed). Those rows print with the explanation and don't fail the run. Exit code 1 only for unexplained violations.
- Coverage includes the numeric constraints, paid and free order shape, buyers, snapshots, valid tickets on refunded or cancelled orders, issued tickets per fulfilled order, refunds within totals, commerce line and fee arithmetic, grants for fulfilled memberships, revoked grants on refunded memberships, grant overlap, stock, day-old holds and pending commerce orders, stuck outbox jobs, sent notices without provider acceptance, and `Order`/`Ticket`/`TicketReservation` `organisationId` drift from the event. The list is the code; don't copy its count.
- The audit never repairs. `tests/integration/integrity-audit.test.ts` breaks each invariant directly: the write is refused by a constraint or the matching count rises.
- **Drift repair:** `pnpm db:organisation-drift:repair` is a dry run reporting mismatched `organisationId` per table. `--apply` (after a verified backup) rewrites them from `Event.organisationId` in batches, refuses when a ticket's or hold's event differs from its order's, and fails if drift remains. Repair doesn't change authority: reads still scope through the event.

## Migrations

- **Additive first.** Add nullable columns or columns with defaults, backfill only facts the rows prove, then tighten. A required column or new check can stop an older release writing (for example `Order.paymentKind` required, `Event.salesCloseAt` required): say in the PR whether rollback needs checkout or event creation paused.
- **Production:** migrations run once as the `migration` service (`prisma migrate deploy`) before the new app starts; ordinary app startup never migrates. Readiness fails until the migration named in `config/schema-contract.json` is applied, so bump `requiredMigration` when the app needs a new migration ([[Production Operations]]).
- **Development:** the dev `app` container runs `pnpm prisma:migrate:deploy` on every start, so restarting it applies pending migrations; `pnpm docker:migrate` runs `prisma migrate dev` to create one from schema changes ([[Development Workflow]]).
- **Upgrade rehearsal:** `node scripts/rehearse-upgrade.mjs <archive.dump> [...]` restores each `pg_dump` archive into a throwaway Postgres container as `upgrade_rehearsal_test`, applies this checkout's migrations, runs the audit and compares row counts, then removes the container. Archives from a newer `pg_dump` are skipped with a reason. It never touches dev or production volumes.

## Worker leases

`WorkerLease` has one row per scheduled job (`email-outbox`, `notifications`, `stale-orders`, `refunds`, `checkout-recovery`, `monitor`, from `scheduledWorkers` in `lib/ops/worker.ts`) plus `all` for a global pause. A row holds the running `holder` and `leasedUntil`, `pausedAt` and `pauseReason`, the last start, success and failure with duration and a short error, and the monitor's `alertState`. Rows appear on a job's first run or pause. They are backed up and restored like everything else, so a restored copy keeps a pause until someone resumes it. Behaviour: [[Production Operations#Workers and schedules]].

Row-level leases for jobs (`processingToken` on outbox, refund and dispute rows) rotate on every claim and are matched on finish, so a stale worker can't overwrite a newer one.

## Account lifecycle and retained records

- Closing an account keeps the `User` id and sets `closedAt` and `disabledAt`; credentials are disabled and `User_permanent_closure` refuses reopening. A new signup never inherits the old account's records.
- Orders, tickets, attendance, audit and security rows stay attached to the original user. Missing buyer snapshots are filled from the account at closure (provenance `current_account_at_capture`); nothing invents purchase-time facts.
- Relations to `User` use `SetNull` or `Restrict`, not cascade, for financial and history rows.
- Ownership handover (`lib/staff/handover.ts`) promotes the incoming owner, makes the outgoing one an admin or revokes them, checks an active owner remains, clears `Organisation.accountUserId` and writes `staff.ownership.handed_over`. A retired pointer is never restored. Events and payment records keep their owner society.
- Details: [[Authentication and Dashboard Access]], [[Email Delivery Implementation]].

## Traps

- **An `Organisation` create must name `accountUserId` (null is fine) or an `id` (DEF-040).** The logo and cover relations include the society's own `id`; a create that names only `name`/`slug` or `accountUser: { connect }` makes Prisma skip generating the id and fail with P2011. `tests/integration/organisation-creation.test.ts` fails on any create that misses this.
- **Two compensation defaults.** `Event.compensationRefundMode` defaults to `manual_review` in the schema, but `createEventSchema` defaults to `automatic_full`. Events created by the API refund automatically unless the society chooses review; events created directly through Prisma (seed, tests, scripts) get `manual_review`. Each order keeps `compensationRefundModeSnapshot` from checkout.
- `TicketType.quantity` is what's left. Paid fulfilment and free registration both decrement it; never treat it as the original allocation.
- A ticket's `validity` changes after issue (refunds, disputes, cancellations), and `checkedInAt` at the door. Count "issued" as `validity = 'active'` where the rule needs valid tickets.
- Ticket email fields on `Order` (`ticketEmailSentAt` and friends) and `isManuallyRefunded` are bookkeeping only, never payment, fulfilment or refund truth.
- `CompensationRefundJob` is ticket-only; commerce compensation refunds are `RefundRequest` rows.
- New check constraints evaluate NULL as passing; write `IS NOT NULL` explicitly when a field is required in a state.
- Integration tests reset only a database whose name contains `_test`.

## Failure and recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| Readiness reports "Required application schema migration is not applied" | The `migration` service didn't run or failed | Run it, then recheck ([[Production Operations]]) |
| P2011 on an organisation insert | Create names no relation column | Pass `accountUserId` or `id` (DEF-040) |
| Audit exits 1 | Unexplained violations | Read each check's recommendation; never rewrite charged totals; drift goes through `pnpm db:organisation-drift:repair` |

## Related

[[Architecture Overview]] · [[Authentication and Dashboard Access]] · [[Payment Lifecycle]] · [[Stripe Payments and Connect]] · [[Event Lifecycle]] · [[Memberships and Merchandise]] · [[Society Profiles and Assets]] · [[Analytics and Calendar]] · [[Production Operations]] · [[Development Workflow]] · [[Glossary]]
