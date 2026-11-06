import type { Prisma } from "@prisma/client";
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

// What one sale leaves the society: the price less Thunderstrux's fee, anything
// refunded outside Thunderstrux that Stripe shows taken back from its transfer
// (PAY-027: a refund not yet reversed is still the society's to return), and the
// society's part of refunds made here (DEBT-002), and what lost disputes' reversals
// already took back from its transfer (PAY-074: a dispute lost for part of a sale holds
// the rest). Stripe reverses a refund's transfer pro rata, so that part is rounded
// down: the hold errs towards keeping more.
type Sale = {
  totalAmount: number; feeAmount: number | null; externalRefundedAmount: number; externalUnreversedAmount?: number;
  refundRequests?: Array<{ amount: number }>; disputes?: Array<{ reversalAmount: number | null }>;
};
const share = (order: Sale) => {
  const kept = order.totalAmount - (order.feeAmount ?? 0);
  const refunded = (order.refundRequests ?? []).reduce((sum, request) => sum + request.amount, 0);
  const reversed = order.totalAmount > 0 ? Math.floor((refunded * kept) / order.totalAmount) : 0;
  const recovered = (order.disputes ?? []).reduce((sum, dispute) => sum + (dispute.reversalAmount ?? 0), 0);
  return Math.max(0, kept - (order.externalRefundedAmount - (order.externalUnreversedAmount ?? 0)) - reversed - recovered);
};
// The succeeded refunds made here and dispute reversals, for share().
export const shareRefundsSelect = {
  refundRequests: { where: { status: "succeeded" as const }, select: { amount: true } },
  disputes: { where: { reversalStatus: "succeeded" as const }, select: { reversalAmount: true } }
};

// A chargeback not yet decided, whatever the order's worst status says: a lost one
// beside it makes that `lost` (PAY-094). The same test as outcomeOf (dispute-outcome.ts):
// neither won nor lost, and not a prevented one the network blocked (PAY-075).
// Inquiries hold through `inquiry` below.
export const undecidedChargeback = {
  some: { NOT: [{ providerStatus: { startsWith: "warning_" } }, { providerStatus: { in: ["won", "lost"] } }, { providerStatus: "prevented", caseType: "block" }] }
} satisfies Prisma.PurchaseDisputeListRelationFilter;

// A refund made outside Thunderstrux and not taken back from the society keeps its sale (PAY-027).
const unreversed = { externalUnreversedAmount: { gt: 0 } };
// A lost dispute's money stays held until its transfer reversal settles (T53).
const reversing = { disputes: { some: { reversalStatus: { in: ["pending" as const, "uncertain" as const] } } } };
// PAY-033: a refund still being sent holds its sale, so a late reversal never debits the society's bank.
const refunding = [{ refundStatus: "processing" as const }, { refundRequests: { some: { status: { in: ["pending" as const, "uncertain" as const] } } } }];
// PAY-037: a bank's inquiry moves no money, but can become a chargeback.
const inquiry = { disputes: { some: { providerStatus: { in: ["warning_needs_response", "warning_under_review"] } } } };
// What holds a paid sale past its rule, up to the cap, on a ticket or commerce order alike.
// PAY-012: a lost dispute whose money is back from the society holds only what its
// reversal didn't take (share()); a sale that nets to nothing is dropped by heldMoney.
export const stillOpen = [
  { disputeStatus: "open" as const }, { disputes: undecidedChargeback }, { requiresCompensationReview: true }, reversing, unreversed, ...refunding, inquiry
];
// PAY-045: a cancelled event's buyer may still be owed a refund, so its sale holds to the
// cap; a staff mark says they were repaid. Ticket orders only.
export const cancelledUnrepaid = { event: { cancelledAt: { not: null } }, isManuallyRefunded: false };

export type HeldMoney = {
  // Ticket money waiting for events to end.
  events: { amount: number; eventCount: number; nextEndsAt: Date | null };
  // Membership and merchandise money from the last 7 days.
  commerce: { amount: number };
  total: number;
};

// A paid Stripe sale to this account whose money may still be the society's to hold.
// A nullable column: NOT refunded would also drop the never-refunded rows. PAY-069:
// Refunded says no ticket is left, not that the money went back, so a sale refunded
// here is held by what share() nets, not dropped.
export const paidToAccount = (stripeAccountId: string) => ({
  sellerStripeAccountId: stripeAccountId, paymentKind: "stripe" as const,
  OR: [{ refundStatus: null }, { refundStatus: "processing" as const }, unreversed, { refundStatus: "refunded" as const, refundRequests: { some: { status: "succeeded" as const } } }]
});

// The money a society's Stripe account must keep at `now`. Paid sales to that
// account that aren't fully refunded are held while their rule says so, while
// disputed or under review, and never beyond the 90-day cap.
export async function heldMoney(organisationId: string, stripeAccountId: string, now = new Date()): Promise<HeldMoney> {
  const paidTo = { ...paidToAccount(stripeAccountId), paidAt: { gt: new Date(now.getTime() - maxHoldMs) } };
  const ended = new Date(now.getTime() - ticketHoldAfterEventMs);
  const [ticketSales, commerceSales] = await Promise.all([
    prisma.order.findMany({
      // The event owns a ticket order (Event.organisationId is canonical).
      where: { ...paidTo, event: { organisationId }, AND: [
        // An end moved earlier still holds until its latest end has passed, so an
        // edit can't release the money before the event runs (SEC-004, SEC-032).
        // PAY-045: a cancelled event's buyer may still be owed a refund, so it holds to
        // the cap; a staff mark says they were repaid, so that sale waits only for the event.
        { OR: [{ event: { endTime: { gt: ended } } }, { event: { latestEndTime: { gt: ended } } }, cancelledUnrepaid, ...stillOpen] },
        // A compensation refund returned the money (PAY-012). A staff mark proves
        // nothing at Stripe, so that sale waits for its event like any other.
        { OR: [{ isManuallyRefunded: false }, { compensationRefundJob: { is: null } }] }
      ] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, ...shareRefundsSelect, eventId: true, event: { select: { endTime: true, latestEndTime: true } } }
    }),
    prisma.commerceOrder.findMany({
      where: { ...paidTo, organisationId, AND: [{ OR: [{ paidAt: { gt: new Date(now.getTime() - commerceHoldMs) } }, ...stillOpen] }] },
      select: { totalAmount: true, feeAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, ...shareRefundsSelect }
    })
  ]);
  // A sale refunded in full holds nothing, and doesn't count as an event waiting.
  const tickets = ticketSales.filter((order) => share(order) > 0);
  const commerce = commerceSales.filter((order) => share(order) > 0);
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
