import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart } from "@/components/analytics/bar-chart";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { engagementMetrics, membershipMetrics, merchandiseMetrics, ticketMetrics, type AnalyticsAccess } from "@/lib/analytics/metrics";
import type { AnalyticsRange } from "@/lib/analytics/range";
import { formatDate, formatMoney, shortMonths } from "@/lib/format";

// The four Analytics tabs (T32, design round C1). Each shows at most three
// tiles, a chart and a table with the same numbers, all from lib/analytics.
// Money only reaches this file for finance roles: the metrics return null
// otherwise, and the Memberships and Merchandise tabs aren't offered.

const day = (start: string, options: Intl.DateTimeFormatOptions) =>
  shortMonths(new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`)));
export const bucketLabel = (start: string, range: AnalyticsRange) =>
  range.bucket === "month" ? day(start, { month: "short", year: range.from.slice(0, 4) === range.to.slice(0, 4) ? undefined : "2-digit" }) : day(start, { day: "numeric", month: "short" });
const dollars = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const money = (cents: number | null) => formatMoney(cents ?? 0);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const firstColumn = { week: "Week starting", day: "Day", month: "Month" } as const;
const span = (range: AnalyticsRange) => `${formatDate(`${range.from}T12:00:00Z`, "UTC")} to ${formatDate(`${range.to}T12:00:00Z`, "UTC")}`;

function Tiles({ tiles }: { tiles: Array<{ label: string; value: ReactNode; note: ReactNode }> }) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <p className="text-sm font-semibold text-ink-soft">{tile.label}</p>
          <p className="mt-1.5 text-[28px] font-semibold leading-tight tabular-nums text-ink">{tile.value}</p>
          <p className="mt-1 text-sm text-ink-muted">{tile.note}</p>
        </Card>
      ))}
    </div>
  );
}

function Facts({ title, facts, children }: { title: string; facts: Array<[string, ReactNode, ReactNode?]>; children?: ReactNode }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <dl className="mt-3.5 grid gap-x-6 gap-y-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {facts.map(([label, value, extra]) => (
          <div className="grid gap-0.5" key={label}>
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="text-[17px] font-semibold tabular-nums text-ink">
              {value}
              {extra ? <span className="text-sm font-normal text-ink-soft"> · {extra}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  );
}

function Definitions({ items }: { items: string[] }) {
  return (
    <details className="rounded-card border border-line bg-surface-subtle px-5 py-4" open>
      <summary className="cursor-pointer font-semibold text-ink">How these numbers are counted</summary>
      <ul className="mt-2.5 grid list-disc gap-1.5 pl-5 text-sm text-ink-soft">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </details>
  );
}

const by = (range: AnalyticsRange) => `${range.bucket === "day" ? "Sales by day" : range.bucket === "week" ? "Sales by week" : "Sales by month"}`;

export async function TicketsTab({ organisationId, range, access, eventId }: { organisationId: string; range: AnalyticsRange; access: AnalyticsAccess; eventId?: string }) {
  const { totals: t, series } = await ticketMetrics(organisationId, range, access, eventId);
  const { attendance: a } = t;
  const rate = a.checkInRate === null ? null : `${Math.round(a.checkInRate * 100)}%`;
  const noLongerValid = t.ticketsIssued - t.ticketsValid;
  const tiles = access.financial
    ? [
        { label: "Gross sales", value: money(t.gross), note: plural(t.fulfilledOrders - t.freeOrders, "paid order") },
        { label: "Refunded", value: money(t.refunded), note: `${t.refunds} ${t.refunds === 1 ? "refund" : "refunds"} confirmed by Stripe` },
        { label: "Net sales", value: money(t.net), note: "Before Stripe's fees. Not a payout." }
      ]
    : [
        { label: "Tickets issued", value: t.ticketsIssued, note: `${t.ticketsIssued - t.ticketsFree} paid, ${t.ticketsFree} free` },
        { label: "Checked in", value: rate === null ? 0 : `${a.checkedIn} of ${a.valid}`, note: rate === null ? "No event in this range has started" : "Valid tickets for events that have started" },
        { label: "Attendance rate", value: rate ?? "Not yet", note: rate === null ? "Shows once an event starts" : "Of valid tickets" }
      ];
  const empty = t.fulfilledOrders === 0 && t.refunds === 0;
  return (
    <>
      <Tiles tiles={tiles} />
      {access.financial ? (
        <Facts
          facts={[
            ["Tickets issued", t.ticketsIssued, `${t.ticketsFree} free`],
            ["Still valid", t.ticketsValid, noLongerValid ? `${noLongerValid} no longer valid` : undefined],
            ["Checked in", rate === null ? "Not yet" : `${a.checkedIn} of ${a.valid}`, rate ?? undefined],
            ["Orders started", t.ordersStarted, `${t.ordersCompleted} completed`],
            ["Platform fees", money(t.platformFees), "after reversals"]
          ]}
          title="Tickets and attendance"
        >
          <p className="mt-3.5 text-sm text-ink-muted">
            Checked in counts events that started in the range.
            {a.checkedInNoLongerValid ? ` ${a.checkedInNoLongerValid} ${a.checkedInNoLongerValid === 1 ? "person was" : "people were"} checked in before their ticket stopped being valid; they're not in the rate.` : ""}
          </p>
        </Facts>
      ) : null}
      {empty ? (
        <EmptyState icon="ticket" title={`No ticket sales between ${span(range)}`}>
          Nothing to chart yet. Sales show here on the day tickets are issued.
        </EmptyState>
      ) : (
        <ChartCard title={access.financial ? by(range) : `Tickets issued by ${range.bucket}`}>
          <BarChart
            bars={series.map((row) => access.financial
              ? { key: row.start, label: bucketLabel(row.start, range), primary: row.gross ?? 0, secondary: row.refunded ?? 0, value: dollars(row.gross ?? 0) }
              : { key: row.start, label: bucketLabel(row.start, range), primary: row.tickets, value: String(row.tickets) })}
            label={access.financial ? `Gross and refunded by ${range.bucket}` : `Tickets issued by ${range.bucket}`}
            legend={access.financial ? ["Gross", "Refunded"] : undefined}
          />
          <div className="mt-5">
            <ResponsiveTable
              card={(row) => (
                <>
                  <div className="flex justify-between gap-3 font-semibold tabular-nums"><span>{bucketLabel(row.start, range)}</span><span>{access.financial ? `${money(row.net)} net` : `${row.tickets} tickets`}</span></div>
                  <p className="text-sm text-ink-soft">{row.orders} orders · {row.tickets} tickets{access.financial ? ` · ${money(row.gross)} gross · ${money(row.refunded)} refunded` : ""}</p>
                </>
              )}
              columns={[
                { header: firstColumn[range.bucket], cell: (row) => bucketLabel(row.start, range) },
                { header: "Orders", align: "right", cell: (row) => row.orders },
                { header: "Tickets", align: "right", cell: (row) => row.tickets },
                ...(access.financial
                  ? [
                      { header: "Gross", align: "right" as const, cell: (row: (typeof series)[number]) => money(row.gross) },
                      { header: "Refunded", align: "right" as const, cell: (row: (typeof series)[number]) => money(row.refunded) },
                      { header: "Net", align: "right" as const, cell: (row: (typeof series)[number]) => money(row.net) }
                    ]
                  : [])
              ]}
              label={`${by(range)}, in numbers`}
              minWidth={access.financial ? 720 : 480}
              rowKey={(row) => row.start}
              rows={series}
            />
          </div>
        </ChartCard>
      )}
      <Definitions
        items={access.financial
          ? [
              "Gross sales: paid ticket orders, on the day the tickets were issued. Free tickets, unpaid checkouts and payments still in review aren't sales.",
              "Refunded: refunds Stripe has confirmed, on the day it confirmed them. A refund lowers the period it happens in, so a period can show more refunded than sold.",
              "Net sales: gross less refunded. Stripe's processing fees and your payout dates come from Stripe, so this isn't profit or money in your bank.",
              "Refunds made in the Stripe dashboard show on the order, not here."
            ]
          : [
              "Tickets issued: tickets on completed orders, on the day they were issued, including ones later refunded.",
              "Checked in: valid tickets checked in, for events that started in the range. The rate shows once there are valid tickets."
            ]}
      />
    </>
  );
}

