import Link from "next/link";
import { formatDay, formatTime, localDay } from "@/components/calendar/layout";
import { DateRail } from "@/components/events/date-rail";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAccessibleOrganisationsForCurrentAccount } from "@/lib/auth/access";
import { readMemberProfile } from "@/lib/auth/account-settings";
import { getOwnCommerceOrders } from "@/lib/commerce/orders";
import { formatDate, formatDateRange, formatPrice, formatTerm, membershipLabel } from "@/lib/format";
import { myMemberships } from "@/lib/memberships/offers";
import { upcomingEventCounts } from "@/lib/organisations/overview";
import { buyerPurchaseBadge, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnTicketPurchases, getWalletTickets } from "@/lib/purchases/ticket-purchases";
import { zoneCity } from "@/lib/zoned-time";

// The personal Overview (T34, design round C1): the next event the member
// holds a valid ticket for, then what else is coming, recent purchases, their
// memberships and the societies they've joined. A checkout still confirming or
// in payment review is a purchase, never a ticket here.

const day = 86_400_000;
const moreLink = "text-sm font-semibold text-brand underline underline-offset-4";
const titleLink = "font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const lastDay = (endsAt: Date, timeZone: string) => formatDate(new Date(endsAt.getTime() - 1), timeZone);

export async function PersonalOverview({ userId }: { userId: string }) {
  const firstPage = { limit: 3, direction: "next" as const };
  const now = new Date();
  const [profile, wallet, active, upcomingTerms, tickets, commerce, societies] = await Promise.all([
    readMemberProfile(userId),
    getWalletTickets(userId, "upcoming", now),
    myMemberships(userId, "active", now),
    myMemberships(userId, "upcoming", now),
    getOwnTicketPurchases(userId, firstPage),
    getOwnCommerceOrders(userId, firstPage),
    getAccessibleOrganisationsForCurrentAccount()
  ]);
  const eventCounts = await upcomingEventCounts(societies.map((society) => society.id), now);

  // Valid tickets grouped by event, soonest first.
  const plans: Array<{ event: (typeof wallet.tickets)[number]["event"]; count: number; types: Set<string> }> = [];
  for (const ticket of wallet.tickets) {
    const plan = plans.find((entry) => entry.event.id === ticket.event.id) ?? plans[plans.push({ event: ticket.event, count: 0, types: new Set() }) - 1];
    plan.count += 1;
    plan.types.add(purchasedTicketTypeLabel(ticket.order.purchasedTicketTypeName, ticket.ticketType.name));
  }
  const [next, ...also] = plans;
  const purchases = [
    ...tickets.items.map((order) => ({ key: `t-${order.id}`, createdAt: order.createdAt, title: order.event.title, kind: "Ticket", society: order.event.organisation.name, href: `/purchases/tickets/${order.id}`, order, pickup: null })),
    ...commerce.items.map((order) => {
      const [first, ...rest] = order.lines;
      const merchandise = order.kind === "merchandise";
      return {
        key: `c-${order.id}`, createdAt: order.createdAt, order, society: order.organisation.name,
        title: merchandise ? (first ? (rest.length ? `${first.nameSnapshot} and ${rest.length} more` : first.nameSnapshot) : "Order") : (first?.nameSnapshot ?? "Membership"),
        kind: merchandise ? "Merchandise" : "Membership",
        href: merchandise ? `/merchandise/orders/${order.id}` : `/memberships/orders/${order.id}`,
        // A paid order waiting at the stall reads by its pickup.
        pickup: merchandise && ticketOrderProjection(order) === "paid" && (order.pickupStatus === "pending" || order.pickupStatus === "ready") ? order.pickupStatus : null
      };
    })
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 3);
  const memberships = [...active.memberships, ...upcomingTerms.memberships];

  return (
    <>
      {!profile?.onboardingCompletedAt ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div className="grid min-w-0 gap-1">
              <h2 className="text-xl font-semibold text-ink">Complete your profile</h2>
              <p className="text-sm text-ink-soft">Add your first and last name. Societies see them on the tickets you buy.</p>
            </div>
            <Link className={`inline-flex min-h-11 items-center ${moreLink}`} href="/account/settings#profile">Finish profile</Link>
          </div>
        </Card>
      ) : null}

      {next ? (
        <section aria-labelledby="next-plans" className="flex flex-col overflow-hidden rounded-card border border-line bg-surface sm:flex-row">
          {next.event.heroAssetId ? (
            <img alt="" className="aspect-video w-full object-cover sm:aspect-auto sm:w-2/5" src={`/api/public/assets/${next.event.heroAssetId}`} />
          ) : (
            <div aria-hidden="true" className="flex aspect-video items-center justify-center bg-brand-tint text-brand sm:aspect-auto sm:w-2/5 sm:min-h-[220px]">
              <Icon name="ticket" size={40} />
            </div>
          )}
          <div className="grid flex-1 content-start gap-2 p-5 sm:p-6">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-brand">Your next plans</p>
            <h2 className="font-display text-[26px] font-semibold leading-tight text-ink [overflow-wrap:anywhere]" id="next-plans">{next.event.title}</h2>
            <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
              {formatDateRange(next.event.startTime, next.event.endTime, next.event.organisation.timeZone)}, {zoneCity(next.event.organisation.timeZone)} · {next.event.location}
            </p>
            <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">{next.event.organisation.name} · {next.count} × {[...next.types].join(", ")}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <Link className={buttonClasses()} href="/tickets">View tickets</Link>
              <StatusBadge status="valid" />
            </div>
          </div>
        </section>
      ) : (
        <Card>
          <h2 className="text-xl font-semibold text-ink">Nothing booked yet</h2>
          <p className="mt-1 text-sm text-ink-soft">Find something on this week, or join a society to see its events here.</p>
          <Link className={`mt-4 ${buttonClasses()}`} href="/events">Explore events</Link>
        </Card>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {also.length ? (
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold text-ink">Also coming up</h2>
                <Link className={moreLink} href="/tickets">All my tickets</Link>
              </div>
              <ul className="mt-3 grid">
                {also.slice(0, 3).map(({ event, count }) => (
                  <li className="flex items-center gap-3 border-t border-line py-3.5 first:border-0" key={event.id}>
                    <DateRail date={event.startTime} size="md" timeZone={event.organisation.timeZone} />
                    <div className="grid min-w-0 gap-0.5">
                      <Link className={titleLink} href={`/events/${event.id}`}>{event.title}</Link>
                      <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                        {formatDay(localDay(event.startTime, event.organisation.timeZone)).split(" ")[0]} {formatTime(event.startTime, event.organisation.timeZone)} · {event.organisation.name} · {plural(count, "ticket")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">Recent purchases</h2>
              <Link className={moreLink} href="/purchases">All purchases</Link>
            </div>
            {purchases.length ? (
              <ul className="mt-3 grid">
                {purchases.map((purchase) => {
                  const badge = buyerPurchaseBadge(purchase.order);
                  return (
                    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-3.5 first:border-0" key={purchase.key}>
                      <div className="grid min-w-0 flex-[1_1_12rem] gap-0.5">
                        <Link className={titleLink} href={purchase.href}>{purchase.title}</Link>
                        <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">{purchase.kind} · {purchase.society} · {formatDate(purchase.createdAt)}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-ink">{purchase.order.paymentKind === "free" ? "Free" : formatPrice(purchase.order.totalAmount)}</span>
                      {purchase.pickup ? <StatusBadge status={purchase.pickup === "ready" ? "ready-to-collect" : "preparing"} /> : <StatusBadge label={badge.label} status={badge.status} />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">Tickets, memberships and merchandise you buy show here.</p>
            )}
            {purchases.some((purchase) => ["processing", "review"].includes(ticketOrderProjection(purchase.order))) ? (
              <p className="mt-3 text-sm text-ink-soft">A purchase still confirming or in payment review isn&apos;t a ticket yet, so it isn&apos;t under your next plans.</p>
            ) : null}
          </Card>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">Your memberships</h2>
              <Link className={moreLink} href="/memberships">My memberships</Link>
            </div>
            {memberships.length ? (
              <ul className="mt-3 flex flex-wrap gap-3">
                {memberships.slice(0, 4).map((membership) => {
                  const timeZone = membership.society.timeZone;
                  const daysLeft = Math.ceil((membership.endsAt.getTime() - now.getTime()) / day);
                  return (
                    <li className="grid min-w-0 flex-[1_1_16rem] content-start gap-1.5 rounded-control border border-line bg-surface p-4" key={membership.id}>
                      {membership.state === "active" ? <StatusBadge label="Membership active" status="active" /> : <StatusBadge label={`Starts ${formatDate(membership.startsAt, timeZone)}`} status="upcoming" />}
                      <strong className="font-semibold text-ink [overflow-wrap:anywhere]">{membershipLabel(membership.plan)}</strong>
                      <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                        {membership.society.name} · {membership.state === "active" ? `until ${lastDay(membership.endsAt, timeZone)}` : formatTerm(membership.startsAt, membership.endsAt, timeZone)}
                      </span>
                      {membership.state === "active" && daysLeft <= 14 ? <span className="text-sm text-ink-soft">Ends in {plural(daysLeft, "day")}. Memberships don&apos;t renew automatically.</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">No memberships. Joining a society is free and separate from buying one.</p>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold text-ink">Societies you&apos;ve joined</h2>
              <Link className={moreLink} href="/dashboard/organisations">Manage</Link>
            </div>
            {societies.length ? (
              <ul className="mt-3 grid">
                {societies.map((society) => (
                  <li className="flex items-center gap-3 border-t border-line py-3.5 first:border-0" key={society.id}>
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-ink text-sm font-semibold text-white">
                      {society.name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")}
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <Link className={titleLink} href={`/societies/${society.slug}`}>{society.name}</Link>
                      <span className="text-sm text-ink-soft">
                        {society.joinedAt ? `Joined ${new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: society.timeZone ?? undefined }).format(society.joinedAt)} · ` : ""}
                        {plural(eventCounts.get(society.id) ?? 0, "event")} coming up
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                You haven&apos;t joined a society. Joining is free and shows you their events.{" "}
                <Link className="font-semibold text-brand underline underline-offset-4" href="/societies">Explore societies</Link>
              </p>
            )}
            {societies.length ? <p className="mt-3 text-sm text-ink-soft">Joining is free and follows a society. A membership is separate.</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
