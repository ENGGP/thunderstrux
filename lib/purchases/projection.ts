import type { OrderStatus, PaymentKind } from "@prisma/client";

// Bump when the set of facts recorded at purchase changes.
export const PURCHASE_SNAPSHOT_VERSION = 1;

export type TicketOrderProjection = "processing" | "paid" | "free" | "review" | "failed" | "expired";

// The one status shown for a ticket order. `paid` on a free order is a storage
// compatibility detail, so the kind decides whether it reads Paid or Free, and a
// charged order that could not be fulfilled reads Payment review, not Failed.
export function ticketOrderProjection(order: {
  status: OrderStatus;
  paymentKind: PaymentKind;
  requiresCompensationReview: boolean;
}): TicketOrderProjection {
  if (order.requiresCompensationReview) return "review";
  if (order.status === "pending") return "processing";
  if (order.status === "paid") return order.paymentKind === "free" ? "free" : "paid";
  return order.status;
}

// Orders created before T10 did not record the ticket name; show today's name and say so.
export function purchasedTicketTypeLabel(purchasedName: string | null, currentName: string) {
  return purchasedName ?? `${currentName} (historical label unavailable)`;
}
