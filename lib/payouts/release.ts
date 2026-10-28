import { prisma } from "@/lib/db";

// PAY-005, design round F1: a society is paid once its event is over, as
// Humanitix and Eventbrite pay organisers, so refunds for a cancelled event come
// out of money the society still has. Until its rule releases it, a sale's share
// stays in the society's Stripe balance.
const day = 24 * 60 * 60 * 1000;
// Ticket money: this long after the event ends.
export const ticketHoldAfterEventMs = 2 * day;
// Membership and merchandise money: this long after the sale.
export const commerceHoldMs = 7 * day;
// Stripe holds money for at most 90 days in Australia; anything older is sent.
export const maxHoldMs = 80 * day;

// What one sale leaves the society: the price less Thunderstrux's fee and
// anything refunded outside Thunderstrux that Stripe shows taken back from its
// transfer (PAY-027: a refund not yet reversed is still the society's to return).
const share = (order: { totalAmount: number; feeAmount: number | null; externalRefundedAmount: number; externalUnreversedAmount?: number }) =>
  Math.max(0, order.totalAmount - (order.feeAmount ?? 0) - (order.externalRefundedAmount - (order.externalUnreversedAmount ?? 0)));

export type HeldMoney = {
  // Ticket money waiting for events to end.
  events: { amount: number; eventCount: number; nextEndsAt: Date | null };
  // Membership and merchandise money from the last 7 days.
  commerce: { amount: number };
  total: number;
};

// The money a society's Stripe account must keep at `now`. Paid sales to that
// account that aren't fully refunded are held while their rule says so, while
// disputed or under review, and never beyond the 90-day cap.
export async function heldMoney(organisationId: string, stripeAccountId: string, now = new Date()): Promise<HeldMoney> {
  const capped = new Date(now.getTime() - maxHoldMs);
  // A nullable column: NOT refunded would also drop the never-refunded rows. A
  // refund made outside Thunderstrux and not taken back from the society keeps it (PAY-027).
  const unreversed = { externalUnreversedAmount: { gt: 0 } };
  const paidTo = { sellerStripeAccountId: stripeAccountId, paymentKind: "stripe" as const, paidAt: { gt: capped }, OR: [{ refundStatus: null }, { refundStatus: "processing" as const }, unreversed] };
  // A lost dispute's money stays held until its transfer reversal settles (T53).
  const reversing = { disputes: { some: { reversalStatus: { in: ["pending" as const, "uncertain" as const] } } } };
  const stillOpen = [{ disputeStatus: "open" as const }, { requiresCompensationReview: true }, reversing, unreversed];
  // PAY-012: a lost dispute whose money is already back from the society holds nothing.
  const notRecovered = { OR: [{ disputeStatus: null }, { disputeStatus: { not: "lost" as const } }, { disputes: { none: { reversalStatus: "succeeded" as const } } }, reversing] };
  const ended = new Date(now.getTime() - ticketHoldAfterEventMs);
  const [tickets, commerce] = await Promise.all([
    prisma.order.findMany({
      // The event owns a ticket order (Event.organisationId is canonical).
      where: { ...paidTo, event: { organisationId }, AND: [
        // An end moved earlier still holds until its latest end has passed, so an
        // edit can't release the money before the event runs (SEC-004, SEC-032).
        { OR: [{ event: { endTime: { gt: ended } } }, { event: { latestEndTime: { gt: ended } } }, ...stillOpen] },
        notRecovered,
        // A compensation refund returned the money (PAY-012). A staff mark proves
        // nothing at Stripe, so that sale waits for its event like any other.
        { OR: [{ isManuallyRefunded: false }, { compensationRefundJob: { is: null } }] }
      ] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, eventId: true, event: { select: { endTime: true, latestEndTime: true } } }
    }),
    prisma.commerceOrder.findMany({
      where: { ...paidTo, organisationId, AND: [{ OR: [{ paidAt: { gt: new Date(now.getTime() - commerceHoldMs) } }, ...stillOpen] }, notRecovered] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true }
    })
  ]);
  const eventAmount = tickets.reduce((sum, order) => sum + share(order), 0);
  const latestEnd = ({ endTime, latestEndTime }: (typeof tickets)[number]["event"]) => (latestEndTime && latestEndTime > endTime ? latestEndTime : endTime);
  const upcoming = tickets.map((order) => latestEnd(order.event)).filter((endTime) => endTime > now).sort((a, b) => a.getTime() - b.getTime());
  const commerceAmount = commerce.reduce((sum, order) => sum + share(order), 0);
  return {
    events: { amount: eventAmount, eventCount: new Set(tickets.map((order) => order.eventId)).size, nextEndsAt: upcoming[0] ?? null },
    commerce: { amount: commerceAmount },
    total: eventAmount + commerceAmount
  };
}

// PAY-022: a sale older than the cap was released for payout before its event
// ran, so refunding it may take the money back from the society's bank.
export function releasedEarlyShare(order: Parameters<typeof share>[0] & { paidAt: Date | null }, now = new Date()) {
  return order.paidAt && order.paidAt.getTime() <= now.getTime() - maxHoldMs ? share(order) : 0;
}
