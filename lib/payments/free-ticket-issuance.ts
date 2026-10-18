import type { CompensationRefundMode, Prisma } from "@prisma/client";
import { enqueueAutomaticTicketEmailForOrder } from "@/lib/email/ticket-email-outbox";
import { appendOrderLifecycleEvent } from "@/lib/payments/order-lifecycle";
import { PURCHASE_SNAPSHOT_VERSION } from "@/lib/purchases/projection";

export type FreeIssuanceInput = {
  // Exactly one buyer: a member, or a verified guest (T16b).
  userId: string | null;
  guestIdentityId?: string | null;
  buyer: { email: string; firstName: string | null; lastName: string | null; displayName: string | null };
  event: { id: string; organisationId: string; compensationRefundMode: CompensationRefundMode; organisation: { name: string } };
  ticketType: { id: string; name: string };
  quantity: number;
  now: Date;
  // The membership a member price of zero came from (T24b).
  membership?: { grantId: string; entitlementVersion: number } | null;
  attempt: Omit<Prisma.CheckoutAttemptUncheckedCreateInput, "orderId">;
};

// A zero-total order is fulfilled where it is created: the caller holds the
// User, Event and TicketType locks and has checked sale state, readiness and
// sellable stock. No Stripe call, no fee and no hold row; stock drops once and
// the tickets and ticket email commit with the order or not at all.
export async function issueFreeOrder(tx: Prisma.TransactionClient, input: FreeIssuanceInput) {
  const { event, ticketType, quantity, now } = input;
  const order = await tx.order.create({
    data: {
      organisationId: event.organisationId,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: input.userId,
      guestIdentityId: input.guestIdentityId ?? null,
      quantity,
      unitPrice: 0,
      totalAmount: 0,
      membershipGrantId: input.membership?.grantId ?? null,
      membershipEntitlementVersion: input.membership?.entitlementVersion ?? null,
      status: "paid",
      paidAt: now,
      fulfilledAt: now,
      paymentKind: "free",
      compensationRefundModeSnapshot: event.compensationRefundMode,
      purchasedTicketTypeName: ticketType.name,
      sellerName: event.organisation.name,
      feeAmount: 0,
      snapshotVersion: PURCHASE_SNAPSHOT_VERSION,
      buyerEmailSnapshot: input.buyer.email,
      buyerFirstNameSnapshot: input.buyer.firstName,
      buyerLastNameSnapshot: input.buyer.lastName,
      buyerDisplayNameSnapshot: input.buyer.displayName,
      buyerIdentityCapturedAt: now,
      buyerIdentityProvenance: input.guestIdentityId ? "verified_guest" : "purchase"
    },
    select: { id: true }
  });

  const stock = await tx.ticketType.updateMany({
    where: { id: ticketType.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } }
  });
  // The caller checked sellable stock under the same lock, so this cannot happen.
  if (stock.count !== 1) throw new Error("Free ticket stock changed under the inventory lock");

  await tx.ticket.createMany({
    data: Array.from({ length: quantity }, (_, index) => ({
      issueSequence: index + 1,
      orderId: order.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      organisationId: event.organisationId
    }))
  });

  await appendOrderLifecycleEvent(tx, { orderId: order.id, type: "order_created", source: "checkout", toOrderStatus: "paid" });
  await appendOrderLifecycleEvent(tx, {
    orderId: order.id,
    type: "free_fulfilled",
    source: "checkout",
    toOrderStatus: "paid",
    facts: { ticketCount: quantity }
  });
  // No reconcile time: the recovery worker never picks up a free attempt.
  const attempt = await tx.checkoutAttempt.create({
    data: { ...input.attempt, orderId: order.id, reconcileDueAt: null },
    select: { id: true }
  });
  await enqueueAutomaticTicketEmailForOrder(tx, order.id, "checkout");

  return { orderId: order.id, attemptId: attempt.id };
}
