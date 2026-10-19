---
status: living
last-reviewed: 2026-10-19
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Memberships and Merchandise]]", "[[Event Lifecycle]]", "[[Database and Multi Tenancy]]"]
sources: [lib/analytics/range.ts, lib/analytics/metrics.ts, app/(dashboard)/dashboard/events/[eventId]/page.tsx, app/(dashboard)/dashboard/page.tsx, prisma/migrations/20261109010000_analytics_indexes/migration.sql]
---

# Analytics and Calendar

Society metrics (T31), the analytics pages that show them (T32) and the society calendar (T33). The readiness plan §6 owns the definitions; this note records how they are computed.

## Metrics service (T31)

`lib/analytics` is the only place that computes sales, attendance and engagement numbers. Every number is aggregated in PostgreSQL from the owning facts; nothing loads orders into memory to sum them (PERF-002, resolved).

**Ranges** (`range.ts`). A range is whole local days in the society's time zone, at most 366, grouped by day, week (from Monday) or month. Bounds and buckets are computed in SQL from the zone (`AT TIME ZONE`), so a local day stays a local day across daylight saving changes and a sale at 00:30 on the 1st belongs to that month. Every bucket is returned, zero-filled. The default is the last 30 days by day. Bad dates, an end before the start, more than 366 days or another grouping raise `AnalyticsRangeError`.

**Ownership.** An event's society owns its ticket orders (`Event.organisationId`, never `Order.organisationId`); a commerce order names its society. An event filter is applied inside the society filter, so another society's event id finds nothing.

**Money access.** `analyticsAccess(role)` gives money only to roles with both `analytics:read` and `orders:read` (owners, admins, finance managers). Without it every money field is `null`, decided on the server; event managers still get units, attendance, stock and engagement.

| Read | What it returns |
| --- | --- |
| `ticketMetrics(org, range, access, eventId?)` | Gross, refunded, net and platform fees; fulfilled and free orders; issued, valid and free tickets; orders started, completed, pending, in payment review and abandoned (by creation); attendance; a zero-filled series of money, orders, tickets and orders started. |
| `ticketAttendance(org, {eventId} or {range})` | Valid tickets, checked-in valid tickets, the check-in rate (`null` with no valid tickets: not 0%) and tickets checked in that are no longer valid (refunded or voided after entry). Without an event it covers events starting in the range. |
| `eventTicketTypeMetrics(org, eventId, access)` | Per ticket type, all time: remaining stock, issued, valid, free and checked-in units, gross, refunded and net. |
| `membershipMetrics(org, range, access)` | Sales and refunds, grants made, renewals (a grant that follows an earlier one with no overlap) and distinct members holding a membership at the end of the range (or now). |
| `merchandiseMetrics(org, range, access)` | Sales, refunds and items sold over the range; pickups preparing, ready and collected, published stock remaining and units held in checkouts, as they are now. |
| `engagementMetrics(org, range)` | Free joins over the range and joined now; distinct members who bought anything or checked in, and how many of each have joined or hold a membership. Observed purchases and check-ins only; visits are not tracked. |
| `societySales(org, range, access)` | Gross by family (tickets, memberships, merchandise) and their total, each summed on its own. |

**Definitions.**
- **Gross** is fulfilled, Stripe-paid, positive totals, by fulfilment time. Pending, failed, expired, payment-review and free orders are never money.
- **Refunds** are Stripe-confirmed refunds (`RefundRequest` succeeded), by the time they were confirmed. A refund covers the whole order and reverses its platform fee. Not included: refunds made in the Stripe dashboard, which are recorded on the order without a date, and compensation refunds of orders that were never fulfilled, which were never gross.
- **Net sales** is gross less refunds over the same days. A refund lowers the period it happened in, so a period can be negative. This is a refund-date series, not a purchase cohort.
- **Platform fees** are fees on gross less fees reversed by refunds. Thunderstrux does not know Stripe's processing costs or payouts, so nothing is called profit or payout.
- **Units** are actual `Ticket` rows on fulfilled orders. Issued keeps history; valid excludes void and refund review.
- Ticket counts are aggregated in their own query, so order totals are never multiplied by tickets. Merchandise items come from lines in a per-order subquery.

**Where it is used.**
- The event **Summary** shows tickets sold (issued, with paid and free and how many are no longer valid), tickets left, capacity, checked in (count, valid and rate) and, with money access, **net sales** (gross and refunded in the note). It also shows the ticket table (sold is issued units; revenue is gross) and **Sales over time**: gross by the day sales completed in the society's zone, zero-filled from the first paid sale to the last, by week past two months, over at most the last 366 days. It used to bucket by UTC day.
- The **Overview** "Revenue this month" is gross across all three families since the 1st of the month in the society's zone (`societySales`). It used to sum ticket orders since the server clock's month start, and now needs `analytics:read` as well as `orders:read`.
- The events list's `N sold` stays a per-page database sum of paid order quantities, the same count as issued units.

T32 builds `/dashboard/analytics` on these reads.

**Indexes** (migration `20261109010000_analytics_indexes`). These were chosen from `EXPLAIN ANALYZE` on synthetic `_test` data:
- The data: one society with 40 events and 160,000 ticket orders (360,000 orders, 648,000 tickets, 88,000 commerce orders, 6,466 refunds and 20,011 joins across 11 societies).
- `Order(eventId, fulfilledAt)` took a 30-day ticket sales read from 88.6 ms to 16.5 ms.
- `CommerceOrder(organisationId, kind, fulfilledAt)` took a 30-day merchandise sales read from 10.6 ms to 3.1 ms.
- Year-long reads keep their scans, which is right at that selectivity. The slowest was counting tickets for a year: 1,042 ms with a count per order, 311 ms after rewriting it as one grouped join.

This is local plan evidence for PERF-001. Index usage and write overhead in a hosted database are still unobserved (H05).
