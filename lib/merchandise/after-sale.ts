import { z } from "zod";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { MerchandiseCatalogueError } from "@/lib/merchandise/catalogue";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { orderReference, requestCommerceRefund } from "@/lib/payments/order-refunds";

// After a merchandise sale (T28b, design round B2): the staff order page,
// cancelling a free order, refunding a paid one through the shared commerce
// refund path (T23c), and recording returns. A refund never records a return
// and a return never refunds; stock comes back only when a return says so.

// The staff view of one merchandise order of this society, or null.
export async function staffMerchandiseOrder(organisationId: string, orderId: string) {
  const order = await prisma.commerceOrder.findFirst({
    where: { id: orderId, organisationId, kind: "merchandise" },
    select: {
      id: true, status: true, paymentKind: true, totalAmount: true, feeAmount: true, version: true, createdAt: true, paidAt: true,
      buyerNameSnapshot: true, buyerEmailSnapshot: true, guestIdentityId: true, userId: true,
      pickupStatus: true, refundStatus: true, cancelledAt: true, cancellationReason: true, requiresCompensationReview: true, reviewReason: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true, lineNumber: true, quantity: true, unitAmount: true, lineAmount: true, nameSnapshot: true, variantSnapshot: true,
          merchandiseVariant: { select: { sku: true, remaining: true } },
          returns: { select: { quantity: true } }
        }
      },
      lifecycleEvents: {
        orderBy: { sequence: "asc" },
        select: { sequence: true, type: true, reason: true, facts: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
      },
      merchandiseReturns: {
        orderBy: { createdAt: "asc" },
        select: { id: true, commerceOrderLineId: true, quantity: true, restocked: true, reason: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
      },
      refundRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, amount: true, reason: true, createdAt: true, resolvedAt: true, actor: { select: { firstName: true, lastName: true, email: true } } } }
    }
  });
  if (!order) return null;
  return {
    ...order,
    reference: orderReference(order.id),
    lines: order.lines.map(({ returns, ...line }) => ({ ...line, returned: returns.reduce((total, row) => total + row.quantity, 0) }))
  };
}
export type StaffMerchandiseOrder = NonNullable<Awaited<ReturnType<typeof staffMerchandiseOrder>>>;

async function merchandiseOrderId(organisationId: string, orderId: string) {
  const found = await prisma.commerceOrder.findFirst({ where: { id: orderId, organisationId, kind: "merchandise" }, select: { id: true } });
  if (!found) throw new MerchandiseCatalogueError(404, "Order not found");
  return found.id;
}

// Refund a paid merchandise order's whole payment through Stripe (orders:refund).
// Stripe's confirmation cancels a pickup not yet collected and emails the buyer.
export async function refundMerchandiseOrder(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string; confirmation: string }) {
  const commerceOrderId = await merchandiseOrderId(input.organisationId, input.orderId);
  return requestCommerceRefund({ organisationId: input.organisationId, commerceOrderId, actor: input.actor, reason: input.reason, confirmation: input.confirmation });
}

