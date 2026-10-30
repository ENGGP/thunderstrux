import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { CommerceFamilyAdapter, CommerceOrderForHooks } from "@/lib/commerce/families";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatMoney, orderReference } from "@/lib/format";
import { mintPurchaseLink } from "@/lib/guest/guest-access";
import { MAX_BASKET_LINES, MAX_LINE_QUANTITY } from "@/lib/merchandise/basket";
import { lateWebhookGraceMs } from "@/lib/tickets/reservations";

// Selling merchandise (T27a): the merchandise commerce family, checkout holds
// and stock. Loaded by the payments webhook and the stale-order worker through
// the family registry, so this module stays free of auth and request code.
//
// Lock order: the buyer (checkout only), then the order's options in
// ascending id, then the commerce order. Catalogue edits lock the product
// before its options and checkout never locks the product, so they can't
// deadlock.
//
// A hold is not a row of its own: the lines of a pending Stripe order that
// has not passed its `expiresAt` (the hold, PAY-009: the job closes its Stripe page then) plus
// `lateWebhookGraceMs` hold their stock. Paying, failing or expiring the order ends its hold, so the
// two can never disagree.

export type MerchandiseUnavailableReason = "unavailable" | "sold_out" | "not_enough" | "quote_changed" | "purchase_in_progress" | "free_limit_reached";

export class MerchandiseUnavailableError extends Error {
  constructor(readonly reason: MerchandiseUnavailableReason, message: string, readonly variantId?: string, readonly available?: number, readonly orderId?: string) {
    super(message);
    this.name = "MerchandiseUnavailableError";
  }
}

type Db = Pick<Prisma.TransactionClient, "commerceOrderLine">;

// Units of each option held by checkouts still waiting on Stripe. A hold
// outlives its Stripe page by the late-webhook grace, as ticket holds do
// (DEF-033), so a payment made just before the page closed still finds its stock.
export async function heldByVariant(db: Db, variantIds: string[], now: Date, exceptOrderId?: string) {
  if (!variantIds.length) return new Map<string, number>();
  const rows = await db.commerceOrderLine.groupBy({
    by: ["merchandiseVariantId"],
    where: {
      merchandiseVariantId: { in: variantIds },
      order: { status: "pending", paymentKind: "stripe", expiresAt: { gt: new Date(now.getTime() - lateWebhookGraceMs) }, ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}) }
    },
    _sum: { quantity: true }
  });
  return new Map(rows.map((row) => [row.merchandiseVariantId as string, row._sum.quantity ?? 0]));
}

// The basket's version: changes with any option, price or quantity, whatever the line order.
export const quoteVersion = (lines: Array<{ variantId: string; unitPrice: number; quantity: number }>) =>
  createHash("sha256")
    .update(JSON.stringify(lines.filter((line) => line.quantity > 0).map((line) => [line.variantId, line.unitPrice, line.quantity]).sort()))
    .digest("hex")
    .slice(0, 16);

async function lockVariants(tx: Prisma.TransactionClient, variantIds: string[]) {
  if (variantIds.length) await tx.$queryRaw`SELECT "id" FROM "MerchandiseVariant" WHERE "id" IN (${Prisma.join(variantIds)}) ORDER BY "id" FOR UPDATE`;
}

const optionLabel = (option: { colour: string; size: string }) => [option.colour, option.size].filter(Boolean).join(" · ");

const selection = z
  .object({
    items: z
      .array(z.object({ variantId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) }).strict())
      .min(1)
      .max(MAX_BASKET_LINES)
      .refine((items) => new Set(items.map((item) => item.variantId)).size === items.length, "List each option once"),
    quoteVersion: z.string().regex(/^[0-9a-f]{16}$/)
  })
  .strict();

