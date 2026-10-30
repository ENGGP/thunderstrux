import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/layout/personal-shell";
import { TicketFace } from "@/components/tickets/ticket-face";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { formatDateTime } from "@/lib/format";
import { purchasedTicketTypeLabel } from "@/lib/purchases/projection";
import { getWalletTickets, walletViews, type WalletView } from "@/lib/purchases/ticket-purchases";
import { zoneCity } from "@/lib/zoned-time";

export const metadata: Metadata = { title: "My tickets" };

const viewLabels: Record<WalletView, string> = { upcoming: "Upcoming", past: "Past", "not-valid": "Not valid" };
const emptyCopy: Record<WalletView, { title: string; body: string }> = {
  upcoming: { title: "No upcoming tickets", body: "Tickets you buy or register for show here." },
  past: { title: "No past tickets", body: "Tickets for events that have ended show here." },
  "not-valid": { title: "Nothing here", body: "Refunded, cancelled and disputed tickets show here." }
};

export default async function MyTicketsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuthenticatedUser>>;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/login?callbackUrl=/tickets");
    throw error;
  }
  if (user.accountRole === "organisation") redirect("/dashboard");

  const requested = (await searchParams).view;
  const view: WalletView = walletViews.includes(requested as WalletView) ? (requested as WalletView) : "upcoming";
  const { tickets, counts, truncated } = await getWalletTickets(user.id, view);

  // One group per event, in the order the tickets came back (soonest first for Upcoming).
  const groups: Array<{ event: (typeof tickets)[number]["event"]; tickets: typeof tickets }> = [];
  for (const ticket of tickets) {
    const group = groups.find((item) => item.event.id === ticket.event.id);
    if (group) group.tickets.push(ticket);
    else groups.push({ event: ticket.event, tickets: [ticket] });
  }

  return (
    <PersonalShell>
      <h1 className="text-3xl font-semibold text-ink">My tickets</h1>
      <LinkTabs
        label="Ticket views"
        tabs={walletViews.map((item) => ({
          href: item === "upcoming" ? "/tickets" : `/tickets?view=${item}`,
          label: viewLabels[item],
          active: item === view,
          count: item === "past" ? undefined : counts[item]
        }))}
      />
      {groups.length === 0 ? (
        <EmptyState action={view === "upcoming" ? <Link className={buttonClasses({ variant: "secondary" })} href="/events">Explore events</Link> : undefined} icon="ticket" title={emptyCopy[view].title}>
          {emptyCopy[view].body}
        </EmptyState>
      ) : (
        groups.map(({ event, tickets: eventTickets }) => {
          const timeZone = event.organisation.timeZone;
          return (
            <section aria-labelledby={`event-${event.id}`} className="grid gap-3" key={event.id}>
              <h2 className="text-[17px] font-semibold text-ink [overflow-wrap:anywhere]" id={`event-${event.id}`}>
                <Link className="underline-offset-4 hover:underline" href={`/events/${event.id}`}>{event.title}</Link>{" "}
                <span className="font-normal text-ink-soft">
                  · {formatDateTime(event.startTime, { timeZone })}, {zoneCity(timeZone)} · {event.location}
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
                {eventTickets.map((ticket) => (
                  <TicketFace
                    free={ticket.order.paymentKind === "free"}
                    key={ticket.id}
                    of={ticket.order.quantity}
                    orderHref={`/purchases/tickets/${ticket.orderId}`}
                    society={event.organisation.name}
                    ticket={ticket}
                    ticketType={purchasedTicketTypeLabel(ticket.order.purchasedTicketTypeName, ticket.ticketType.name)}
                    timeZone={timeZone}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
      {truncated ? (
        <p className="text-sm text-ink-soft">
          {view === "upcoming" ? "Showing the soonest 100 tickets. Later ones show here as these events pass." : "Showing the latest 100 tickets. Every order is in Purchases."}
        </p>
      ) : null}
      <p className="text-sm text-ink-soft">At the door, show the QR code, or give your name and the ticket reference.</p>
    </PersonalShell>
  );
}
