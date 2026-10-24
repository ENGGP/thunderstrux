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
// anything refunded outside Thunderstrux.
const share = (order: { totalAmount: number; feeAmount: number | null; externalRefundedAmount: number }) =>
  Math.max(0, order.totalAmount - (order.feeAmount ?? 0) - order.externalRefundedAmount);

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
  // A nullable column: NOT refunded would also drop the never-refunded rows.
  const paidTo = { sellerStripeAccountId: stripeAccountId, paymentKind: "stripe" as const, paidAt: { gt: capped }, OR: [{ refundStatus: null }, { refundStatus: "processing" as const }] };
  const stillOpen = [{ disputeStatus: "open" as const }, { requiresCompensationReview: true }];
  const [tickets, commerce] = await Promise.all([
    prisma.order.findMany({
      // The event owns a ticket order (Event.organisationId is canonical).
      where: { ...paidTo, event: { organisationId }, AND: [{ OR: [{ event: { endTime: { gt: new Date(now.getTime() - ticketHoldAfterEventMs) } } }, ...stillOpen] }] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true, eventId: true, event: { select: { endTime: true } } }
    }),
    prisma.commerceOrder.findMany({
      where: { ...paidTo, organisationId, AND: [{ OR: [{ paidAt: { gt: new Date(now.getTime() - commerceHoldMs) } }, ...stillOpen] }] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true }
    })
  ]);
  const eventAmount = tickets.reduce((sum, order) => sum + share(order), 0);
  const upcoming = tickets.map((order) => order.event.endTime).filter((endTime) => endTime > now).sort((a, b) => a.getTime() - b.getTime());
  const commerceAmount = commerce.reduce((sum, order) => sum + share(order), 0);
  return {
    events: { amount: eventAmount, eventCount: new Set(tickets.map((order) => order.eventId)).size, nextEndsAt: upcoming[0] ?? null },
    commerce: { amount: commerceAmount },
    total: eventAmount + commerceAmount
  };
}
