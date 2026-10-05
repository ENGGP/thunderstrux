import type { Prisma } from "@prisma/client";
export const buyerIdentitySelect = {
  buyerEmailSnapshot: true, buyerFirstNameSnapshot: true, buyerLastNameSnapshot: true,
  buyerDisplayNameSnapshot: true, buyerIdentityCapturedAt: true, buyerIdentityProvenance: true
} as const satisfies Prisma.OrderSelect;
type Buyer = { email: string; firstName?: string | null; lastName?: string | null; displayName?: string | null };
type CapturedBuyer = { buyerEmailSnapshot: string | null; buyerFirstNameSnapshot: string | null; buyerLastNameSnapshot: string | null; buyerDisplayNameSnapshot: string | null; buyerIdentityCapturedAt: Date | null };
export function retainedBuyerIdentity(order: CapturedBuyer & { user: Buyer | null }) {
  if (order.buyerIdentityCapturedAt) return { email: order.buyerEmailSnapshot!, firstName: order.buyerFirstNameSnapshot, lastName: order.buyerLastNameSnapshot, displayName: order.buyerDisplayNameSnapshot };
  return order.user ? { email: order.user.email, firstName: order.user.firstName ?? null, lastName: order.user.lastName ?? null, displayName: order.user.displayName ?? null } : null;
}
