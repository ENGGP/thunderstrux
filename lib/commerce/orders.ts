import type { CommerceKind, CommerceLifecycleEventType, OrderLifecycleSource, OrderStatus, PaymentKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decodeTimestampCursor,
  descendingCursorWhere,
  orderByForDirection,
  pageInfoForPage,
  type ParsedPaginationOptions
} from "@/lib/pagination/cursor";

// Membership and merchandise orders (T20, database spec section 7). A commerce
// order belongs to one society and one family; it is created with its lines,
// snapshots and first history entry in one transaction, and the database
// keeps those facts from changing afterwards. Checkout (T21) and the product
// families (T22, T25) build on this; ticket orders stay as they are.

export class CommerceOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceOrderError";
  }
}

const maxLines = 10;
const maxQuantity = 10;
// PostgreSQL integer: every amount is checked against it before any write.
const maxAmount = BigInt(2_147_483_647);

export type CommerceLineInput = {
  quantity: number;
  unitAmount: number;
  name: string;
  variant?: string | null;
  termStartsAt?: Date | null;
  termEndsAt?: Date | null;
  // The plan a membership line buys (T22); the database keeps it in the order's society.
  membershipProductId?: string | null;
};

export type CreateCommerceOrderInput = {
  organisationId: string;
  kind: CommerceKind;
  buyer: { userId: string } | { guestIdentityId: string };
  buyerEmail: string;
  buyerName?: string | null;
  paymentKind: PaymentKind;
  feeAmount?: number;
  feePolicyVersion?: string | null;
  expiresAt?: Date | null;
  lines: CommerceLineInput[];
  source: OrderLifecycleSource;
  actorUserId?: string | null;
};

// Checked arithmetic: integer cents, no floating point, no overflow.
export function commerceTotals(kind: CommerceKind, paymentKind: PaymentKind, lines: CommerceLineInput[], feeAmount: number) {
  if (lines.length < 1 || lines.length > maxLines) throw new CommerceOrderError(`An order has 1 to ${maxLines} lines`);
  let total = BigInt(0);
  const priced = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxQuantity) throw new CommerceOrderError(`Quantity must be 1 to ${maxQuantity}`);
    if (kind === "membership" && line.quantity !== 1) throw new CommerceOrderError("A membership line is one term");
    if (!Number.isInteger(line.unitAmount) || line.unitAmount < 0) throw new CommerceOrderError("Prices are whole cents of zero or more");
    const lineAmount = BigInt(line.quantity) * BigInt(line.unitAmount);
    total += lineAmount;
    if (lineAmount > maxAmount || total > maxAmount) throw new CommerceOrderError("The order total is too large");
    return { ...line, lineAmount: Number(lineAmount) };
  });
  if (!Number.isInteger(feeAmount) || feeAmount < 0 || BigInt(feeAmount) > total) throw new CommerceOrderError("The fee must be between zero and the total");
  if (paymentKind === "free" && total !== BigInt(0)) throw new CommerceOrderError("A free order totals zero");
  return { priced, totalAmount: Number(total) };
}

export async function lockCommerceOrder(tx: Prisma.TransactionClient, commerceOrderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CommerceOrder" WHERE "id" = ${commerceOrderId} FOR UPDATE`;
  return rows.length > 0;
}

