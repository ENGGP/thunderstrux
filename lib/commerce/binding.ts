import type { OrderLifecycleSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { commerceFamilies, type CommerceOrderForHooks } from "@/lib/commerce/families";
import { appendCommerceLifecycleEvent, lockCommerceOrder } from "@/lib/commerce/orders";

// Failing and binding a commerce checkout's order, shared by checkout, the
// webhook and the recovery and stale-order workers. Kept free of auth and
// request modules so workers, which run without AUTH_SECRET, can load it.

const hookOrderSelect = { id: true, organisationId: true, kind: true, userId: true, guestIdentityId: true } as const;

// Locks for an existing order: the family's resources, then the order.
export async function lockCommerceOrderForFamily(tx: Prisma.TransactionClient, commerceOrderId: string): Promise<CommerceOrderForHooks | null> {
  const order = await tx.commerceOrder.findUnique({ where: { id: commerceOrderId }, select: hookOrderSelect });
  if (!order) return null;
  await commerceFamilies[order.kind]?.lock(tx, order);
  return (await lockCommerceOrder(tx, commerceOrderId)) ? order : null;
}

// A pending order that will not be paid: failed, its hold released, its attempt closed.
export async function failPendingCommerceOrder(
  commerceOrderId: string,
  reason: string,
  source: OrderLifecycleSource,
  { status = "failed" as "failed" | "expired", stripeEventId }: { status?: "failed" | "expired"; stripeEventId?: string } = {}
) {
  return prisma.$transaction(async (tx) => {
    const order = await lockCommerceOrderForFamily(tx, commerceOrderId);
    if (!order) return false;
    const updated = await tx.commerceOrder.updateMany({
      where: { id: commerceOrderId, status: "pending" },
      data: { status, failedAt: new Date(), failureReason: reason }
    });
    if (updated.count === 0) return false;
    await commerceFamilies[order.kind]?.release(tx, order, reason);
    await tx.checkoutAttempt.updateMany({ where: { commerceOrderId }, data: { state: "failed", reconcileDueAt: null, lastOutcome: reason } });
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId, type: status === "expired" ? "order_expired" : "order_failed", source, stripeEventId, reason, fromStatus: "pending", toStatus: status
    });
    return true;
  });
}

// Binds Stripe's Session to the order and its attempt. The webhook may have
// bound it first; any other Session on a closed order is kept on the attempt
// so a payment on it still reaches compensation review through the webhook.
export async function attachCommerceSession(commerceOrderId: string, stripeSessionId: string, stripeSessionUrl: string, source: OrderLifecycleSource) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockCommerceOrder(tx, commerceOrderId))) return "missing" as const;
    const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId }, select: { status: true, stripeSessionId: true } });
    const attach = (state: "provider_attached" | "failed", lastOutcome: string) =>
      tx.checkoutAttempt.updateMany({ where: { commerceOrderId }, data: { state, stripeSessionId, stripeSessionUrl, reconcileDueAt: null, lastOutcome } });
    if (order.stripeSessionId === stripeSessionId) {
      await attach("provider_attached", "session_attached");
      return "attached" as const;
    }
    if (order.status !== "pending" || order.stripeSessionId) {
      await attach("failed", "order_not_pending_at_attach");
      return "order_closed" as const;
    }
    await tx.commerceOrder.update({ where: { id: commerceOrderId }, data: { stripeSessionId } });
    await attach("provider_attached", "session_attached");
    await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "stripe_session_attached", source, fromStatus: "pending", toStatus: "pending", facts: { stripeSessionId } });
    return "attached" as const;
  });
}
