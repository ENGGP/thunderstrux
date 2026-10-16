import { prisma } from "@/lib/db";
import { lockVerifiedAccount } from "@/lib/auth/account-lifecycle";
import { canOpenGuestOrder, readGuestSession } from "@/lib/guest/guest-access";

export class GuestClaimError extends Error {
  constructor(readonly kind: "unavailable" | "email_mismatch" | "already_claimed", message: string) { super(message); }
}

// Add to my account (T16c): the explicit, only way a guest order joins a
// member's purchases. Under the User, GuestIdentity and Order locks it checks
// that the member is verified, the guest session still opens this order, and
// the guest's verified email is the member's current email; then it sets
// userId once and audits it. The buyer snapshot is kept as it was.
export async function claimGuestOrder(input: { userId: string; guestSessionId: string | undefined; orderId: string }, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const user = await lockVerifiedAccount(tx, input.userId);
    const session = await readGuestSession(input.guestSessionId, now);
    if (!session || !(await canOpenGuestOrder(session, input.orderId))) {
      throw new GuestClaimError("unavailable", "Open this order from your email link, then add it to your account.");
    }
    await tx.$queryRaw`SELECT "id" FROM "GuestIdentity" WHERE "id" = ${session.guestIdentityId} FOR UPDATE`;
    const [order] = await tx.$queryRaw<Array<{ id: string; userId: string | null; guestIdentityId: string | null; organisationId: string; status: string }>>`
      SELECT "id", "userId", "guestIdentityId", "organisationId", "status" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
    if (!order || order.guestIdentityId !== session.guestIdentityId || order.status !== "paid") {
      throw new GuestClaimError("unavailable", "Open this order from your email link, then add it to your account.");
    }
    if (order.userId === user.id) return { claimed: false };
    if (order.userId) throw new GuestClaimError("already_claimed", "This order has already been added to an account.");
    // The guest email from the session, re-read under the lock, against the member's current email.
    const identity = await tx.guestIdentity.findUniqueOrThrow({ where: { id: session.guestIdentityId }, select: { email: true } });
    if (identity.email !== user.email) {
      throw new GuestClaimError("email_mismatch", "Only an account with the same verified email can add this order.");
    }
    await tx.order.update({ where: { id: order.id }, data: { userId: user.id } });
    await tx.auditLog.create({ data: {
      organisationId: order.organisationId, actorUserId: user.id, action: "order.guest_claimed", targetType: "Order", targetId: order.id,
      metadata: { guestIdentityId: session.guestIdentityId, at: now.toISOString() }
    } });
    return { claimed: true };
  });
}
