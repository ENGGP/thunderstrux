import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AccountActor } from "@/lib/auth/account-lifecycle";
import { appendCommerceLifecycleEvent, lockCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatDateTime } from "@/lib/format";
import { MerchandiseCatalogueError } from "@/lib/merchandise/catalogue";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { ascendingCursorWhere, descendingCursorWhere, orderByForDirection, pageInfoForPage, readCursorOrFirstPage, type PaginationDirection } from "@/lib/pagination/cursor";
import { orderReference } from "@/lib/payments/order-refunds";

// Pickups (T28a, design round B2): fulfilled merchandise orders, which staff
// with merchandise:fulfil mark ready and then collected. Each step holds the
// User, then Organisation, then order locks, checks the order's version, and
// commits the step, its history, audit and email together.

export const pickupStages = ["prepare", "ready", "collected", "review"] as const;
export type PickupStage = (typeof pickupStages)[number];
const pageSize = 25;

// Only a paid order that isn't under review, refunded or cancelled is handed over.
const handOver = { status: "paid", requiresCompensationReview: false, refundStatus: null, disputeStatus: null, cancelledAt: null } as const;
const stageStatus = { prepare: "pending", ready: "ready", collected: "collected" } as const;
// Collected history survives a later refund (T28b); waiting stages drop refunded and cancelled orders.
const stageWhere = (stage: PickupStage): Prisma.CommerceOrderWhereInput =>
  stage === "review" ? { OR: [{ requiresCompensationReview: true }, { disputeStatus: { not: null }, pickupStatus: { not: "collected" } }] } : stage === "collected" ? { status: "paid", pickupStatus: "collected" } : { ...handOver, pickupStatus: stageStatus[stage] };
const stepEvents = ["pickup_ready", "pickup_collected"] as const;

export const pickupSettings = (organisationId: string) => prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { timeZone: true, pickupPolicy: true } });

export const toPrepareCount = (organisationId: string) => prisma.commerceOrder.count({ where: { organisationId, kind: "merchandise", ...stageWhere("prepare") } });

function search(query: string): Prisma.CommerceOrderWhereInput | null {
  if (!query) return null;
  const contains = { contains: query, mode: "insensitive" as const };
  return { OR: [{ buyerNameSnapshot: contains }, { buyerEmailSnapshot: contains }, ...(/^[a-z0-9]{6}$/i.test(query) ? [{ id: { endsWith: query.toLowerCase() } }] : [])] };
}

