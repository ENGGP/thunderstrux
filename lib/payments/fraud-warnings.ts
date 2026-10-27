import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { queueCommerceFraudRefund, verifiedCommercePayment } from "@/lib/commerce/payment-recovery";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { lockOrder } from "@/lib/payments/order-lifecycle";
import { OrderRefundError, openOrderRefund } from "@/lib/payments/order-refunds";
import { journal, journalled, verifiedOrderPayment } from "@/lib/payments/purchase-disputes";
import { getStripe } from "@/lib/stripe";

// PAY-023: a card issuer's early fraud warning usually comes before a fraud
// chargeback. Refunding first avoids the dispute fee and the society losing the
// sale, so an actionable warning on an order nobody has used (no ticket scanned,
// no merchandise collected) is refunded in full on the ordinary refund request,
// fence and worker. Anything else, or a payment that isn't an order's, alerts.

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

export const fraudRefundReason = "The card issuer reported this payment as fraud (Stripe early fraud warning)";

type Purchase = { orderId: string } | { commerceOrderId: string };

// The order the warning's payment bought, checked as disputes are: its Session
// names the order, the money went to the seller, and the charge is the warning's.
async function warnedPurchase(stripe: Stripe, warning: Stripe.Radar.EarlyFraudWarning): Promise<Purchase | null> {
  const intentId = idOf(warning.payment_intent);
  const chargeId = idOf(warning.charge);
  if (!intentId) return null;
  const commerce = await verifiedCommercePayment(stripe, intentId);
  if (commerce) return commerce.order && commerce.chargeId === chargeId ? { commerceOrderId: commerce.order.id } : null;
  const ticket = await verifiedOrderPayment(stripe, intentId);
  return ticket && ticket.chargeId === chargeId ? { orderId: ticket.order.id } : null;
}

// radar.early_fraud_warning.created. Journalled once by event id, like refund and
// dispute events, and decided on the warning as Stripe has it now.
export async function reconcileEarlyFraudWarning(event: Stripe.Event) {
  if (await journalled(event.id)) return;
  const stripe = getStripe();
  const warningId = (event.data.object as Stripe.Radar.EarlyFraudWarning).id;
  let warning: Stripe.Radar.EarlyFraudWarning;
  try {
    warning = await stripe.radar.earlyFraudWarnings.retrieve(warningId);
  } catch (error) {
    // A refusal that a retry won't fix (often a key without Radar read) alerts a
    // person instead of failing every delivery until Stripe gives up; anything else retries.
    const type = (error as { type?: unknown } | null)?.type;
    if (type !== "StripePermissionError" && type !== "StripeAuthenticationError" && type !== "StripeInvalidRequestError") throw error;
    logWarn("stripe.early_fraud_warning.unreadable", { stripeEventId: event.id, warningId, error });
    emitOperationalAlert("early_fraud_warning", { warningId, outcome: "unreadable" });
    return;
  }
  const facts = { warningId: warning.id, fraudType: warning.fraud_type };
  const purchase = await warnedPurchase(stripe, warning);
  if (!purchase) {
    logWarn("stripe.early_fraud_warning.unmatched", { stripeEventId: event.id, ...facts });
    emitOperationalAlert("early_fraud_warning", { ...facts, outcome: "unmatched" });
    return;
  }

  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event))) return null;
    if ("commerceOrderId" in purchase) {
      if (!(await lockCommerceOrderForFamily(tx, purchase.commerceOrderId))) return "not_found";
      return warning.actionable ? queueCommerceFraudRefund(tx, purchase.commerceOrderId, fraudRefundReason) : "not_actionable";
    }
    const order = await tx.order.findUnique({ where: { id: purchase.orderId }, select: { event: { select: { organisationId: true } } } });
    if (!order || !(await lockOrder(tx, purchase.orderId, order.event.organisationId))) return "not_found";
    if (!warning.actionable) return "not_actionable";
    // A scanned ticket was used, so the society keeps the sale and a person decides.
    if (await tx.ticket.count({ where: { orderId: purchase.orderId, checkedInAt: { not: null } } })) return "used";
    try {
      await openOrderRefund(tx, { organisationId: order.event.organisationId, orderId: purchase.orderId, actor: null, reason: fraudRefundReason });
      return "refund_queued";
    } catch (error) {
      // Refunded, in progress, disputed, in compensation or marked refunded outside: nothing to start.
      if (error instanceof OrderRefundError) return error.kind;
      throw error;
    }
  });
  if (!outcome) return;
  emitOperationalAlert("early_fraud_warning", { ...facts, ...purchase, outcome });
  logInfo("stripe.early_fraud_warning.reconciled", { stripeEventId: event.id, ...facts, ...purchase, outcome });
}
