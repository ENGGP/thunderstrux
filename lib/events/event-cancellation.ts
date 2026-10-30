import { appUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { EventLifecycleNotFoundError, EventLifecycleValidationError } from "@/lib/events/event-lifecycle";
import { lockEventInventory } from "@/lib/events/inventory";
import { formatDateRange, formatMoney } from "@/lib/format";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logWarn } from "@/lib/ops/logger";
import { reconcileExpiredCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { cancelFreeOrder } from "@/lib/payments/free-cancellation";
import { OrderRefundError, openOrderRefund, type RefundFailureKind } from "@/lib/payments/order-refunds";
import { releasedEarlyShare, shareRefundsSelect } from "@/lib/payouts/release";
import { getStripe } from "@/lib/stripe";
import { zoneCity } from "@/lib/zoned-time";

// Cancel a published event with sales (EVT-004), as Luma, Eventbrite and
// Humanitix do: one confirmation instead of a refund per order. In one
// transaction under the event lock (so no checkout or fulfilment interleaves):
// sales close for good, each paid Stripe order gets a RefundRequest that the
// refund worker sends, each free registration is cancelled, and every ticket
// holder is emailed once. Orders that can't be refunded here (disputed,
// already refunded, in review) are skipped and reported for staff to settle.
// The caller has verified the staff member's fresh authenticator code.

export type SkippedOrder = { orderId: string; reason: RefundFailureKind };

// A 300-order event writes a few thousand rows; the default 5 s isn't enough.
const transactionOptions = { maxWait: 10_000, timeout: 120_000 };

export async function cancelOrganisationEvent(
  organisationId: string,
  eventId: string,
  input: { confirmation: string; reason: string },
  actor: { id: string }
) {
  const result = await cancelInTransaction(organisationId, eventId, input, actor);
  // PAY-022: the platform watches that Stripe can take these refunds back from the society's bank.
  if (result.releasedEarly.amount > 0) emitOperationalAlert("event_cancelled_after_release", { organisationId, eventId, ...result.releasedEarly });
  // A repeat closes again any page an earlier attempt couldn't reach.
  return { ...result, checkoutsClosed: await closeOpenCheckouts(eventId) };
}

// After the cancellation commits, Stripe closes each unpaid order's payment
// page, so nobody can pay for an event that won't happen (EVT-006); the order
// then expires as when its page times out. A payment Stripe took first goes to
// compensation at fulfilment. Stripe is called outside the transaction, as buyer
// cancel does; a failed call is logged, and the stale-order job closes that page when its hold ends.
async function closeOpenCheckouts(eventId: string) {
  const pending = await prisma.order.findMany({ where: { eventId, status: "pending", stripeSessionId: { not: null } }, select: { id: true, stripeSessionId: true } });
  let closed = 0;
  for (const order of pending) {
    try {
      const stripe = getStripe();
      let session = await stripe.checkout.sessions.retrieve(order.stripeSessionId as string);
      if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id);
      if (session.status !== "expired") continue;
      if ((await reconcileExpiredCheckoutSession(session, { source: "staff_action" })).status === "expired") closed += 1;
    } catch (error) {
      logWarn("event_cancellation.checkout_close_failed", { eventId, orderId: order.id, error });
    }
  }
  return closed;
}

