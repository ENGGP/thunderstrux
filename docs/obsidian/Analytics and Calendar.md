---
status: living
last-reviewed: 2026-10-22
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Memberships and Merchandise]]", "[[Event Lifecycle]]", "[[Database and Multi Tenancy]]"]
sources: [lib/analytics/range.ts, lib/analytics/metrics.ts, app/(dashboard)/dashboard/events/[eventId]/page.tsx, app/(dashboard)/dashboard/page.tsx, lib/events/calendar.ts, components/calendar/layout.ts, components/calendar/calendar-views.tsx, app/(dashboard)/dashboard/calendar/page.tsx, app/api/orgs/[orgSlug]/calendar/route.ts, prisma/migrations/20261109010000_analytics_indexes/migration.sql]
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
- The **Overview** "Sales this month" (T34; "Revenue this month" before it) is gross across all three families since the 1st of the month in the society's zone (`societySales`). It needs `analytics:read` and `orders:read`. Event managers see "Tickets issued this month" (`ticketMetrics`) instead.
- The events list's `N sold` stays a per-page database sum of paid order quantities, the same count as issued units.

T32 builds `/dashboard/analytics` on these reads.

## Analytics page (T32)

`/dashboard/analytics` (sidebar group Insights, `analytics:read`) follows design round C1 (passes 1 and 2 approved 19 to 22 Oct 2026). The range, grouping, tab and event filter live in the URL (`?tab=&from=&to=&bucket=&eventId=`), so a view can be shared and Back works. Quick ranges are Last 7 days, Last 30 days (the default), This month and Last 12 months (by month). A range over 366 days, an end before its start or a date that doesn't exist shows "Pick a shorter range" and falls back to the last 30 days. The header names the range, grouping, the society's zone and when it was read; the numbers stream in behind a skeleton.

- **Tickets** (default): for finance roles, Gross sales, Refunded and Net sales tiles; tickets issued, still valid, checked in, orders started and platform fees; a chart of gross with refunded under it; and the same numbers in a table. For event managers, Tickets issued, Checked in and Attendance rate tiles and a chart of tickets issued, with no money anywhere in the page. The event filter lists only the society's events; any other id is ignored.
- **Memberships** (finance roles): Members now, New memberships (new and renewals), Net sales; a chart of new members and renewals; table; free memberships, refunds and platform fees.
- **Merchandise** (finance roles): Gross, Refunded, Net; a chart of gross; pickups and stock now, with a link to Pickups for staff who hand orders out; table.
- **Engagement** (`analytics:read`): Joined now, New joins, People who bought; a chart of joins; who took part (bought something, checked in) with how many joined or hold a membership.

Tabs a role can't use aren't offered, and asking for one by URL shows Tickets. A range with nothing in it shows an empty state instead of a chart. Each tab explains how it counts in "How these numbers are counted".

`components/analytics/bar-chart.tsx` (`BarChart`) draws vertical bars from 768px and a horizontal list on phones; its accessible name lists every value, and the analytics tabs also show the numbers in a `ResponsiveTable`. The event Summary's Sales over time uses the same chart.

**Indexes** (migration `20261109010000_analytics_indexes`). These were chosen from `EXPLAIN ANALYZE` on synthetic `_test` data:
- The data: one society with 40 events and 160,000 ticket orders (360,000 orders, 648,000 tickets, 88,000 commerce orders, 6,466 refunds and 20,011 joins across 11 societies).
- `Order(eventId, fulfilledAt)` took a 30-day ticket sales read from 88.6 ms to 16.5 ms.
- `CommerceOrder(organisationId, kind, fulfilledAt)` took a 30-day merchandise sales read from 10.6 ms to 3.1 ms.
- Year-long reads keep their scans, which is right at that selectivity. The slowest was counting tickets for a year: 1,042 ms with a count per order, 311 ms after rewriting it as one grouped join.

This is local plan evidence for PERF-001. Index usage and write overhead in a hosted database are still unobserved (H05).

## Calendar (T33)

`/dashboard/calendar` (sidebar, under Events, `events:read`) follows design round C1 (passes 1 and 2 approved 19 to 22 Oct 2026). It is a projection of `Event` rows: nothing is copied into a calendar table, there are no recurring series, and nothing syncs to Google or Apple calendars or publishes a feed.

**Source** (`lib/events/calendar.ts`). `readCalendar` takes whole local days in the society's zone, at most 93 (`calendarRange` refuses more, a day that doesn't exist or an end before its start). It returns every event that overlaps them (`startTime` before the range's end and `endTime` after its start), so a camp from Friday to Monday shows in both months. The bounds come from SQL `AT TIME ZONE`, as for analytics. At most 500 events come back; more sets `truncated` and the page says so.
- Drafts need `events:manage`. Check-in staff and finance managers see published events only.
- Membership end dates need `members:read`: per plan and last day, the number of members whose unrevoked term ends then. The last day is the day before `endsAt`, which is exclusive.
- `GET /api/orgs/[orgSlug]/calendar?from=&to=` serves the same read. It needs a live staff role with `events:read` and MFA where enforced. Another society's slug is a 404, and a bad range is a 400. Responses are `private, no-store`.

**Page.** `?view=month|week|agenda&date=YYYY-MM-DD` (month and today by default; a date that isn't a real day falls back to today with a notice).
- **Month** shows whole Monday-to-Sunday weeks with up to three entries a day and "+N more" linking to that day in the agenda.
- **Week** has an all-day row for membership endings and events of 24 hours or more, then hours from 8 am (earlier when an event starts earlier) to midnight. It shows a line for now, and overlapping events sit side by side.
- **Agenda** lists days with entries. Earlier days of the current month fold into "Earlier this month", and a next-period link sits at the end.
- Phones (below 768px) get the agenda only, and the view switch is hidden.
- Entries open the event's Summary, or its Attendees for check-in staff. Membership endings open Members. No money or booking shows on the calendar.
- Managers get "New event" in the header and on each day from today (on hover or keyboard focus). The builder then opens with that day, 6 to 8 pm (`/dashboard/events/new?date=`).

**Time** (`components/calendar/layout.ts`). Every day and time is the society's zone, read with `Intl`, never the server's or browser's.
- An event shorter than 24 hours, even past midnight, sits on the day it starts with its end day named ("10:00 pm to 2:00 am Sun"). Longer events span each day they touch, splitting at week edges with "continues" and "until". The small hours belong to the night before: a day it reaches only by 6:00 am doesn't count, so a workshop from Wednesday 1:00 am to Thursday 3:00 am sits on Wednesday alone, in the month and in Wednesday's time grid from 1 am (fixed 23 Oct 2026; before, it spanned both days and sat in the week's All day row). Spanning events still use the All day row in the week. Every month chip carries its full name and times as a tooltip.
- A day when the clocks change carries a marker ("Clocks go forward at 2 am"). A time inside the hour that happens twice carries its abbreviation ("2:30 am AEDT", then "2:30 am AEST").
- The builder still rejects or asks about local times that don't exist or happen twice (EVT-001).

No index was added. The read uses the existing `Event(organisationId)` and `MembershipGrant(endsAt)` indexes over at most 93 days; a measured index waits for evidence, as the database spec §14 asks.
