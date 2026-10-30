---
status: living
last-reviewed: 2026-10-26
owner: engineering
related: ["[[Payment Lifecycle]]", "[[Memberships and Merchandise]]", "[[Event Lifecycle]]", "[[Database and Multi Tenancy]]"]
sources: [lib/analytics/range.ts, lib/analytics/metrics.ts, app/(dashboard)/dashboard/analytics/page.tsx, app/(dashboard)/dashboard/analytics/analytics-tabs.tsx, app/(dashboard)/dashboard/events/[eventId]/page.tsx, app/(dashboard)/dashboard/society-overview.tsx, lib/events/calendar.ts, components/calendar/layout.ts, components/calendar/calendar-views.tsx, app/(dashboard)/dashboard/calendar/page.tsx, app/api/orgs/[orgSlug]/calendar/route.ts]
---

# Analytics and Calendar

**Owns:** society metrics (what each number counts and how), the analytics page, the event Summary's sales numbers and chart, the Overview sales tile, and the society calendar.
**Read when:** changing a metric, a range or bucket rule, the analytics or calendar pages, or anything that reads orders, refunds or tickets for reporting.
**Not here:** order, refund and ticket states ([[Payment Lifecycle]], [[Payment Lifecycle Refunds and Disputes]]); membership and merchandise rules ([[Memberships and Merchandise]]); event times and editing ([[Event Lifecycle]]); indexes ([[Database and Multi Tenancy#Indexes]]); page guards ([[Frontend and Backend Flow]]).

## Code

| Concern | Where |
| --- | --- |
| Ranges, buckets, zero fill | `lib/analytics/range.ts`: `analyticsRange`, `bucketOf`, `within`, `zeroFill`, `AnalyticsRangeError` |
| Metrics | `lib/analytics/metrics.ts` |
| Analytics page | `app/(dashboard)/dashboard/analytics/page.tsx`, `app/(dashboard)/dashboard/analytics/analytics-tabs.tsx` on `/dashboard/analytics` |
| Event Summary | `app/(dashboard)/dashboard/events/[eventId]/page.tsx` (`SalesOverTime`) |
| Overview tile | `app/(dashboard)/dashboard/society-overview.tsx` |
| Chart | `components/analytics/bar-chart.tsx`: `BarChart` |
| Calendar read and API | `lib/events/calendar.ts`: `readCalendar`, `calendarRange`; `GET /api/orgs/[orgSlug]/calendar` |
| Calendar page and layout | `app/(dashboard)/dashboard/calendar/page.tsx`, `components/calendar/calendar-views.tsx`, `components/calendar/layout.ts` |
| Tests | `tests/integration/analytics-metrics.test.ts`, `tests/integration/analytics-page.test.ts`, `tests/integration/calendar.test.ts`, `tests/e2e/analytics.spec.ts`, `tests/e2e/calendar.spec.ts` |

## Ranges

- A range is whole local days in the society's zone, at most `maxRangeDays` (366), grouped by `day`, `week` (from Monday) or `month`. The default is the last 30 days by day. The page shows by day up to `maxDailyDays` (62); a longer range asked for by day shows by week with a notice (`tooLongByDay`), which the event Summary's chart also uses.
- Bounds and buckets are computed in SQL with `AT TIME ZONE` (`startOf`, `endOf`, `bucketOf`), so a local day stays a local day across daylight saving and a sale at 00:30 on the 1st belongs to that month.
- Every bucket is returned; missing ones are zero (`zeroFill`).
- Bad dates, an end before the start, more than 366 days or another grouping raise `AnalyticsRangeError`.

## Rules

- **One place:** `lib/analytics/metrics.ts` computes every sales, attendance and engagement number, aggregated in PostgreSQL. Nothing loads orders to sum them.
- **Ownership:** a ticket order belongs to its event's society (`Event.organisationId`, never `Order.organisationId`); a commerce order names its society. An event filter sits inside the society filter, so another society's event id finds nothing.
- **Money access:** `analyticsAccess(role)` gives money only to roles with both `analytics:read` and `orders:read` (owners, admins, finance managers). Otherwise every money field is `null`, decided on the server; event managers still get units, attendance, stock and engagement.
- **No multiplying:** tickets are counted in their own query, refunds in another, and merchandise items in a per-order subquery, so totals never multiply across joined rows.

## Metric definitions

| Number | Counts |
| --- | --- |
| **Gross** | `totalAmount` of orders with `status = paid`, `fulfilledAt` set, `paymentKind = stripe` and a positive total, bucketed by `fulfilledAt`. Pending, failed, expired, payment-review and free orders are never money. A later refund doesn't remove a sale from gross |
| **Refunded** | `RefundRequest` rows with `status = succeeded`, by `resolvedAt` |
| **Net** | gross − refunded over the same buckets. A refund lowers the period it happened in, so a period can be negative; this is not a purchase cohort |
| **Platform fees** | `feeAmount` on gross orders − `feeAmount` of the refunded orders |
| **Orders** | fulfilled orders (`fulfilledOrders`), and of them free (`freeOrders`) |
| **Tickets issued** | `Ticket` rows on fulfilled orders, by the order's `fulfilledAt`; issued keeps history |
| **Tickets valid / free** | issued with `validity = active` / on free orders |
| **Orders started, completed, pending, in review, abandoned** | orders by `createdAt`: all, `paid`, `pending`, `requiresCompensationReview`, and `failed` or `expired` not under review |
| **Attendance** (`ticketAttendance`) | `active` tickets, those checked in, the rate (`null` with no valid tickets, not 0%), and tickets checked in that are no longer valid. One event, or events starting in the range |
| **Members now** | distinct users with an unrevoked `MembershipGrant` covering the range's end (or now, if sooner) |
| **New memberships, renewals** | grants by `grantedAt`; a renewal follows an earlier grant of the same member and society that ended before it started |
| **Merchandise items** | sum of line quantities on fulfilled merchandise orders |
| **Pickups, stock** (as now) | paid merchandise orders preparing or ready (not refunded or cancelled) and collected; remaining stock of published, unarchived variants; units in live checkouts |
| **Engagement** | free joins (`OrganisationMember` role `member`) by `createdAt`; joined now; distinct members who bought (fulfilled, any family) or checked in during the range, and how many of each joined or hold a membership. Observed purchases and check-ins only; visits aren't tracked |

**What isn't in refunds:** ticket compensation refunds (they are `CompensationRefundJob`, not `RefundRequest`, and their orders were never gross); refunds made in Stripe's dashboard (recorded on the order without a date); the manual "refunded outside Thunderstrux" mark. Nothing is called profit or payout: Thunderstrux doesn't know Stripe's processing costs.

**Refunds count only for fulfilled orders.** A commerce compensation refund is a `RefundRequest` too, but its order was never fulfilled and so never in gross; counting it would push net sales and fees below zero.

**Fees reversed are pro rata:** each refund reverses `round(feeAmount × refund amount ÷ totalAmount)` of its order's fee, as Stripe's `refund_application_fee` returns it. So "Refund the rest" after a partial refund in Stripe reverses only the rest's share.

## Reads

| Read | Returns |
| --- | --- |
| `ticketMetrics(org, range, access, eventId?)` | Totals and a series of gross, refunded, net, fees, orders, tickets issued and orders started; with attendance |
| `ticketAttendance(org, { eventId } or { range })` | Attendance as above |
| `eventTicketTypeMetrics(org, eventId, access)` | Per ticket type, all time: remaining (`TicketType.quantity`), issued, valid, free and checked-in units, gross, refunded, net |
| `eventCodeMetrics(org, eventId, access)` | Per ticket code, all time: tickets issued and still valid on completed orders; discount given and gross for money roles |
| `eventSalesDays(org, eventId, timeZone)` | The first and last local day the event had a paid Stripe sale, or `null` |
| `membershipMetrics(org, range, access)` | Sales, refunds, grants, renewals, members now |
| `merchandiseMetrics(org, range, access)` | Sales, refunds, items; pickups and stock as now |
| `engagementMetrics(org, range)` | Joins and participation as above |
| `societySales(org, range, access)` | Gross by family (tickets, memberships, merchandise) and total, each summed on its own; `null` without money access |

## Where the numbers show

- **Analytics page** (`/dashboard/analytics`, sidebar Insights, `analytics:read`). Range, grouping, tab and event live in the URL (`?tab=&from=&to=&bucket=&eventId=`); the event filter lists the 100 newest events plus the selected one (`listEventOptions`), and the range fields fold on phones. Quick ranges: Last 7 days, Last 30 days (default), This month, Last 12 months (by month). A bad range shows "Pick a shorter range" and falls back to the last 30 days. The header names the range, grouping, the society's zone and when it was read.
  - **Tickets** (default): money tiles, counts, a chart of gross with refunded, and a table for finance roles. Event managers see tickets issued, checked in and the attendance rate, with no money anywhere. The event filter lists only the society's events; any other id is ignored.
  - **Memberships** and **Merchandise** (finance roles only), and **Engagement** (`analytics:read`). A tab the role can't use isn't offered; asking by URL shows Tickets.
  - Each tab explains itself under "How these numbers are counted". An empty range shows an empty state instead of a chart.
- **Event Summary:** tickets sold (issued, split paid and free, and how many are no longer valid), tickets left, capacity, checked in, and for money roles net sales with gross and refunded. The ticket table uses `eventTicketTypeMetrics`; a Codes table (`eventCodeMetrics`) follows when the event has codes. **Sales over time** is gross by local day from `eventSalesDays`' first to last day, by week once that spans more than 62 days, over at most the last 366 days.
- **Overview tile** (`society-overview.tsx`): money roles see **Sales this month**, `societySales` gross since the 1st in the society's zone. Others with `analytics:read` see **Tickets issued this month** (`ticketMetrics`).
- **Events list:** `N sold` counts the event's tickets whose `validity` is `active` (`lib/events/event-lifecycle.ts`), so free registrations count and refunded, cancelled and disputed tickets don't. Only roles with `analytics:read` see it.
- `BarChart` draws vertical bars from 768 px and a horizontal list on phones; its accessible name lists every value, and the analytics tabs repeat the numbers in a table.

**Indexes:** `Order(eventId, fulfilledAt)` and `CommerceOrder(organisationId, kind, fulfilledAt)` serve sales by fulfilment time (`prisma/migrations/20261109010000_analytics_indexes/migration.sql` records the measurements). Year-long reads still scan. See [[Database and Multi Tenancy#Indexes]].

## Calendar

`/dashboard/calendar` (sidebar, under Events, `events:read`) is a projection of `Event` rows. Nothing is copied into a calendar table; there are no recurring series, no Google or Apple sync and no feed.

**Read** (`readCalendar`):
- Takes whole local days in the society's zone, at most `maxCalendarDays` (93). `calendarRange` refuses more, a day that doesn't exist, or an end before the start.
- Returns every event that overlaps the range (`startTime` before its end and `endTime` after its start), so a camp from Friday to Monday shows in both months. Bounds come from SQL `AT TIME ZONE`.
- At most `calendarEventCap` (500) events; more sets `truncated` and the page says so.
- Drafts need `events:manage`; others see published events only.
- Membership end dates need `members:read`: per plan and last day, the number of members whose unrevoked term ends then. The last day is the day before `endsAt`, which is exclusive.

**API:** `GET /api/orgs/[orgSlug]/calendar?from=&to=` serves the same read to a live staff role with `events:read`. Another society's slug is 404, a bad range 400, and responses are `private, no-store`.

**Indexes:** none was added. The event read filters `organisationId` (and `status` for staff without `events:manage`) and checks the overlap on those rows; the measured plan uses `Event(organisationId, status)`. Membership endings use `MembershipGrant(endsAt)`. Details: [[Database and Multi Tenancy#Indexes]].

**Page:** `?view=month|week|agenda&date=YYYY-MM-DD`; month and today by default. A date that isn't a real day falls back to today with a notice.
- **Month:** whole Monday-to-Sunday weeks, up to three entries a day and "+N more" linking to that day in the agenda.
- **Week:** an all-day row for membership endings and events of 24 hours or more, then hours from 8 am (earlier if an event starts earlier) to midnight, a line for now, and overlapping events side by side.
- **Agenda:** days with entries. Earlier days of this month fold into "Earlier this month", and a next-period link ends the list.
- Phones (below 768 px) get the agenda only, without the view switch.
- Entries open the event's Summary, or its Attendees for check-in staff; membership endings open Members. No money or bookings show.
- Managers get "New event" in the header and on each day from today (on hover or focus), opening the builder with that day, 6 to 8 pm (`/dashboard/events/new?date=`).

**Time** (`components/calendar/layout.ts`): every day and time is the society's zone, read with `Intl`, never the server's or browser's.
- An event shorter than 24 hours, even past midnight, sits on its start day with the end day named ("10:00 pm to 2:00 am Sun").
- Longer events span each day they touch, split at week edges with "continues" and "until", and use the all-day row in the week.
- The small hours belong to the night before: a day an event reaches only before 6:00 am doesn't count. A workshop from Wednesday 1:00 am to Thursday 3:00 am sits on Wednesday alone, in the month and in Wednesday's grid from 1 am.
- Month chips carry the full name and times as a tooltip.
- A day when the clocks change carries a marker ("Clocks go forward at 2 am"). A time in the repeated hour carries its abbreviation ("2:30 am AEDT", then "2:30 am AEST"). The builder still rejects or asks about such times (EVT-001).

## Traps

- Money is `paymentKind = stripe` with a positive total, never `status = paid` alone: free orders are `paid`.
- Never scope ticket numbers by `Order.organisationId`.
- Bucket in SQL with the society's zone; a JavaScript date or UTC day shifts sales across days and months.
- Counting tickets in the same query as order totals multiplies money.
- A money field shown to a role without `orders:read` leaks finance data; decide access on the server.

## Related

[[Payment Lifecycle]] · [[Payment Lifecycle Refunds and Disputes]] · [[Memberships and Merchandise]] · [[Event Lifecycle]] · [[Database and Multi Tenancy]] · [[Ticket Check-in Implementation]]
