---
status: living
last-reviewed: 2026-10-22
owner: engineering
related: ["[[Authentication and Dashboard Access]]", "[[Payment Lifecycle]]", "[[Database and Multi Tenancy]]", "[[UI Architecture Rules]]"]
sources: [lib/audit/history.ts, app/(dashboard)/dashboard/history/page.tsx, prisma/migrations/20261110010000_audit_actor_role/migration.sql, tests/integration/history.test.ts]
---

# Audit Coverage

Which mutations write an `AuditLog` row, what each row holds, and how the society History (`/dashboard/history`, T38) shows it. This closes AUD-001. Add a row here whenever a new mutation route arrives.

## Rules

- **Same transaction.** Each owning service writes its row in the transaction that makes the change. A refused or rolled-back change writes nothing, and a replayed webhook that changes nothing writes nothing.
- **Who.** `actorUserId` is the person, or null for Stripe confirmations and automatic steps.
  - Since T38 a database trigger (`AuditLog_actor_role`) copies the actor's live staff role into `actorRole` on every insert, so History shows the role held at the time.
  - Rows written before T38 have no role.
  - A closed account shows as "A former staff member".
- **Safe facts only.** `metadata` holds reasons as typed, amounts in cents, before and after values, and ids for joins. History shows only the facts `lib/audit/history.ts` names for each action.
  - Ids, Stripe account, refund and dispute ids, guest identities, image hashes and email job ids are never displayed.
  - Buyers' email addresses, card details, provider payloads and tokens are never stored in audit metadata.
- **Not accounting.** Orders keep their own lifecycle journals (`OrderLifecycleEvent`, `CommerceLifecycleEvent`) as the financial record; History links to them.
- **Older rows.** An `event.updated` row written before T38 has no `changes` and shows "Historical detail unavailable".

## Route to audit matrix

