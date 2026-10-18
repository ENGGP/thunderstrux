import { membershipLabel } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import { appendCommerceLifecycleEvent, lockCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { requestCommerceRefund } from "@/lib/payments/order-refunds";

// Ending a membership early (T23b). Both paths need a reason and the staff
// member's authenticator code, which the route checks. Neither moves money:
// revoking a paid membership is not a refund, and cancelling a free one has
// nothing to refund. Lock order: member (User), society (Organisation), then
// the commerce order, as checkout and fulfilment take them.

export class MembershipRevocationError extends Error {
  constructor(readonly kind: "not_found" | "not_revocable" | "not_cancellable", message: string) {
    super(message);
    this.name = "MembershipRevocationError";
  }
}

const grantSelect = {
  id: true, userId: true, organisationId: true, endsAt: true, revokedAt: true,
  product: { select: { name: true } },
  line: { select: { order: { select: { id: true, paymentKind: true, status: true, cancelledAt: true, buyerEmailSnapshot: true, sellerName: true } } } }
} satisfies Prisma.MembershipGrantSelect;

async function lockGrant(tx: Prisma.TransactionClient, organisationId: string, grantId: string) {
  const found = await tx.membershipGrant.findFirst({ where: { id: grantId, organisationId }, select: { userId: true } });
  if (!found) throw new MembershipRevocationError("not_found", "Membership not found");
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${found.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
  return tx.membershipGrant.findFirstOrThrow({ where: { id: grantId, organisationId }, select: grantSelect });
}

type Grant = Awaited<ReturnType<typeof lockGrant>>;

async function endGrant(tx: Prisma.TransactionClient, grant: Grant, actorId: string, reason: string, now: Date, message: string) {
  await tx.membershipGrant.update({ where: { id: grant.id }, data: { revokedAt: now, revokedByUserId: actorId, revocationReason: reason } });
  await enqueueNotification(tx, {
    eventKey: `membership-ended/${grant.id}`, recipient: grant.line.order.buyerEmailSnapshot, template: "business_notice", organisationId: grant.organisationId,
    payload: { message }
  });
}

// An exceptional revoke: the membership stops now and no money moves.
// Repeating it answers the first result.
export async function revokeMembership(input: { organisationId: string; grantId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const grant = await lockGrant(tx, input.organisationId, input.grantId);
    if (grant.revokedAt) return { status: "already_revoked" as const, revokedAt: grant.revokedAt };
    if (grant.endsAt <= now) throw new MembershipRevocationError("not_revocable", "This membership has already ended");
    await endGrant(tx, grant, input.actor.id, reason, now,
      `${grant.line.order.sellerName} has ended your ${membershipLabel(grant.product.name)}: "${reason}". No refund was made; contact the society if you have questions.`);
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "membership.revoked", targetType: "MembershipGrant", targetId: grant.id,
      metadata: { reason, commerceOrderId: grant.line.order.id }
    } });
    return { status: "revoked" as const, revokedAt: now };
  });
}

// Cancel a free membership (the T18c shape): the order gets a separate
// cancellation fact, keeps its status and fulfilment, and the grant is
// revoked. Never a refund row. Repeating it answers the first result.
export async function cancelFreeMembership(input: { organisationId: string; grantId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const grant = await lockGrant(tx, input.organisationId, input.grantId);
    const order = grant.line.order;
    if (order.paymentKind !== "free" || order.status !== "paid") {
      throw new MembershipRevocationError("not_cancellable", "Only a free membership can be cancelled. Refund a paid one instead.");
    }
    await lockCommerceOrder(tx, order.id);
    const current = await tx.commerceOrder.findUniqueOrThrow({ where: { id: order.id }, select: { cancelledAt: true } });
    if (current.cancelledAt) return { status: "already_cancelled" as const, cancelledAt: current.cancelledAt };
    await tx.commerceOrder.update({ where: { id: order.id }, data: { cancelledAt: now, cancelledByUserId: input.actor.id, cancellationReason: reason } });
    await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: "free_cancelled", source: "staff_action", actorUserId: input.actor.id, reason });
    // An earlier revoke already ended it; the cancellation is still recorded.
    if (!grant.revokedAt) {
      await endGrant(tx, grant, input.actor.id, reason, now,
        `${order.sellerName} has cancelled your free ${membershipLabel(grant.product.name)}: "${reason}". Nothing was charged, so there is nothing to refund.`);
    }
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "membership.free_cancelled", targetType: "MembershipGrant", targetId: grant.id,
      metadata: { reason, commerceOrderId: order.id }
    } });
    return { status: "cancelled" as const, cancelledAt: now };
  });
}

// Refund a paid membership's whole order through Stripe (T23c). The grant
// ends only when Stripe confirms the refund; until then it stays active.
export async function refundMembership(input: { organisationId: string; grantId: string; actor: { id: string }; reason: string; confirmation: string }) {
  const grant = await prisma.membershipGrant.findFirst({
    where: { id: input.grantId, organisationId: input.organisationId },
    select: { line: { select: { orderId: true } } }
  });
  if (!grant) throw new MembershipRevocationError("not_found", "Membership not found");
  return requestCommerceRefund({ organisationId: input.organisationId, commerceOrderId: grant.line.orderId, actor: input.actor, reason: input.reason, confirmation: input.confirmation });
}
