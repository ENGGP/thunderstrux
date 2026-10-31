import type { OrderDisputeStatus, OrderRefundStatus, OrderStatus, PaymentKind } from "@prisma/client";

// Bump when the set of facts recorded at purchase changes.
export const PURCHASE_SNAPSHOT_VERSION = 1;

export type TicketOrderProjection = "processing" | "paid" | "free" | "review" | "failed" | "expired" | "refunded" | "refunded-outside" | "refund-processing" | "disputed" | "cancelled";

// The one status shown for a ticket order, and for a membership or merchandise
// order (T29a), which carries the same facts. `paid` on a free order is a storage
// compatibility detail, so the kind decides whether it reads Paid or Free, and a
// charged order that could not be fulfilled reads Payment review, not Failed.
export function ticketOrderProjection(order: {
  status: OrderStatus;
  paymentKind: PaymentKind;
  requiresCompensationReview: boolean;
  refundStatus?: OrderRefundStatus | null;
  disputeStatus?: OrderDisputeStatus | null;
  externalRefundedAmount?: number;
  externalRefundReviewedAt?: Date | null;
  cancelledAt?: Date | null;
  isManuallyRefunded?: boolean;
}): TicketOrderProjection {
  // A cancelled free purchase reads Cancelled, never Refunded or Free.
  if (order.cancelledAt) return "cancelled";
  if (order.disputeStatus === "open" || order.disputeStatus === "lost") return "disputed";
  if (order.refundStatus === "refunded") return "refunded";
  if (order.refundStatus === "processing") return "refund-processing";
  // Staff marked a paid order refunded outside Thunderstrux; a compensation
  // refund (only ever on a failed order) sets the same flag and reads Refunded.
  if (order.isManuallyRefunded) return order.status === "paid" ? "refunded-outside" : "refunded";
  // A won dispute keeps its tickets under review until staff restore them,
  // which clears it; a refund after it reads Refunded above.
  if (order.disputeStatus === "won") return "disputed";
  // A partial refund made in Stripe stays flagged until staff review it.
  if (order.requiresCompensationReview || (order.externalRefundedAmount && !order.externalRefundReviewedAt)) return "review";
  if (order.status === "pending") return "processing";
  if (order.status === "paid") return order.paymentKind === "free" ? "free" : "paid";
  return order.status;
}

// A checkout that took no money and left nothing to follow up: failed or
// expired, with no refund, dispute, review, outside refund or cancellation (the
// orders ticketOrderProjection reads as failed or expired). Purchases hides them
// unless the buyer asks (UI-019). The same shape filters commerce orders.
export const abandonedWhere = {
  status: { in: ["failed", "expired"] satisfies OrderStatus[] },
  requiresCompensationReview: false,
  refundStatus: null,
  disputeStatus: null,
  externalRefundedAmount: 0,
  cancelledAt: null
};

// The buyer's first look at tickets issued moments ago gets a one-time entrance.
// shortcut: a two-minute window, not a per-view flag, so a reload inside it replays; upgrade only if that matters.
export function justIssued(fulfilledAt: Date | null, now = Date.now()) {
  return fulfilledAt !== null && now - fulfilledAt.getTime() < 120_000;
}

// Orders created before T10 did not record the ticket name; show today's name and say so.
export function purchasedTicketTypeLabel(purchasedName: string | null, currentName: string) {
  return purchasedName ?? `${currentName} (historical label unavailable)`;
}

// Whether the buyer released a free registration themselves (EVT-005). Staff
// cancellations always record who did it; a guest buyer has no account. Unknown
// (not selected) reads as staff.
export function releasedByBuyer(order: { cancelledByUserId?: string | null; userId?: string | null }) {
  return order.cancelledByUserId !== undefined && (order.cancelledByUserId === null || order.cancelledByUserId === order.userId);
}

// PAY-056: a payment under review whose refund a bank dispute holds (PAY-036). An open
// dispute decides how the money comes back, and `otherwise` is what follows if the
// society wins it; a lost one is back with the buyer. All of it closes the review
// (PAY-057), so one still under review returned part. Null when none holds it.
export function reviewDisputeWords(order: { disputeStatus?: OrderDisputeStatus | null; requiresCompensationReview: boolean }, otherwise = "we'll refund you and email you when that's done") {
  if (order.disputeStatus === "open") return { title: "Payment disputed", message: `Your bank has disputed this payment, so it can't be refunded for now. If your bank decides for you, it returns the money. If it doesn't, ${otherwise}.` };
  if (order.disputeStatus !== "lost") return null;
  return order.requiresCompensationReview
    ? { title: "Partly refunded by your bank", message: `Your bank upheld your dispute and returned part of this payment. For the rest, ${otherwise}.` }
    : { title: "Refunded by your bank", message: "Your bank upheld your dispute and returned the payment to you." };
}

// The words a buyer sees for their own order (design round A2 batch 3): the
// same states staff see, said from the buyer's side.
export function buyerPurchaseBadge(order: Parameters<typeof ticketOrderProjection>[0] & Parameters<typeof releasedByBuyer>[0]): { status: TicketOrderProjection; label?: string } {
  const projection = ticketOrderProjection(order);
  if (projection === "failed" || projection === "expired") return { status: "expired", label: "Didn't complete" };
  // Unpaid until Stripe says otherwise (round E1); the order page asks Stripe and may say Confirming.
  if (projection === "processing") return { status: projection, label: "Waiting for payment" };
  if (projection === "cancelled") return { status: projection, label: releasedByBuyer(order) ? "You cancelled" : "Cancelled by the society" };
  // Payment review is either a charge awaiting compensation or a partial refund made in Stripe.
  if (projection === "review") return { status: projection, label: order.requiresCompensationReview ? "Payment issue" : "Partly refunded" };
  // A lost dispute is the buyer's money back; staff still see it as disputed.
  if (projection === "disputed" && order.disputeStatus === "lost") return { status: "refunded", label: "Refunded by your bank" };
  // Where the society refunded is staff detail; the buyer was refunded either way.
  if (projection === "refunded-outside") return { status: "refunded" };
  return { status: projection };
}