| Route | Service | Audit action(s) | Facts shown |
| --- | --- | --- | --- |
| `POST /api/orgs` | `lib/organisations/bootstrap.ts` | `organisation.created` | — |
| `PATCH /api/orgs/[orgSlug]/profile` | `lib/organisations/profile.ts` | `organisation.profile_updated` | Changed fields |
| `POST/DELETE /api/orgs/[orgSlug]/assets` | `lib/assets/service.ts` | `asset.uploaded`, `asset.deleted`; cleanup job `asset.orphan_removed` | Image kind |
| `POST /api/events` | `lib/events/event-lifecycle.ts` | `event.created` (title) | — |
| `PATCH /api/events/[eventId]` | same | `event.updated` with `changes` (T38) | Title, times, place, capacity, sales close, visibility, image, description changed, ticket types added, removed, renamed, repriced or restocked |
| `PATCH /api/events/[eventId]/publish` | same | `event.published`, `event.unpublished` | — |
| `PATCH /api/events/[eventId]/sales` | same | `event.sales_closed`, `event.sales_reopened` | — |
| `DELETE /api/events/[eventId]` | same | `event.deleted` (title, T38) | — |
| `POST /api/events/[eventId]/ticket-types` | same | `ticket_type.created` | Ticket type |
| `POST /api/tickets/[ticketId]/check-in`, `check-out` | `lib/tickets/check-in.ts` | `ticket.checked_in`, `ticket.checked_out` | Ticket reference (Check-ins filter only) |
| `POST /api/orders/[orderId]/refunds` | `lib/payments/order-refunds.ts` | `order.refund_requested`; webhook `order.refund_{succeeded,pending,failed,canceled}`, `order.refund_failed` | Amount, reason |
| `PATCH /api/orders/[orderId]/refund-manual` | `lib/orders/order-detail.ts` | `order.manual_refund_marked` | — |
| `POST /api/orders/[orderId]/review` | `lib/payments/purchase-disputes.ts` | `order.external_refund_reviewed`, `order.dispute_resolved`; webhook `order.external_refund_recorded`, `order.dispute_*` | Refunded amount, reason, tickets restored |
| `POST /api/orders/[orderId]/cancel` | `lib/payments/free-cancellation.ts` | `order.free_cancelled` | Reason, tickets voided |
| `POST /api/orders/[orderId]/compensation-refund/confirm` | `lib/payments/compensation-refunds.ts` | `order.compensation_refund_confirmed`; automatic `order.compensation_refund_{queued,review_required,started}`, webhook `order.compensation_*` | Why it is in review |
| `POST /api/orders/[orderId]/resend` | `lib/email/ticket-email-outbox.ts` | `order.ticket_email_queued` | — |
| `POST /api/orders/[orderId]/email-jobs/[jobId]/requeue` | same | `email_outbox.requeued` | Reason |
| `POST /api/notifications/[jobId]/requeue` | `lib/email/notification-outbox.ts` | `notification.requeued` | — |
| `POST/PATCH /api/orgs/[orgSlug]/memberships…` (create, edit, publish, archive) | `lib/memberships/plans.ts` | `membership_plan.{created,updated,published,archived}` | Changed fields |
| `POST …/memberships/members/[grantId]/revoke`, `cancel` | `lib/memberships/revocation.ts` | `membership.revoked`, `membership.free_cancelled` | Reason |
| `POST …/memberships/members/[grantId]/refund`, `…/merchandise/orders/[orderId]/refund` | `lib/payments/order-refunds.ts` | `commerce_order.refund_requested`; webhook `commerce_order.refund_*` | Amount, reason |
| `POST/PATCH /api/orgs/[orgSlug]/merchandise…` (create, edit, publish, archive, restore) | `lib/merchandise/catalogue.ts` | `merchandise_product.{created,updated,published,archived,restored}` | Stock before and after per option (T38) |
| `POST …/merchandise/pickups/[orderId]` | `lib/merchandise/pickups.ts` | `merchandise_order.{ready,collected}` | — |
| `POST …/merchandise/orders/[orderId]/cancel`, `returns` | `lib/merchandise/after-sale.ts` | `merchandise_order.free_cancelled`, `merchandise_order.return_recorded` | Reason, items, back in stock |
| `PATCH /api/orgs/[orgSlug]/staff/[staffId]` | `lib/staff/management.ts` | `staff.updated` | Role and access before and after |
| `POST /api/orgs/[orgSlug]/staff/handover` | `lib/staff/handover.ts` | `staff.ownership.handed_over` | — |
| `POST …/staff/invites`, `resend`, `revoke`; `POST /api/staff/invites/accept` | `lib/staff/invites.ts` | `staff.invite.{created,resent,revoked,accepted}` | Role |
| `POST /api/me/mfa/confirm`, `verify` | `lib/security/staff-mfa.ts` | `staff_mfa.{enabled,verified,recovery_used}` in each society the person staffs | — |
| `POST /api/stripe/connect/onboard`, `disconnect`, `dashboard` | `lib/stripe/connect.ts` | `stripe_connect.account_created`, `stripe_connect.disconnected`, `stripe_connect.dashboard_opened` (who opened the society's Express Dashboard, where payout details can change) | — |
| `POST /api/guest/orders/[orderId]/claim` | `lib/guest/guest-claim.ts` | `order.guest_claimed` | — |

## Not in society History, and why

| Route | Where it is recorded instead |
| --- | --- |
| `auth/*`, `me/account/*`, `me/profile`, `me/notification-preferences`, `me/mfa/setup` | A person's own account: `AccountSecurityEvent` and private security notices (T04). Not a society's business. |
| `me/context` | A session preference with no business change. |
| `orgs/[orgSlug]/join`, `leave` | A member's free join; the roster shows it and engagement counts it. |
| `stripe/connect/continue` | Opens Stripe's hosted onboarding; nothing changes until Stripe reports back. |
| `payments/checkout/*`, `merchandise/quote`, `guest/email/*`, `guest/recover`, `guest/session` | Buyer checkouts and guest access; orders hold their own lifecycle journals. |
| `payments/webhook`, `stripe/connect/webhook` | Stripe's events change orders through the services above, which write their own rows; the webhook tables keep idempotency. |

OpenClaw actions are deferred and write nothing (see the PRD §6.12).
