---
status: living
last-reviewed: 2026-10-17
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Database and Multi Tenancy]]", "[[UI Architecture Rules]]", "[[Society Profiles and Assets]]"]
sources: [lib/memberships/plans.ts, lib/commerce/orders.ts, lib/commerce/families.ts, prisma/migrations/20261030010000_memberships/migration.sql]
---

# Memberships and Merchandise

The commerce families a society sells besides tickets. Orders, lines, history, checkout and webhook routing are shared (T20, T21; see [[Payment Lifecycle]]). This note owns what each family adds. Delivery order: plans (T22), grants, renewal and the roster (T23), offers and My memberships (T24a), member prices and members-only events (T24b), then merchandise (T25 to T28).

## Membership plans (T22)

A plan (`MembershipProduct`) is one fixed term a society sells: name, description, an integer AUD price (0 for free), a half-open term `[startsAt, endsAt)` and the rights it unlocks, from a whitelist (`member_prices`, `members_only_events`) with an `entitlementVersion`. It is a one-off purchase, never a subscription, and never renews.

- **Dates.** Staff enter a first and last day. The term runs from midnight starting the first day to midnight after the last day, in the society's time zone (`termFromDays`; `daysFromTerm` reverses it), so daylight saving is handled by the zone, not the browser. Presets fill both days: Semester 1 is 1 January to 30 June, Semester 2 is 1 July to 31 December, Full year is the calendar year; every date stays editable. A day with no midnight in the zone is a field error.
- **States.** Draft, published, archived (database), shown as Draft, Published, Ended (published but past its last day) and Archived. Only published plans that have not ended are on sale (`publicPlans`, for T24a). Archive is one way: the plan stops selling and cannot be republished; holders keep their terms. Plans are never deleted.
- **Publish check** (`planReadiness`, the one rule for the button and the API): the plan ends in the future; it does not overlap another published plan of the society (one plan per period, so Semester 1 and a Full year cannot both be on sale for the same months; back-to-back terms are fine because terms are half-open); a paid plan needs payments set up, a free one does not. Saving a published plan re-runs the check for anything but a description edit.
- **Sold plans.** Once any membership order line names a plan (`CommerceOrderLine.membershipProductId`, pending or paid), its name, term, price and rights are locked; only the description changes. A database trigger backs this up and never lets a plan move society. The next year is a new plan.
- **Concurrency.** Every change holds User, then Organisation, then the plan row (`lockOrganisationActor`, then `FOR UPDATE`), with a version check (409 on a stale version). Publishing and editing published plans therefore run one at a time per society, and T23 checkout, which locks the Organisation before reading a plan, never quotes a plan mid-edit.
- **Access.** Staff with live `memberships:manage` (owners and admins) through `/api/orgs/[orgSlug]/memberships` and `/dashboard/memberships`; another society's plan is a 404. Every change is audited (`membership_plan.created`, `updated`, `published`, `archived`).

## Grants, checkout and the roster (T23a)

A `MembershipGrant` is one member's membership from one purchased line: unique per line and in the line's society, with the plan's term and rights copied onto it. Its facts never change; it can be revoked once, with a reason (T23b). Its state comes only from the clock and `revokedAt` (`grantState`): Upcoming before `startsAt`, Active in `[startsAt, endsAt)`, Expired from `endsAt`, Revoked once revoked. No job ever changes it.

- **Checkout.** The membership family is registered with commerce checkout (`lib/memberships/grants.ts`, `membershipFamily`). Body `selection: {planId}`; members only, never guests; one line of quantity 1 at the plan's price. Under the buyer, then society locks, the quote refuses a plan that is not published or has ended or belongs to another society (`plan_unavailable`), dates the member already holds (`term_overlap`), and dates with another checkout still waiting on Stripe (`purchase_in_progress`); each is a 409 with that `reason` and nothing is charged. Renewal is simply buying the next plan: terms are half-open, so a plan starting when the current one ends does not overlap.
- **Fulfilment.** A free total grants inside checkout; a paid one only from the verified webhook. Under the member, society and order locks the grant is created once (a replay finds the line's grant), with a receipt notice in the same transaction. If the member meanwhile got overlapping dates another way, the paid order goes to compensation review (`term_overlap`) and no second grant is made. Lock order: User, Organisation, then the commerce order; plan edits take the same Organisation lock.
- **Roster** (`lib/memberships/roster.ts`, `members:read`, owners and admins): `/dashboard/memberships/members` shows Active, Upcoming, Expired and Revoked grants, newest first with stable pages and name or email search, and Free joins as a separate list (a join gives no member prices; joiners who also hold a membership are marked). `/dashboard/memberships/members/[grantId]` shows the term, rights, source order (Paid or Free and its short reference), the free join, other terms and whether the person is staff; another society's grant is a 404.

## Ending a membership early (T23b)

`lib/memberships/revocation.ts`, under member, society and order locks. Both actions need a reason (8 to 500 characters) and, unless staff MFA is off, a fresh authenticator code; both are audited, email the member (`membership-ended/{grantId}`) and answer a repeat with the first result. Neither moves money.

- **Revoke** (`memberships:manage`, owners and admins): stops a running or upcoming membership now, with no refund (`membership.revoked`). An ended membership can't be revoked. Tickets already bought at a member price keep their price (T24b).
- **Cancel a free membership** (`orders:refund`): the T18c shape. The free order gets `cancelledAt`, `cancelledByUserId` and `cancellationReason` (allowed only on free, paid-status orders), keeps its status and fulfilment, gains a `free_cancelled` history entry, and its grant is revoked with the same reason. Never a refund row. A paid membership is refused (`not_cancellable`): refund it instead.
- **Leaving the society** removes only the free join; the membership stays (regression test).

The member page's Manage this membership card holds the two dialogs; Cancel free membership replaces Revoke for a free membership. Commerce order pages arrive with T29, so the cancellation lives on the member page for now.

**T23c (next):** a full refund of a paid membership order through Stripe (the T18a machinery extended to commerce orders: refund request, fence, worker and webhook), which revokes the grant once the refund is confirmed.

## Members-only gate (decided for T24b)

Design round B1 replaced the concealed 404 on a members-only event's page with a gate, under a safety contract recorded in the delivery plan: the gate reads only the event's id, status, visibility and society; no other event field reaches the page, its data or its metadata; access is checked live on every request; the page is `noindex` and `private, no-store`; listings and public APIs keep excluding the event; a missing or draft event is still a 404. T24b updates the readiness plan's wording.