const personName = (person: { firstName: string | null; lastName: string | null; email: string } | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email : "Someone";

// One stage, oldest first while there is work to do (the order they came in)
// and newest first once collected or under review, with every stage's count.
// A page either way; an unreadable cursor starts again from the first page.
export async function listPickups(organisationId: string, { stage, query = "", cursor, direction }: { stage: PickupStage; query?: string; cursor?: string; direction?: PaginationDirection }) {
  const base = { organisationId, kind: "merchandise" as const };
  const ascending = stage === "prepare" || stage === "ready";
  const from = readCursorOrFirstPage("createdAt", cursor, direction);
  const after = from.at ? (ascending ? ascendingCursorWhere : descendingCursorWhere)("createdAt", from.at, from.direction) : null;
  const where = [base, stageWhere(stage), search(query), after].filter((part): part is Prisma.CommerceOrderWhereInput => part !== null);
  const [rows, ...counts] = await Promise.all([
    prisma.commerceOrder.findMany({
      where: { AND: where },
      orderBy: orderByForDirection("createdAt", from.direction, ascending ? "asc" : "desc"),
      take: pageSize + 1,
      select: {
        id: true, version: true, createdAt: true, paymentKind: true, buyerNameSnapshot: true, buyerEmailSnapshot: true, guestIdentityId: true, reviewReason: true,
        lines: { orderBy: { lineNumber: "asc" }, select: { quantity: true, nameSnapshot: true, variantSnapshot: true } },
        lifecycleEvents: {
          where: { type: { in: [...stepEvents] } },
          orderBy: { sequence: "desc" },
          take: 1,
          select: { createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
        }
      }
    }),
    ...pickupStages.map((name) => prisma.commerceOrder.count({ where: { ...base, ...stageWhere(name) } }))
  ]);
  const page = pageInfoForPage({ items: rows, limit: pageSize, direction: from.direction, cursor: from.cursor, timestampField: "createdAt" });
  return {
    orders: page.items.map(({ lifecycleEvents: [step], ...order }) => ({
      ...order,
      reference: orderReference(order.id),
      buyer: order.buyerNameSnapshot || order.buyerEmailSnapshot,
      guest: order.guestIdentityId !== null,
      step: step ? { at: step.createdAt, by: personName(step.actor) } : null
    })),
    counts: Object.fromEntries(pickupStages.map((name, index) => [name, counts[index]])) as Record<PickupStage, number>,
    nextCursor: page.pageInfo.nextCursor,
    previousCursor: page.pageInfo.previousCursor
  };
}
export type PickupRow = Awaited<ReturnType<typeof listPickups>>["orders"][number];

export const pickupStepSchema = z.object({ step: z.enum(["ready", "collected"]), expectedVersion: z.number().int().min(1).max(2147483646) }).strict();

// Mark ready (pending to ready) or Mark collected (ready to collected). A page
// opened before someone else's step is a 409 naming who did it and when;
// nothing changes and nobody is emailed twice.
export async function markPickup(actor: AccountActor, organisationId: string, orderId: string, input: z.infer<typeof pickupStepSchema>) {
  const { step, expectedVersion } = pickupStepSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const organisation = await lockOrganisationActor(tx, actor, organisationId, "merchandise:fulfil");
    await lockCommerceOrder(tx, orderId, organisationId);
    const order = await tx.commerceOrder.findFirst({
      where: { id: orderId, organisationId, kind: "merchandise" },
      select: { id: true, version: true, status: true, pickupStatus: true, requiresCompensationReview: true, refundStatus: true, disputeStatus: true, cancelledAt: true, buyerEmailSnapshot: true, sellerName: true }
    });
    if (!order) throw new MerchandiseCatalogueError(404, "Order not found");
    const reference = orderReference(order.id);
    const zone = { timeZone: organisation.timeZone };
    if (order.status !== "paid" || order.requiresCompensationReview || order.refundStatus || order.disputeStatus || order.cancelledAt || !order.pickupStatus) {
      throw new MerchandiseCatalogueError(409, `Order ${reference} can't be handed over: ${order.requiresCompensationReview ? "its payment is under review" : order.disputeStatus ? "the buyer has disputed the payment" : "it was refunded, cancelled or never paid"}. Nothing changed.`);
    }
    if (order.version !== expectedVersion || order.pickupStatus !== (step === "ready" ? "pending" : "ready")) {
      const last = await tx.commerceLifecycleEvent.findFirst({
        where: { commerceOrderId: order.id, type: { in: [...stepEvents] } },
        orderBy: { sequence: "desc" },
        select: { type: true, createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
      });
      throw new MerchandiseCatalogueError(
        409,
        last
          ? `${personName(last.actor)} marked order ${reference} ${last.type === "pickup_ready" ? "ready to collect" : "collected"} at ${formatDateTime(last.createdAt, zone)}. Nothing changed.`
          : `Order ${reference} changed since you opened this page. Reload it and check again.`
      );
    }

    const done = await tx.commerceOrder.update({ where: { id: order.id }, data: { pickupStatus: step, version: { increment: 1 } }, select: { version: true, updatedAt: true } });
    await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: step === "ready" ? "pickup_ready" : "pickup_collected", source: "staff_action", actorUserId: actor.id });
    await tx.auditLog.create({
      data: { organisationId, actorUserId: actor.id, action: `merchandise_order.${step}`, targetType: "CommerceOrder", targetId: order.id, metadata: { version: done.version } }
    });
    await enqueueNotification(tx, {
      eventKey: `merchandise-${step}/${order.id}`,
      recipient: order.buyerEmailSnapshot,
      template: "business_notice",
      organisationId,
      payload: {
        message:
          step === "ready"
            ? `Your order ${reference} from ${order.sellerName} is ready to collect.${organisation.pickupPolicy ? ` Collect it from: ${organisation.pickupPolicy}` : ""} Show order ${reference} when you collect.`
            : `You collected order ${reference} from ${order.sellerName} on ${formatDateTime(done.updatedAt, zone)}.`
      }
    });
    const staff = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { firstName: true, lastName: true, email: true } });
    return { id: order.id, reference, pickupStatus: step, version: done.version, at: done.updatedAt, by: personName(staff) };
  });
}

// The page's result after a step (?done=): read back from the order, never from the browser.
export async function pickupResult(organisationId: string, orderId: string) {
  const order = await prisma.commerceOrder.findFirst({
    where: { id: orderId, organisationId, kind: "merchandise", pickupStatus: { in: ["ready", "collected"] } },
    select: {
      id: true, pickupStatus: true, buyerNameSnapshot: true, buyerEmailSnapshot: true,
      lifecycleEvents: { where: { type: { in: [...stepEvents] } }, orderBy: { sequence: "desc" }, take: 1, select: { createdAt: true, actor: { select: { firstName: true, lastName: true, email: true } } } }
    }
  });
  const step = order?.lifecycleEvents[0];
  return order && step ? { reference: orderReference(order.id), collected: order.pickupStatus === "collected", buyer: order.buyerNameSnapshot || order.buyerEmailSnapshot, at: step.createdAt, by: personName(step.actor) } : null;
}
