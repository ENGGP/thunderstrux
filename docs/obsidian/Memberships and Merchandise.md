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

`MembershipGrant` exists from T22 but is written by T23: one grant per purchased line (unique, same society), term and rights copied from the plan, facts immutable, revocable once with a reason. Its state is computed from the clock and `revokedAt`, never stored.

The membership commerce family is registered with checkout in T23, together with the fulfilment that creates grants; until then `/api/payments/checkout/membership` answers 404.

## Members-only gate (decided for T24b)

Design round B1 replaced the concealed 404 on a members-only event's page with a gate, under a safety contract recorded in the delivery plan: the gate reads only the event's id, status, visibility and society; no other event field reaches the page, its data or its metadata; access is checked live on every request; the page is `noindex` and `private, no-store`; listings and public APIs keep excluding the event; a missing or draft event is still a 404. T24b updates the readiness plan's wording.