async function cancelInTransaction(
  organisationId: string,
  eventId: string,
  input: { confirmation: string; reason: string },
  actor: { id: string }
) {
  const reason = input.reason.trim();
  // Each order records why too; its reason columns hold at most 500 characters.
  const orderReason = `Event cancelled: ${reason}`.slice(0, 500);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const owned = await tx.event.findFirst({ where: { id: eventId, organisationId }, select: { id: true } });
    if (!owned || !(await lockEventInventory(tx, owned.id))) throw new EventLifecycleNotFoundError();
    const event = await tx.event.findUniqueOrThrow({
      where: { id: owned.id },
      select: { title: true, status: true, startTime: true, endTime: true, cancelledAt: true, organisation: { select: { name: true, timeZone: true } } }
    });
    // A repeat answers the first cancellation and does nothing again.
    if (event.cancelledAt) return { status: "already_cancelled" as const, cancelledAt: event.cancelledAt, refundsQueued: 0, freeCancelled: 0, notified: 0, skipped: [] as SkippedOrder[], releasedEarly: { amount: 0, orders: 0 } };
    if (event.status !== "published") {
      throw new EventLifecycleValidationError("Only a published event can be cancelled", [{ path: ["eventId"], message: "Delete the draft instead" }]);
    }
    if (event.endTime <= now) {
      throw new EventLifecycleValidationError("This event has ended", [{ path: ["eventId"], message: "An event that has ended can't be cancelled. Refund single orders from Orders." }]);
    }
    if (input.confirmation.trim().toLowerCase() !== event.title.trim().toLowerCase()) {
      throw new EventLifecycleValidationError("Type the event title to confirm", [{ path: ["confirmation"], message: "Type the event title exactly as it appears" }]);
    }

    await tx.event.update({
      where: { id: owned.id },
      data: { cancelledAt: now, cancellationReason: reason, saleState: "closed", version: { increment: 1 } }
    });

    const orders = await tx.order.findMany({
      where: { eventId: owned.id, status: "paid" },
      orderBy: { id: "asc" },
      select: {
        id: true, paymentKind: true, cancelledAt: true, totalAmount: true, externalRefundedAmount: true, feeAmount: true, paidAt: true, sellerName: true, ...buyerIdentitySelect, ...shareRefundsSelect,
        user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
        _count: { select: { tickets: { where: { validity: { not: "void" } } } } }
      }
    });
    const seller = (name: string | null) => name ?? event.organisation.name;
    const when = `${formatDateRange(event.startTime, event.endTime, event.organisation.timeZone)} (${zoneCity(event.organisation.timeZone)})`;
    const skipped: SkippedOrder[] = [];
    let refundsQueued = 0;
    let freeCancelled = 0;
    let notified = 0;
    // PAY-022: refunds of sales already released for payout, which Stripe may take from the society's bank.
    const early = { amount: 0, orders: 0 };

    for (const order of orders) {
      // Only an order whose tickets still admit someone has a holder to tell;
      // a paid one without is still tried, so an earlier refund is reported.
      const holder = order._count.tickets > 0;
      if (order.paymentKind === "free" && (!holder || order.cancelledAt)) continue;
      let outcome: string;
      if (order.paymentKind === "free") {
        await cancelFreeOrder(tx, { organisationId, orderId: order.id, by: { kind: "event", actorUserId: actor.id }, reason: orderReason, now });
        freeCancelled += 1;
        outcome = "Nothing was charged, so there is nothing to refund, and your registration is cancelled.";
      } else {
        try {
          // Whatever is left: an order partly refunded already gets the rest (DEBT-002).
          const request = await openOrderRefund(tx, { organisationId, orderId: order.id, actor, reason: orderReason });
          refundsQueued += 1;
          const released = releasedEarlyShare(order, now);
          if (released > 0) { early.amount += released; early.orders += 1; }
          outcome = `Your ${formatMoney(request.amount)} refund has started. We'll email you again when it goes through; banks usually take 5 to 10 business days after that.`;
        } catch (error) {
          if (!(error instanceof OrderRefundError)) throw error;
          skipped.push({ orderId: order.id, reason: error.kind });
          outcome = error.kind === "disputed"
            ? "Your bank is handling a dispute about this payment, so your money is settled through that dispute."
            : error.kind === "already_refunded"
              ? "Your payment has already been refunded in full."
              : `${seller(order.sellerName)} will contact you about your payment.`;
        }
      }
      const recipient = retainedBuyerIdentity(order)?.email;
      if (!holder || !recipient) continue;
      const { enqueued } = await enqueueNotification(tx, {
        eventKey: `event-cancelled/${owned.id}/${order.id}`, recipient, template: "event_cancelled", organisationId,
        payload: {
          subject: `Cancelled: ${event.title}`,
          message: `${seller(order.sellerName)} has cancelled ${event.title}, which was on ${when}. Their message: "${reason}" ${outcome}`,
          ...(order.user ? { link: new URL(`/purchases/tickets/${order.id}`, appUrl()).toString() } : {})
        }
      });
      if (enqueued) notified += 1;
    }

    await tx.auditLog.create({ data: {
      organisationId, actorUserId: actor.id, action: "event.cancelled", targetType: "Event", targetId: owned.id,
      metadata: { reason, refundsQueued, freeCancelled, notified, skipped, releasedEarly: early }
    } });
    return { status: "cancelled" as const, cancelledAt: now, refundsQueued, freeCancelled, notified, skipped, releasedEarly: early };
  }, transactionOptions);
}
