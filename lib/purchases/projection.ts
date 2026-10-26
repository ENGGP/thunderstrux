import type { OrderDisputeStatus, OrderRefundStatus, OrderStatus, PaymentKind } from "@prisma/client";

// Bump when the set of facts recorded at purchase changes.
export const PURCHASE_SNAPSHOT_VERSION = 1;

export type TicketOrderProjection = "processing" | "paid" | "free" | "review" | "failed" | "expired" | "refunded" | "refund-processing" | "disputed" | "cancelled";

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
}): TicketOrderProjection {
  // A cancelled free purchase reads Cancelled, never Refunded or Free.
  if (order.cancelledAt) return "cancelled";
  if (order.disputeStatus) return "disputed";
  if (order.refundStatus === "refunded") return "refunded";
  if (order.refundStatus === "processing") return "refund-processing";
  // A partial refund made in Stripe stays flagged until staff review it.
  if (order.requiresCompensationReview || (order.externalRefundedAmount && !order.externalRefundReviewedAt)) return "review";
  if (order.status === "pending") return "processing";
  if (order.status === "paid") return order.paymentKind === "free" ? "free" : "paid";
  return order.status;
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
  return { status: projection };
}
