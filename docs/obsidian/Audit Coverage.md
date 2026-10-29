---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Route Security Inventory]]", "[[Payment Lifecycle]]", "[[Database and Multi Tenancy]]"]
sources: [lib/audit/history.ts, app/(dashboard)/dashboard/history/page.tsx, prisma/migrations/20261110010000_audit_actor_role/migration.sql, tests/integration/history.test.ts, tests/e2e/history.spec.ts]
---

# Audit Coverage

**Owns:** which change writes which `AuditLog` action, from which route, worker or webhook; what each row holds; and the society History that shows them.
**Read when:** adding a mutating route or a new automatic step, renaming an action, or changing what History shows.
**Not here:** order and commerce lifecycle journals, the financial record ([[Payment Lifecycle]]); guard order ([[Route Security Inventory]]); private account security events ([[Authentication and Dashboard Access]]); the `AuditLog` model and its trigger ([[Database and Multi Tenancy]]).

## Code

| Concern | Where |
| --- | --- |
| Rows | `AuditLog` (`organisationId`, `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `metadata`), written by each owning service inside its transaction |
| Role at the time | trigger `AuditLog_actor_role` (`prisma/migrations/20261110010000_audit_actor_role/migration.sql`) copies the actor's live staff role into `actorRole` on insert |
| History read and wording | `lib/audit/history.ts`: `readHistory`, `describe`, `historyCategories`, `historyPeople`, `hasHistory` |
| Page | `/dashboard/history` (`app/(dashboard)/dashboard/history/page.tsx`) |
| Tests | `tests/integration/history.test.ts`, `tests/e2e/history.spec.ts`; each action has a row check (action, actor, target) in the integration test that makes the change |

## Rules

- **Same transaction.** A row is written in the transaction that makes the change. A refused or rolled-back change writes nothing; a replayed webhook that changes nothing writes nothing.
- **Who.** `actorUserId` is the person, or null for Stripe-driven and automatic steps. Rows written before the trigger have no `actorRole`.
- **Safe facts only.** `metadata` holds typed reasons, amounts in cents, before and after values and ids for joins. Buyer emails, card details, provider payloads and tokens are never stored. History shows only the facts `describe` names for each action; ids (orders, Stripe accounts, refunds, disputes, transfer reversals, guest identities, image hashes, email jobs) never display.
- **Not accounting.** `OrderLifecycleEvent` and `CommerceLifecycleEvent` are the financial record; audit rows say who did what.
- **Functional row:** Connect onboarding counts earlier `stripe_connect.account_created` rows to build its Stripe idempotency key (`lib/stripe/connect.ts`), so that action can't be renamed or pruned.

## Staff and buyer routes

| Route | Service | Action(s) | Facts in History |
| --- | --- | --- | --- |
| `POST /api/orgs` | `lib/organisations/bootstrap.ts` | `organisation.created` | — |
| `PATCH /api/orgs/[orgSlug]/profile` | `lib/organisations/profile.ts` | `organisation.profile_updated` | changed fields |
| `POST /api/orgs/[orgSlug]/assets` | `lib/assets/service.ts` | `asset.uploaded` | image kind |
| `DELETE /api/orgs/[orgSlug]/assets/[assetId]` | same | `asset.deleted` | image kind |
| `POST /api/events` | `lib/events/event-lifecycle.ts` | `event.created` (title) | — |
| `PATCH /api/events/[eventId]` | same | `event.updated` with `changes` | title, times, place, capacity, sales close, visibility, image, description changed; ticket types added, removed, renamed, repriced, restocked |
| `PATCH /api/events/[eventId]/publish` | same | `event.published`, `event.unpublished` | — |
| `PATCH /api/events/[eventId]/sales` | same | `event.sales_closed`, `event.sales_reopened` | — |
| `DELETE /api/events/[eventId]` | same | `event.deleted` (title) | — |
| `POST /api/events/[eventId]/cancel` | `lib/events/event-cancellation.ts` | `event.cancelled`, plus per order `order.refund_requested` or `order.free_cancelled` (`by: "event"`) | reason, refunds queued, free registrations cancelled, holders notified, skipped orders with why |
| `POST /api/tickets/[ticketId]/check-in`, `check-out` | `lib/tickets/check-in.ts` | `ticket.checked_in`, `ticket.checked_out` | ticket reference |
| `POST /api/orders/[orderId]/refunds` | `lib/payments/order-refunds.ts` | `order.refund_requested`; outcome below | amount, reason |
| `PATCH /api/orders/[orderId]/refund-manual` | `lib/orders/order-detail.ts` | `order.manual_refund_marked` | reason |
| `GET /api/orders/export`, `/api/events/[eventId]/tickets/export` | `lib/export/order-exports.ts`: `recordExport` | `order.list_exported` (family, rows, filters), `order.attendees_exported` (event, rows) | — |
| `POST /api/orders/[orderId]/review` | `lib/payments/purchase-disputes.ts`, `lib/commerce/payment-recovery.ts` | `order.dispute_resolved` (restore tickets); `order.external_refund_reviewed` or, for a commerce order id, `commerce_order.external_refund_reviewed` | reason, tickets valid again |
| `POST /api/orders/[orderId]/cancel` | `lib/payments/free-cancellation.ts` | `order.free_cancelled` (`by: "staff"`) | reason, tickets voided |
| `POST /api/purchases/tickets/[orderId]/cancel-registration` | same | `order.free_cancelled` (`by: "buyer"`; actor the member, or none for a guest) | tickets voided, places returned |
| `POST /api/orders/[orderId]/compensation-refund/confirm` | `lib/payments/compensation-refunds.ts` | `order.compensation_refund_confirmed` | — |
| `POST /api/orders/[orderId]/resend` | `lib/email/ticket-email-outbox.ts` | `order.ticket_email_queued` | — |
| `POST /api/orders/[orderId]/email-jobs/[jobId]/requeue` | same | `email_outbox.requeued` | reason |
| `POST /api/notifications/[jobId]/requeue`, `/api/notifications/requeue` | `lib/email/notification-outbox.ts` | `notification.requeued`, one per email | reason |
| `POST /api/orgs/[orgSlug]/memberships`, `PATCH .../[planId]`, `POST .../publish`, `.../archive` | `lib/memberships/plans.ts` | `membership_plan.created`, `.updated`, `.published`, `.archived` | changed fields |
| `POST .../memberships/members/[grantId]/revoke`, `cancel` | `lib/memberships/revocation.ts` | `membership.revoked`, `membership.free_cancelled` | reason |
| `POST .../memberships/members/[grantId]/refund`, `.../merchandise/orders/[orderId]/refund` | `lib/payments/order-refunds.ts` | `commerce_order.refund_requested`; outcome below | amount, reason |
| `POST /api/orgs/[orgSlug]/merchandise`, `PATCH .../[productId]`, `POST .../publish`, `.../archive`, `.../restore` | `lib/merchandise/catalogue.ts` | `merchandise_product.created`, `.updated`, `.published`, `.archived`, `.restored` | stock before and after per option |
| `POST .../merchandise/pickups/[orderId]` | `lib/merchandise/pickups.ts` | `merchandise_order.ready`, `merchandise_order.collected` | — |
| `POST .../merchandise/orders/[orderId]/cancel` | `lib/merchandise/after-sale.ts` | `merchandise_order.free_cancelled` | reason |
| `POST .../merchandise/orders/[orderId]/returns` | same | `merchandise_order.return_recorded` | items, back in stock |
| `PATCH /api/orgs/[orgSlug]/staff/[staffId]` | `lib/staff/management.ts` | `staff.updated` | role and access before and after |
| `POST /api/orgs/[orgSlug]/staff/handover` | `lib/staff/handover.ts` | `staff.ownership.handed_over` | — |
| `POST .../staff/invites`, `.../[inviteId]/resend`, `.../[inviteId]/revoke`; `POST /api/staff/invites/accept` | `lib/staff/invites.ts` | `staff.invite.created`, `staff.invite.resent`, `staff.invite.revoked`, `staff.invite.accepted` | role; the invited address in the sentence |
| `POST /api/me/mfa/confirm`, `verify`, `recovery-codes`, and every fresh-code staff action (refunds, cancellations, revoke, Connect dashboard and disconnect) | `lib/security/staff-mfa.ts` | `staff_mfa.enabled`, `staff_mfa.verified`, `staff_mfa.recovery_used`, `staff_mfa.recovery_codes_replaced`, one row per society the person staffs | — |
| `POST /api/stripe/connect/onboard` (new account only), `disconnect`, `dashboard` | `lib/stripe/connect.ts` | `stripe_connect.account_created`, `stripe_connect.disconnected`, `stripe_connect.dashboard_opened` (who opened the Express Dashboard, where payout details can change) | — |
| Connect webhook `account.external_account.created`, `.updated` (made default) | `lib/stripe/connect.ts` | `stripe_connect.payout_account_changed` (SEC-033; no actor, the Stripe event id and last 4 digits) | — |
| `POST /api/guest/orders/[orderId]/claim` | `lib/guest/guest-claim.ts` | `order.guest_claimed` | — |
| `POST /api/purchases/tickets/[orderId]/cancel`, `POST /api/commerce/orders/[orderId]/cancel` | `lib/purchases/pending-checkout.ts` | none: the buyer's cancel writes lifecycle events only (source `checkout`) | — |

## Stripe, workers and automatic steps

| Source | Action(s) | History actor |
| --- | --- | --- |
| Refund outcome (webhook or refunds worker, `lib/payments/order-refunds.ts`) | `order.refund_succeeded`, `order.refund_failed`, `commerce_order.refund_succeeded`, `commerce_order.refund_failed`; a pending outcome writes none, and Stripe `canceled` counts as failed | Stripe |
| Disputes (`lib/payments/purchase-disputes.ts`, `lib/commerce/payment-recovery.ts`) | first event `order.dispute_opened` / `commerce_order.dispute_opened`; a later change of outcome `*.dispute_won`, `*.dispute_lost` or `*.dispute_open` (reopened) | Stripe |
| Refund made outside Thunderstrux | `order.external_refund_recorded`, `commerce_order.external_refund_recorded` | Stripe |
| Lost dispute money taken back (refunds worker, `lib/payments/dispute-reversals.ts`, PAY-004) | `order.dispute_funds_recovered`, `commerce_order.dispute_funds_recovered` | Thunderstrux |
| Paid but unfulfilled ticket order (`lib/payments/checkout-reconciliation.ts`) | `order.compensation_refund_queued` (automatic refund) or `order.compensation_refund_review_required` | Thunderstrux |
| Compensation refunds worker (`lib/payments/compensation-refunds.ts`) | `order.compensation_refund_started`; `order.compensation_refund_review_required` when it gives up; `order.compensation_review_required` when a refund stays pending past its tries | Thunderstrux |
| Compensation outcome, worker or webhook (`` order.compensation_${state} ``) | `order.compensation_refunded`, `order.compensation_refund_failed`, `order.compensation_refund_pending` | Stripe |
| Paid but unfulfilled commerce order (`lib/commerce/payment-recovery.ts`) | `commerce_order.compensation_refund_queued` | Thunderstrux |
| Unused image cleanup (`lib/assets/maintenance.ts`) | `asset.orphan_removed` | Thunderstrux |

### Templated actions

| Template | File | Values |
| --- | --- | --- |
| `` membership_plan.${action} `` | `lib/memberships/plans.ts` | `created`, `updated`, `published`, `archived` |
| `` merchandise_product.${action} `` | `lib/merchandise/catalogue.ts` | `created`, `updated`, `published`, `archived`, `restored` |
| `` merchandise_order.${step} `` | `lib/merchandise/pickups.ts` | `ready`, `collected` |
| `` order.compensation_${state} `` | `lib/payments/compensation-refunds.ts` | `refunded`, `refund_failed`, `refund_pending`, `review_required` |
| `` ${target.action}.refund_${status} `` and `.refund_failed` | `lib/payments/order-refunds.ts` | target `order` or `commerce_order`; status `succeeded` or `failed` |
| `` order.dispute_${…} ``, `` commerce_order.dispute_${…} `` | disputes | `opened`, then `won`, `lost`, `open` |

### Older rows

- `ticket_type.created` came from the removed standalone ticket-type route (DEF-045); History still renders it ("added a ticket type to …").
- An `event.updated` row written before `changes` were recorded shows "Historical detail unavailable".

## Not recorded in History

| Route | Recorded instead |
| --- | --- |
| `auth/*`, `me/account/*`, `me/profile`, `me/notification-preferences`, `me/mfa/setup` | The person's own `AccountSecurityEvent` and private notices; not a society's business |
| `me/context` | A session preference; nothing changes |
| `orgs/[orgSlug]/join`, `leave` | A member's free join; the roster shows it |
| `stripe/connect/continue` | Opens Stripe's hosted onboarding; nothing changes until Stripe reports back |
| `payments/checkout/*`, `merchandise/quote`, `guest/email/*`, `guest/recover`, buyer cancel | Buyer actions; orders keep lifecycle journals |
| `payments/webhook`, `stripe/connect/webhook` | The services they call write their own rows; webhook tables keep idempotency |

OpenClaw actions are deferred and write nothing.

## History

- **Who can read:** `audit:read` (owners and admins) through `requireManagementPage` on `/dashboard/history`; rows of the selected society only.
- **Page:** 50 rows, newest first, cursor on `createdAt` and `id`; a bad cursor is `HistoryCursorError` ("That page of History is no longer available").
- **Filters:** category, who, from and to (whole days in the society's time zone).

| Category | Action prefixes |
| --- | --- |
| Events | `event.`, `ticket_type.` |
| Orders and refunds | `order.`, `commerce_order.`, `email_outbox.`, `notification.` |
| Memberships | `membership_plan.`, `membership.` |
| Merchandise | `merchandise_product.`, `merchandise_order.` |
| Check-ins | `ticket.checked_` (shown only under this filter, so the door doesn't bury the rest) |
| Staff and security | `staff.`, `staff_mfa.` |
| Payments setup | `stripe_connect.` |
| Society profile | `organisation.`, `asset.` |

- **Who:** a person (up to 200 distinct actors in the list), `thunderstrux` (null actor and an action in `automaticActions`: `order.compensation_refund_queued`, `order.compensation_refund_review_required`, `order.compensation_refund_started`, `order.dispute_funds_recovered`, `commerce_order.dispute_funds_recovered`, `asset.orphan_removed`) or `stripe` (any other null-actor row).
- **Actor shown:** display name, else first and last name, else the account email; a closed account shows "A former staff member"; the role label comes from `actorRole`.
- **Targets** are looked up live and always inside the society: event titles, order references (linked unless the order is pending), member names, plan and product names, staff names, invite addresses, ticket references, image kinds. A deleted event shows its stored title or "a deleted event".
- **Safe facts:** each action names its facts in `describe`, as in the tables above. Compensation review reasons map `sold_out`, `capacity`, `sales_closed` to sentences. An unknown action renders as "recorded" plus its name.

## Traps

- A new mutating route needs its row in the same transaction and a row here; a new automatic action also needs adding to `automaticActions`, or History says Stripe did it (as it does today for `commerce_order.compensation_refund_queued`).
- A new action needs a sentence in `describe`, or History shows its raw name.
- Never put buyer contact details, tokens or provider payloads in `metadata`; History hides ids but the row still holds them.

## Related

[[Authentication and Dashboard Access]] · [[Route Security Inventory]] · [[Payment Lifecycle]] · [[Database and Multi Tenancy]] · [[API Reference]]