export async function MembershipsTab({ organisationId, range, access, asOf }: { organisationId: string; range: AnalyticsRange; access: AnalyticsAccess; asOf: string }) {
  const { totals: t, series } = await membershipMetrics(organisationId, range, access);
  return (
    <>
      <Tiles
        tiles={[
          { label: "Members now", value: t.activeMembers, note: `Holding a membership on ${asOf}` },
          { label: "New memberships", value: t.granted, note: `${t.granted - t.renewals} new members, ${t.renewals} renewals` },
          { label: "Net sales", value: money(t.net), note: `${money(t.gross)} gross, ${money(t.refunded)} refunded` }
        ]}
      />
      {t.granted === 0 && t.fulfilledOrders === 0 && t.refunds === 0 ? (
        <EmptyState icon="badge" title={`No memberships between ${span(range)}`}>Memberships show here on the day they're granted.</EmptyState>
      ) : (
        <ChartCard title={`Memberships by ${range.bucket}`}>
          <BarChart
            bars={series.map((row) => ({ key: row.start, label: bucketLabel(row.start, range), primary: row.granted - row.renewals, secondary: row.renewals, value: String(row.granted) }))}
            label={`New members and renewals by ${range.bucket}`}
            legend={["New member", "Renewal"]}
          />
          <div className="mt-5">
            <ResponsiveTable
              card={(row) => (
                <>
                  <div className="flex justify-between gap-3 font-semibold tabular-nums"><span>{bucketLabel(row.start, range)}</span><span>{money(row.net)} net</span></div>
                  <p className="text-sm text-ink-soft">{row.granted - row.renewals} new · {row.renewals} renewals</p>
                </>
              )}
              columns={[
                { header: firstColumn[range.bucket], cell: (row) => bucketLabel(row.start, range) },
                { header: "New", align: "right", cell: (row) => row.granted - row.renewals },
                { header: "Renewals", align: "right", cell: (row) => row.renewals },
                { header: "Net sales", align: "right", cell: (row) => money(row.net) }
              ]}
              label={`Memberships by ${range.bucket}, in numbers`}
              minWidth={520}
              rowKey={(row) => row.start}
              rows={series}
            />
          </div>
        </ChartCard>
      )}
      <Facts
        facts={[
          ["Free memberships", t.freeOrders, "never money"],
          ["Refunded", t.refunds, "membership ended"],
          ["Platform fees", money(t.platformFees), "after reversals"]
        ]}
        title="Also in this range"
      />
      <Definitions
        items={[
          "A renewal is a membership that starts after an earlier one with this society ended, with no overlap.",
          "Members now counts people holding a membership on that day, once each. Joining the society for free isn't a membership.",
          "Net sales: gross less refunds Stripe confirmed in the range. Not profit or a payout."
        ]}
      />
    </>
  );
}