// Appends the next history entry. The caller holds the order lock, so two
// writers can't take the same sequence number.
export async function appendCommerceLifecycleEvent(
  tx: Prisma.TransactionClient,
  input: {
    commerceOrderId: string;
    type: CommerceLifecycleEventType;
    source: OrderLifecycleSource;
    actorUserId?: string | null;
    stripeEventId?: string | null;
    fromStatus?: OrderStatus | null;
    toStatus?: OrderStatus | null;
    reason?: string | null;
    facts?: Prisma.InputJsonObject;
  }
) {
  const latest = await tx.commerceLifecycleEvent.findFirst({ where: { commerceOrderId: input.commerceOrderId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return tx.commerceLifecycleEvent.create({ data: { ...input, sequence: (latest?.sequence ?? 0) + 1 } });
}

// Creates the order, its lines and its first history entry inside the
// caller's transaction. The seller is read from the society here, so the
// snapshot is what the society was at the moment of purchase.
export async function createCommerceOrder(tx: Prisma.TransactionClient, input: CreateCommerceOrderInput) {
  const { priced, totalAmount } = commerceTotals(input.kind, input.paymentKind, input.lines, input.feeAmount ?? 0);
  if (input.kind === "membership" && !("userId" in input.buyer)) throw new CommerceOrderError("Memberships are bought by members, not guests");
  const seller = await tx.organisation.findUnique({
    where: { id: input.organisationId },
    select: { name: true, supportEmail: true, stripeAccountId: true }
  });
  if (!seller) throw new CommerceOrderError("Society not found");
  const order = await tx.commerceOrder.create({
    data: {
      organisationId: input.organisationId,
      kind: input.kind,
      ...input.buyer,
      paymentKind: input.paymentKind,
      totalAmount,
      feeAmount: input.feeAmount ?? 0,
      feePolicyVersion: input.feePolicyVersion ?? null,
      expiresAt: input.expiresAt ?? null,
      buyerEmailSnapshot: input.buyerEmail.trim().toLowerCase(),
      buyerNameSnapshot: input.buyerName ?? null,
      sellerName: seller.name,
      sellerSupportEmail: seller.supportEmail || null,
      sellerStripeAccountId: input.paymentKind === "stripe" ? seller.stripeAccountId : null
    }
  });
  await tx.commerceOrderLine.createMany({
    data: priced.map((line, index) => ({
      orderId: order.id, organisationId: input.organisationId, kind: input.kind, lineNumber: index + 1,
      quantity: line.quantity, unitAmount: line.unitAmount, lineAmount: line.lineAmount, currency: order.currency,
      nameSnapshot: line.name.trim(), variantSnapshot: line.variant ?? null, termStartsAt: line.termStartsAt ?? null, termEndsAt: line.termEndsAt ?? null,
      membershipProductId: line.membershipProductId ?? null
    }))
  });
  await appendCommerceLifecycleEvent(tx, {
    commerceOrderId: order.id, type: "order_created", source: input.source, actorUserId: input.actorUserId ?? null,
    toStatus: order.status, facts: { lineCount: priced.length, totalAmount }
  });
  return order;
}

const lineSelect = {
  lineNumber: true, nameSnapshot: true, variantSnapshot: true, quantity: true, unitAmount: true, lineAmount: true, termStartsAt: true, termEndsAt: true
} satisfies Prisma.CommerceOrderLineSelect;

const summarySelect = {
  id: true, kind: true, status: true, paymentKind: true, currency: true, totalAmount: true, sellerName: true,
  requiresCompensationReview: true, createdAt: true, fulfilledAt: true, cancelledAt: true
} satisfies Prisma.CommerceOrderSelect;

// The buyer's own order: what they bought, from whom, and what happened.
// No buyer contact or provider ids, and history without staff or reasons.
export async function getOwnCommerceOrder(userId: string, commerceOrderId: string) {
  const order = await prisma.commerceOrder.findFirst({
    where: { id: commerceOrderId, userId },
    select: {
      ...summarySelect, sellerSupportEmail: true,
      lines: { orderBy: { lineNumber: "asc" }, select: lineSelect },
      lifecycleEvents: { orderBy: { sequence: "asc" }, select: { type: true, createdAt: true } }
    }
  });
  return order ? { family: order.kind, ...order } : null;
}

// One society's order for staff with orders:read: adds the buyer snapshot,
// the fee, provider references and the full history.
export async function getOrganisationCommerceOrder(organisationId: string, commerceOrderId: string) {
  const order = await prisma.commerceOrder.findFirst({
    where: { id: commerceOrderId, organisationId },
    select: {
      ...summarySelect, feeAmount: true, feePolicyVersion: true, buyerEmailSnapshot: true, buyerNameSnapshot: true,
      guestIdentityId: true, stripeSessionId: true, stripePaymentIntentId: true, reviewReason: true, paidAt: true, failedAt: true, failureReason: true,
      lines: { orderBy: { lineNumber: "asc" }, select: lineSelect },
      lifecycleEvents: {
        orderBy: { sequence: "asc" },
        select: { sequence: true, type: true, source: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
      }
    }
  });
  if (!order) return null;
  const { guestIdentityId, ...rest } = order;
  return { family: order.kind, guest: guestIdentityId !== null, ...rest };
}

// The member's commerce orders, newest first, for the unified Purchases (T29).
export async function getOwnCommerceOrders(userId: string, { limit, cursor, direction }: ParsedPaginationOptions) {
  const decoded = cursor ? decodeTimestampCursor("createdAt", cursor) : null;
  const orders = await prisma.commerceOrder.findMany({
    where: { userId, ...(decoded ? descendingCursorWhere("createdAt", decoded, direction) : {}) },
    orderBy: orderByForDirection("createdAt", direction, "desc"),
    take: limit + 1,
    select: summarySelect
  });
  const page = pageInfoForPage({ items: orders, limit, direction, cursor, timestampField: "createdAt" });
  return { items: page.items.map((order) => ({ family: order.kind, ...order })), pageInfo: page.pageInfo };
}