export const merchandiseFamily: CommerceFamilyAdapter<z.infer<typeof selection>> = {
  selection,
  guests: true,

  // Under the buyer and option locks: every option still on sale in this
  // society, enough left after other checkouts' holds, and the prices the
  // buyer reviewed. Nothing is lowered here; the basket re-quotes instead.
  async quote(tx, { organisationId, buyer, selection: { items, quoteVersion: version } }) {
    const ids = items.map((item) => item.variantId);
    await lockVariants(tx, ids);
    const now = new Date();
    // One unpaid basket per buyer per society holds stock at a time (SEC-010). Checkout has already locked the buyer.
    const open = await tx.commerceOrder.findFirst({
      where: { organisationId, kind: "merchandise", status: "pending", paymentKind: "stripe", expiresAt: { gt: now }, ...buyer },
      select: { id: true }
    });
    if (open) throw new MerchandiseUnavailableError("purchase_in_progress", "You already have a checkout in progress. Finish or cancel it first.", undefined, undefined, open.id);
    const [options, held, ownFree] = await Promise.all([
      tx.merchandiseVariant.findMany({
        where: { id: { in: ids }, organisationId, archivedAt: null, product: { status: "published" } },
        select: { id: true, colour: true, size: true, priceAmount: true, remaining: true, product: { select: { name: true } } }
      }),
      heldByVariant(tx, ids, now),
      // A free basket completes at once, so the rule above never stops a repeat. Refunded,
      // cancelled and closed orders give their units back, as voided free tickets do; a refund
      // still processing doesn't yet, as its tickets stay valid until it succeeds.
      tx.commerceOrderLine.groupBy({
        by: ["merchandiseVariantId"],
        where: { merchandiseVariantId: { in: ids }, unitAmount: 0, order: { status: { in: ["pending", "paid"] }, cancelledAt: null, OR: [{ refundStatus: null }, { refundStatus: "processing" }], ...buyer } },
        _sum: { quantity: true }
      })
    ]);
    const freeByVariant = new Map(ownFree.map((row) => [row.merchandiseVariantId as string, row._sum.quantity ?? 0]));
    const byId = new Map(options.map((option) => [option.id, option]));
    const lines = items.map((item) => {
      const option = byId.get(item.variantId);
      if (!option) throw new MerchandiseUnavailableError("unavailable", "An item in your basket is no longer sold", item.variantId);
      const left = Math.max(0, option.remaining - (held.get(option.id) ?? 0));
      if (left < item.quantity) {
        throw new MerchandiseUnavailableError(left ? "not_enough" : "sold_out", left ? `Only ${left} left of ${option.product.name}` : `${option.product.name} has sold out`, option.id, left);
      }
      // One buyer's free units of an option stay within one line's worth, so nobody can empty a giveaway.
      const earlierFree = option.priceAmount === 0 ? (freeByVariant.get(option.id) ?? 0) : 0;
      if (earlierFree + item.quantity > MAX_LINE_QUANTITY) {
        throw new MerchandiseUnavailableError("free_limit_reached", `You can have up to ${MAX_LINE_QUANTITY} free of ${option.product.name}, and you already have ${earlierFree}.`, option.id, Math.max(0, MAX_LINE_QUANTITY - earlierFree));
      }
      return { quantity: item.quantity, unitAmount: option.priceAmount, name: option.product.name, variant: optionLabel(option) || null, merchandiseVariantId: option.id };
    });
    if (quoteVersion(lines.map((line) => ({ variantId: line.merchandiseVariantId, unitPrice: line.unitAmount, quantity: line.quantity }))) !== version) {
      throw new MerchandiseUnavailableError("quote_changed", "Your basket changed. Review it before paying.");
    }
    return { lines };
  },

  async lock(tx, order) {
    const lines = await tx.commerceOrderLine.findMany({ where: { orderId: order.id }, select: { merchandiseVariantId: true } });
    await lockVariants(tx, lines.flatMap((line) => (line.merchandiseVariantId ? [line.merchandiseVariantId] : [])));
  },

  // Under the option and order locks, once: after the verified payment, or in
  // checkout's transaction for a free total. Every line is taken from stock or
  // none is. An order whose hold lapsed before the payment landed may find its
  // stock gone; it goes to compensation review. Options that stopped selling
  // during a valid hold are still honoured.
  async fulfil(tx, order: CommerceOrderForHooks, now) {
    const lines = await tx.commerceOrderLine.findMany({
      where: { orderId: order.id },
      orderBy: { lineNumber: "asc" },
      select: { merchandiseVariantId: true, quantity: true, nameSnapshot: true, variantSnapshot: true }
    });
    const ids = lines.flatMap((line) => (line.merchandiseVariantId ? [line.merchandiseVariantId] : []));
    if (!lines.length || ids.length !== lines.length) return { fulfilled: false, reason: "option_missing" };
    const [options, held] = await Promise.all([
      tx.merchandiseVariant.findMany({ where: { id: { in: ids }, organisationId: order.organisationId }, select: { id: true, remaining: true } }),
      heldByVariant(tx, ids, now, order.id)
    ]);
    const remaining = new Map(options.map((option) => [option.id, option.remaining]));
    if (lines.some((line) => (remaining.get(line.merchandiseVariantId as string) ?? 0) - (held.get(line.merchandiseVariantId as string) ?? 0) < line.quantity)) {
      return { fulfilled: false, reason: "sold_out" };
    }
    for (const line of lines) {
      await tx.merchandiseVariant.update({ where: { id: line.merchandiseVariantId as string }, data: { remaining: { decrement: line.quantity }, version: { increment: 1 } } });
    }
    // Waits on the Pickups tab until staff mark it ready (T28a).
    await tx.commerceOrder.update({ where: { id: order.id }, data: { pickupStatus: "pending" } });

    const purchase = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { buyerEmailSnapshot: true, sellerName: true, totalAmount: true, organisation: { select: { pickupPolicy: true } } }
    });
    const items = lines.map((line) => `${line.quantity} × ${line.nameSnapshot}${line.variantSnapshot ? ` (${line.variantSnapshot})` : ""}`).join(", ");
    const total = purchase.totalAmount ? formatMoney(purchase.totalAmount) : "Free";
    const pickup = purchase.organisation.pickupPolicy ? ` Collect it in person: ${purchase.organisation.pickupPolicy}` : " Collect it in person.";
    const receipt = `Your order ${orderReference(order.id)} from ${purchase.sellerName} is confirmed: ${items}. Total: ${total}.${pickup} Bring your order reference.`;
    if (order.guestIdentityId && !order.userId) {
      // A guest's receipt carries the link back to this one order, so it goes
      // as a guest link email tied to the grant, like Find your purchase.
      const { grant, link } = await mintPurchaseLink(tx, order.guestIdentityId, { commerceOrderId: order.id }, now);
      await enqueueNotification(tx, {
        eventKey: `merchandise-receipt/${order.id}`,
        recipient: purchase.buyerEmailSnapshot,
        template: "guest_order_link",
        guestAccessGrantId: grant.id,
        expiresAt: grant.expiresAt,
        payload: { message: `${receipt} Open your order with the link below. It works once and stops working after 24 hours; after that, use Find your purchase.`, link }
      });
    } else {
      await enqueueNotification(tx, {
        eventKey: `merchandise-receipt/${order.id}`,
        recipient: purchase.buyerEmailSnapshot,
        template: "business_notice",
        organisationId: order.organisationId,
        payload: { message: receipt }
      });
    }
    return { fulfilled: true };
  },

  // A hold is the pending order itself, so failing or expiring it releases the stock.
  async release() {}
};