export async function MerchandiseTab({ organisationId, range, access, canFulfil }: { organisationId: string; range: AnalyticsRange; access: AnalyticsAccess; canFulfil: boolean }) {
  const { totals: t, series } = await merchandiseMetrics(organisationId, range, access);
  return (
    <>
      <Tiles
        tiles={[
          { label: "Gross sales", value: money(t.gross), note: `${plural(t.fulfilledOrders - t.freeOrders, "paid order")}, ${plural(t.itemsSold, "item")}` },
          { label: "Refunded", value: money(t.refunded), note: `${t.refunds} ${t.refunds === 1 ? "refund" : "refunds"} confirmed by Stripe` },
          { label: "Net sales", value: money(t.net), note: "Before Stripe's fees. Not a payout." }
        ]}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {t.fulfilledOrders === 0 && t.refunds === 0 ? (
          <EmptyState icon="bag" title={`No merchandise sales between ${span(range)}`}>Sales show here on the day the order is paid.</EmptyState>
        ) : (
          <ChartCard title={`Gross sales by ${range.bucket}`}>
            <BarChart
              bars={series.map((row) => ({ key: row.start, label: bucketLabel(row.start, range), primary: row.gross ?? 0, value: dollars(row.gross ?? 0) }))}
              label={`Gross merchandise sales by ${range.bucket}`}
            />
          </ChartCard>
        )}
        <Card>
          <h2 className="text-lg font-semibold text-ink">Pickups and stock, now</h2>
          <div className="mt-3 grid gap-2.5">
            {([["preparing", t.pickups.preparing], ["ready-to-collect", t.pickups.ready], ["collected", t.pickups.collected]] as const).map(([status, count]) => (
              <div className="flex items-center justify-between" key={status}><StatusBadge status={status} /><strong className="tabular-nums">{count} {count === 1 ? "order" : "orders"}</strong></div>
            ))}
          </div>
          <p className="mt-3 border-t border-line pt-3 text-sm text-ink-soft">{t.stock.remaining} items left across published products · {t.stock.held} held in checkouts</p>
          {canFulfil ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4" href="/dashboard/merchandise/pickups">Open Pickups</Link> : null}
        </Card>
      </div>
      {t.fulfilledOrders === 0 && t.refunds === 0 ? null : (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-ink">{range.bucket === "day" ? "Day" : range.bucket === "week" ? "Week" : "Month"} by {range.bucket}</h2>
          <ResponsiveTable
            card={(row) => (
              <>
                <div className="flex justify-between gap-3 font-semibold tabular-nums"><span>{bucketLabel(row.start, range)}</span><span>{money(row.net)} net</span></div>
                <p className="text-sm text-ink-soft">{row.orders} orders · {row.items} items · {money(row.gross)} gross · {money(row.refunded)} refunded</p>
              </>
            )}
            columns={[
              { header: firstColumn[range.bucket], cell: (row) => bucketLabel(row.start, range) },
              { header: "Orders", align: "right", cell: (row) => row.orders },
              { header: "Items", align: "right", cell: (row) => row.items },
              { header: "Gross", align: "right", cell: (row) => money(row.gross) },
              { header: "Refunded", align: "right", cell: (row) => money(row.refunded) },
              { header: "Net", align: "right", cell: (row) => money(row.net) }
            ]}
            label={`Merchandise by ${range.bucket}, in numbers`}
            minWidth={720}
            rowKey={(row) => row.start}
            rows={series}
          />
          <p className="mt-3 text-sm text-ink-muted">{t.fulfilledOrders} orders in all, {t.freeOrders} of them free.</p>
        </Card>
      )}
      <Definitions
        items={[
          "Gross sales: paid merchandise orders, on the day they were paid. Free items and payments in review aren't sales.",
          "Refunded: refunds Stripe confirmed, on the day it confirmed them. Stock comes back only through a recorded return.",
          "Pickups and stock are as they are now, whatever the range."
        ]}
      />
    </>
  );
}

export async function EngagementTab({ organisationId, range, asOf }: { organisationId: string; range: AnalyticsRange; asOf: string }) {
  const { totals: t, series } = await engagementMetrics(organisationId, range);
  return (
    <>
      <Tiles
        tiles={[
          { label: "Joined now", value: t.joinedNow, note: "Following the society today" },
          { label: "New joins", value: t.joins, note: "In this range" },
          { label: "People who bought", value: t.buyers.total, note: "Tickets, memberships or merchandise" }
        ]}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ChartCard title={`Joins by ${range.bucket}`}>
          <BarChart bars={series.map((row) => ({ key: row.start, label: bucketLabel(row.start, range), primary: row.joins, value: String(row.joins) }))} label={`Joins by ${range.bucket}`} />
        </ChartCard>
        <Card>
          <h2 className="text-lg font-semibold text-ink">Who took part</h2>
          <div aria-label="Who took part" className="mt-3 overflow-x-auto" role="region" tabIndex={0}>
            <table className="w-full min-w-[360px] border-collapse text-[15px]">
              <thead>
                <tr className="text-left text-[13px] text-ink-soft"><th className="py-2.5 font-semibold" scope="col">People</th><th className="px-2 py-2.5 text-right font-semibold" scope="col">All</th><th className="px-2 py-2.5 text-right font-semibold" scope="col">Joined</th><th className="py-2.5 pl-2 text-right font-semibold" scope="col">Members</th></tr>
              </thead>
              <tbody className="tabular-nums">
                {([["Bought something", t.buyers], ["Checked in at an event", t.attendees]] as const).map(([label, group]) => (
                  <tr className="border-t border-line" key={label}><th className="py-2.5 text-left font-normal" scope="row">{label}</th><td className="px-2 py-2.5 text-right">{group.total}</td><td className="px-2 py-2.5 text-right">{group.joined}</td><td className="py-2.5 pl-2 text-right">{group.members}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-muted">Counts people with an account, once each. Guests aren&apos;t counted, and page visits aren&apos;t tracked.</p>
        </Card>
      </div>
      <p className="text-sm text-ink-muted">Joining is free and is not a membership. &quot;Members&quot; means holding a membership on {asOf}.</p>
    </>
  );
}