// Cancel a free order (the T18c shape, orders:refund): a cancellation fact on
// the order, its history and an email, never a refund row; the pickup is off.
// A collected order can't be cancelled (record a return instead). Stock isn't
// put back: a return does that if the item comes back.
export async function cancelFreeMerchandiseOrder(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  const orderId = await merchandiseOrderId(input.organisationId, input.orderId);
  return prisma.$transaction(async (tx) => {
    await lockCommerceOrderForFamily(tx, orderId);
    const order = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, paymentKind: true, status: true, cancelledAt: true, pickupStatus: true, buyerEmailSnapshot: true, sellerName: true }
    });
    if (order.cancelledAt) return { status: "already_cancelled" as const, cancelledAt: order.cancelledAt };
    if (order.paymentKind !== "free" || order.status !== "paid") throw new MerchandiseCatalogueError(409, "Only a free order can be cancelled. Refund a paid one instead.");
    if (order.pickupStatus === "collected") throw new MerchandiseCatalogueError(409, "This order was already collected. Record a return if the items come back.");
    await tx.commerceOrder.update({ where: { id: order.id }, data: { cancelledAt: now, cancelledByUserId: input.actor.id, cancellationReason: reason, version: { increment: 1 } } });
    await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: "free_cancelled", source: "staff_action", actorUserId: input.actor.id, reason });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "merchandise_order.free_cancelled", targetType: "CommerceOrder", targetId: order.id, metadata: { reason }
    } });
    await enqueueNotification(tx, {
      eventKey: `merchandise-cancelled/${order.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: input.organisationId,
      payload: { message: `${order.sellerName} has cancelled your free order ${orderReference(order.id)}: "${reason}". Nothing was charged, so there is nothing to refund, and there's nothing to collect.` }
    });
    return { status: "cancelled" as const, cancelledAt: now };
  });
}

export const returnSchema = z.object({
  lineId: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(10),
  restock: z.boolean(),
  reason: z.string().trim().min(3, "Say briefly why it came back.").max(500),
  // One key per return the staff member is recording, so a repeated request records it once.
  operationKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
}).strict();

// Record items handed back (merchandise:fulfil). Under the staff, society,
// option and order locks: no more than was bought less earlier returns, and
// stock goes up only if this return restocks, once, as the row is written.
export async function recordReturn(actor: AccountActor, organisationId: string, orderId: string, input: z.infer<typeof returnSchema>) {
  const { lineId, quantity, restock, reason, operationKey } = returnSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockOrganisationActor(tx, actor, organisationId, "merchandise:fulfil");
    const replay = await tx.merchandiseReturn.findUnique({ where: { operationKey } });
    if (replay) {
      if (replay.organisationId !== organisationId || replay.commerceOrderId !== orderId) throw new MerchandiseCatalogueError(409, "This return was already recorded for another order.");
      return replay;
    }
    const line = await tx.commerceOrderLine.findFirst({
      where: { id: lineId, orderId, organisationId, kind: "merchandise" },
      select: { id: true, quantity: true, nameSnapshot: true, merchandiseVariantId: true }
    });
    if (!line?.merchandiseVariantId) throw new MerchandiseCatalogueError(404, "Order not found");
    await tx.$queryRaw`SELECT "id" FROM "MerchandiseVariant" WHERE "id" = ${line.merchandiseVariantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CommerceOrder" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, fulfilledAt: true } });
    if (order.status !== "paid" || !order.fulfilledAt) throw new MerchandiseCatalogueError(409, "Only items from a completed order can be returned.");
    const returned = await tx.merchandiseReturn.aggregate({ where: { commerceOrderLineId: line.id }, _sum: { quantity: true } });
    const left = line.quantity - (returned._sum.quantity ?? 0);
    if (quantity > left) {
      throw new MerchandiseCatalogueError(409, left ? `Only ${left} ${line.nameSnapshot} can still be returned on this order.` : `Every ${line.nameSnapshot} on this order has already been returned.`, [
        { path: ["quantity"], message: `At most ${left}`, value: left }
      ]);
    }
    const created = await tx.merchandiseReturn.create({
      data: { organisationId, commerceOrderId: orderId, commerceOrderLineId: line.id, quantity, restocked: restock, reason, actorUserId: actor.id, operationKey }
    });
    if (restock) {
      await tx.merchandiseVariant.update({ where: { id: line.merchandiseVariantId }, data: { remaining: { increment: quantity }, version: { increment: 1 } } });
    }
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId: orderId, type: "return_recorded", source: "staff_action", actorUserId: actor.id, reason, facts: { line: line.nameSnapshot, quantity, restocked: restock }
    });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: actor.id, action: "merchandise_order.return_recorded", targetType: "CommerceOrder", targetId: orderId,
      metadata: { returnId: created.id, quantity, restocked: restock }
    } });
    return created;
  });
}
