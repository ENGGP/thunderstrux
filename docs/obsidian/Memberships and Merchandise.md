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

## Refunding a paid membership (T23c)

Refund membership on the member page (`orders:refund`; reason, the order's short reference typed back and the authenticator code) starts a whole-order Stripe refund through the shared refund path (see [[Payment Lifecycle]], Whole-Order Refunds). The membership stays active while Stripe processes it (the page shows Refund processing) and is revoked only when Stripe confirms; the member is emailed once. A failed or refused refund leaves it active. Tickets bought at a member price keep their price. Disputes and refunds made in Stripe's dashboard are not yet projected for commerce orders (PAY-003).

## Offers, buying and My memberships (T24a)

`lib/memberships/offers.ts` decides what members see; checkout re-checks everything under locks.

- **Society page.** `components/organisations/society-header.tsx` is shared by Overview and `/societies/[slug]/memberships`: cover, logo, name, the viewer's `Joined` badge and, separately, `Member until {last day}` while a membership runs, then the section tabs (Memberships only while a plan is on sale). A free join never shows Member until.
- **Offers** (`membershipOffers`): published plans still to end, soonest first, each with the viewer's standing: `held` (their plan; "You're a member until …" or "starts …"), `covered` (another of their memberships overlaps; no button), `pending` (their checkout for those dates is confirming) or `available` (Buy membership, Get free membership, or Renew for {plan} when it starts after a membership they hold ends). Signed out: Sign in to buy membership; unverified: a verify prompt; organisation accounts: no button.
- **Review** (`/societies/[slug]/memberships/[planId]/checkout`, CheckoutShell): verified member accounts only. Term, unlocks, money summary, "Your cover" when it follows a membership they hold, the refund policy and support address. Dates already held or confirming show the refusal instead of the button. The button keeps one idempotency key per intent, follows Stripe, a free fulfilment or a still-confirming attempt, and names each refusal (`term_overlap`, `purchase_in_progress`, `plan_unavailable`, a changed price) with "Nothing has been charged".
- **Return page** (`/memberships/orders/[orderId]`): Stripe's success and cancel URLs for a membership both land here (`?left=1` on cancel). Only the buyer sees it; it shows the order's real state (confirming with a poller, You're a member, upcoming from a date, no payment taken, or being checked when it went to compensation review) and never fulfils anything.
- **My memberships** (`/memberships`, personal menu Memberships, `myMemberships`): Active, Upcoming, Expired and Revoked tabs with counts; each card shows the society, plan, dates in the society's zone, unlocks, Paid or Free, what ended it early (a refund, the society's cancellation or revocation with its reason) and Renew for the next published plan that starts after it ends and overlaps none of their memberships there. "Memberships don't renew automatically" stays visible.
- **My societies**: each joined society shows `Joined` and, while a membership runs, `Member until`; leaving says the membership is not affected.

## Member prices (T24b1)

- **Setting it.** Each ticket type has an optional Member price in the builder (`TicketType.memberPrice`, at most the price). The builder warns while no published plan still to end unlocks member prices (`memberPricesOnSale`).
- **Who pays it.** A member account whose running membership in the event's society (unrevoked, started, not ended) carries `member_prices` (`activeEntitlementGrant`). A free join, an upcoming, expired or revoked membership, one without that right, another society's membership and every guest pay the standard price.
- **Checkout.** Under the buyer, event and ticket-type locks the quote uses the member price, so a buyer sending the other price gets the 409 quote change with the price that applies. The order records `membershipGrantId` and `membershipEntitlementVersion` (both or neither; fixed by a trigger) and charges the member price; a member price of zero is a free registration with the grant recorded, even when the society can't take payments.
- **Fulfilment.** The grant is read `FOR SHARE`: a membership revoked or refunded before the payment landed sends the order to compensation review (`member_price_membership_revoked`) and issues no tickets; a membership that simply ended during the 30-minute hold keeps the price. Tickets already issued at a member price are never repriced or voided by a later revocation.
- **Showing it.** `priceForViewer` prices the event page and ticket checkout per viewer: a member sees the member price with the standard one struck through and "Member price through your {plan} membership"; anyone else sees "Members pay $X", that joining doesn't include it, and a link to the society's memberships.

## Members-only gate (decided for T24b2)

Design round B1 replaced the concealed 404 on a members-only event's page with a gate, under a safety contract recorded in the delivery plan: the gate reads only the event's id, status, visibility and society; no other event field reaches the page, its data or its metadata; access is checked live on every request; the page is `noindex` and `private, no-store`; listings and public APIs keep excluding the event; a missing or draft event is still a 404. T24b updates the readiness plan's wording.
