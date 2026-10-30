---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Documentation Index]]", "[[Database and Multi Tenancy]]", "[[Payment Lifecycle]]"]
sources: [prisma/schema.prisma, lib/permissions/index.ts, lib/tickets/reservations.ts, lib/stripe/fees.ts]
---

# Glossary

**Owns:** the words the product, the specs and the UI use, mapped to the names in code.
**Read when:** a request or spec says "society", "hold", "compensation", "family" and so on, and you need the model, column or file to search for.
**Not here:** the rules themselves. Each row links the note that owns them.

## People and access

| Word | In code | Owning note |
| --- | --- | --- |
| Society, club | `Organisation`; URLs `/societies/[orgSlug]`; services in `lib/organisations/` | [[Society Profiles and Assets]] |
| Member account | `User` with `accountRole` `member` (`AccountRole`) | [[Authentication and Dashboard Access]] |
| Organisation account, legacy shared login | `User` with `accountRole` `organisation`; its old `Organisation.accountUserId` pointer. Management access through it depends on `LEGACY_ORGANISATION_ACCESS_MODE` (hosted: `deny`) | [[Authentication and Dashboard Access]] |
| Staff, committee | `OrganisationStaff` (`OrganisationStaffRole`: `owner`, `admin`, `event_manager`, `finance_manager`, `check_in_staff`; `OrganisationStaffStatus`). Only an active staff row grants management access, re-checked live on every request (`lib/staff/live-authority.ts`) | [[Authentication and Dashboard Access#Roles and permissions]] |
| Joined, affiliated, follower | `OrganisationMember`: join state only, never authority. Its `role` uses the legacy `OrganisationRole` values | [[Society Profiles and Assets]] |
| Permission, capability | A string in `lib/permissions/index.ts`, such as `events:manage` or `orders:refund` | [[Authentication and Dashboard Access#Roles and permissions]] |
| Dashboard context, workspace | The society a signed-in user is acting for, held in a signed cookie (`lib/auth/context-cookie.ts`, `POST /api/me/context`); read by `requireCurrentOrganisationAccount` | [[Authentication and Dashboard Access]] |
| Invitation | `OrganisationStaffInvite` (`lib/staff/invites.ts`) | [[Authentication and Dashboard Access]] |
| Owner handover | `lib/staff/handover.ts`: moves ownership and clears the legacy `accountUserId` pointer for good | [[Authentication and Dashboard Access]] |
| MFA grant | `MfaGrant`: a 12-hour proof of a recent code for sensitive staff actions (`lib/security/staff-mfa.ts`) | [[Authentication and Dashboard Access]] |
| Guest | A buyer without an account: `GuestIdentity` (verified email), `GuestAccessGrant` (single-use links), a guest session cookie (`lib/guest/`) | [[Authentication and Dashboard Access]] |
| Closure | Irreversible account anonymisation (`lib/auth/account-closure.ts`); business and audit records stay | [[Authentication and Dashboard Access]] |
| `authVersion` | A counter on `User`; raising it ends every older session | [[Authentication and Dashboard Access]] |

## Events and tickets

| Word | In code | Owning note |
| --- | --- | --- |
| Event | `Event`; owner is `Event.organisationId`, the canonical tenant for everything sold through it | [[Event Lifecycle]] |
| Draft, published | `EventStatus` | [[Event Lifecycle]] |
| Visibility | `EventVisibility`: `public`, `unlisted`, `members_only` | [[Event Lifecycle]] |
| Sales open or closed | `EventSaleState` plus the sales close time | [[Event Lifecycle]] |
| Code: discount, promo, access, unlock, comp | `TicketCode`: percent or dollars off, or access to a hidden type (`TicketType.hidden`); 100% off is a comp | [[Event Lifecycle#Codes]] |
| Readiness (event) | `lib/events/event-readiness.ts`: whether an event can publish and which ticket types can be bought | [[Event Lifecycle]] |
| Ticket type, tier | `TicketType` | [[Event Lifecycle]] |
| Ticket | `Ticket`; whether it admits is `Ticket.validity` (`TicketValidity`: `active`, `void`, `refund_review`) | [[Payment Lifecycle]] |
| Check-in, attendance | `Ticket.checkedInAt` | [[Ticket Check-in Implementation]] |
| Event change notice | `EventChange`, sent to ticket holders through the notification outbox | [[Email Delivery Implementation]] |

## Buying and money

| Word | In code | Owning note |
| --- | --- | --- |
| Order (tickets) | `Order` (`OrderStatus`: `pending`, `paid`, `failed`, `expired`); free orders are `paid` with `paymentKind` `free` | [[Payment Lifecycle]] |
| Commerce order | `CommerceOrder` and `CommerceOrderLine`: one order type for memberships and merchandise | [[Payment Lifecycle]] |
| Family | `CheckoutFamily`: `ticket`, `membership`, `merchandise`; commerce families are registered in `lib/commerce/families.ts` | [[Payment Lifecycle]] |
| Hold, reservation | `TicketReservation` for tickets. It lasts the event's checkout hold (5 to 59 minutes, default 20), when the Stripe page is closed, plus 5 minutes (`lateWebhookGraceMs`) while Stripe can't be asked | [[Payment Lifecycle#Holds]] |
| Checkout attempt | `CheckoutAttempt`: one try at creating a Stripe Checkout Session, recovered by a worker if the answer was lost | [[Payment Lifecycle]] |
| Fulfilment | The webhook marking an order paid and issuing its tickets or grants. It is never done from the browser's success page | [[Payment Lifecycle]] |
| Purchase snapshot | Facts copied onto the order at purchase: ticket name, seller, fee, buyer contact | [[Payment Lifecycle]] |
| Platform fee | `feeAmount` on the order, from `lib/stripe/fees.ts` (`PLATFORM_FEE_RATE`, `PLATFORM_FEE_PER_ITEM`) with a `feePolicyVersion` | [[Stripe Payments and Connect]] |
| Compensation | A payment Stripe took that the order couldn't honour (sold out, expired hold). `CompensationRefundJob` (`CompensationRefundState`); the event's `compensationRefundMode` (`manual_review` or `automatic_full`) decides whether it is refunded automatically | [[Payment Lifecycle Refunds and Disputes]] |
| Review, payment review | `requiresCompensationReview` on an order: a person must decide | [[Payment Lifecycle]] |
| Refund request | `RefundRequest` (`RefundRequestStatus`): a refund Thunderstrux sends, by staff or compensation, settled by Stripe's webhook or polling | [[Payment Lifecycle Refunds and Disputes]] |
| Outside refund | A refund made in Stripe's dashboard, recorded as `externalRefundedAmount` and `external_refund_recorded` | [[Payment Lifecycle Refunds and Disputes]] |
| Dispute, chargeback | `PurchaseDispute` (`OrderDisputeStatus` on the order); a lost one queues a transfer reversal (`DisputeReversalStatus`) | [[Payment Lifecycle Refunds and Disputes]] |
| Payout | `SocietyPayout`: Thunderstrux pays a society's Stripe balance out after the event, at most once a society per UTC day; `heldMoney` in `lib/payouts/release.ts` | [[Stripe Payments and Connect]] |
| Connect account | The society's Stripe account: Accounts v2 with the Express Dashboard and the merchant and recipient configurations (PAY-023); destination charges with `on_behalf_of` | [[Stripe Payments and Connect#Connect account states]] |
| Purchases | The buyer's view of their orders (`lib/purchases/`, `/purchases`) | [[Frontend and Backend Flow]] |

## Memberships and merchandise

| Word | In code | Owning note |
| --- | --- | --- |
| Membership plan | `MembershipProduct` (`MembershipPlanStatus`) | [[Memberships and Merchandise]] |
| Membership, grant | `MembershipGrant`: one person's membership for a term | [[Memberships and Merchandise]] |
| Member price, members-only event | `MembershipEntitlement`: `member_prices`, `members_only_events` | [[Memberships and Merchandise]] |
| Product, option, variant | `MerchandiseProduct`, `MerchandiseVariant` (stock is `remaining`), `MerchandiseProductImage` | [[Memberships and Merchandise]] |
| Pickup | `MerchandisePickupStatus`: `pending`, `ready`, `collected` | [[Memberships and Merchandise]] |
| Return | `MerchandiseReturn` | [[Memberships and Merchandise]] |

## Operations

| Word | In code | Owning note |
| --- | --- | --- |
| Ticket email | `EmailOutbox`, sent by the email worker | [[Email Delivery Implementation]] |
| Notice, notification | `NotificationOutbox`, encrypted at rest (`NOTIFICATION_ENCRYPTION_KEY`) | [[Email Delivery Implementation]] |
| Audit row, History | `AuditLog`; owners and admins read it at `/dashboard/history` | [[Audit Coverage]] |
| Lifecycle event | `OrderLifecycleEvent`, `CommerceLifecycleEvent`: append-only order history | [[Payment Lifecycle]] |
| Worker, job | A script under `scripts/process-*.ts` run each minute, guarded by a `WorkerLease` | [[Production Operations#Workers and schedules]] |
| Readiness (app) | `GET /api/health/ready` | [[Production Operations]] |
| Integrity audit | `lib/ops/integrity-audit.ts` (`pnpm db:integrity:audit`) | [[Database and Multi Tenancy]] |
| Baseline, browser campaign | Isolated test runs by `scripts/run-e2e.mjs`; their run IDs are the evidence in PRs | [[E2E and Staging Payments]] |
| `_test` database | The only kind of database tests may reset (`scripts/integration-test-guards.mjs`) | [[Development Workflow]] |
| Preview | The public preview at `thunderstrux.mistayu.com`, run as project `ops-preview` | [[Production Operations]] |
| T-task, DEF/PAY/SEC/OPS IDs | Delivery task IDs from the readiness plan, and register IDs | [[Issue and Defect Register]] |
