import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, orderReference, ticketReference } from "@/lib/format";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { getStripe } from "@/lib/stripe";

// On destination charges a buyer's dispute lands on the platform, and one left
// unanswered is lost. When a dispute opens, the facts Thunderstrux holds are
// staged on it as a draft, never submitted: the platform operator reviews it in
// Stripe's Dashboard and submits it before the due date (Production Operations).

type Purchase = { orderId: string } | { commerceOrderId: string };
type Evidence = Stripe.DisputeUpdateParams.Evidence;
type Refunded = { amount: number; stripeRefundId: string | null; at: Date };

// Statuses where Stripe still takes an answer.
const answerable = new Set(["needs_response", "warning_needs_response"]);

const at = (value: Date, timeZone: string) => `${formatDateTime(value, { timeZone })} (${timeZone})`;

// Money already back with the buyer, which a refunded-then-disputed payment needs said.
function refundLines(refunds: Refunded[], externalRefundedAmount: number, timeZone: string) {
  const lines = refunds.map((refund) => `Refunded ${formatMoney(refund.amount)} to the buyer's card on ${at(refund.at, timeZone)}${refund.stripeRefundId ? ` (Stripe refund ${refund.stripeRefundId})` : ""}.`);
  if (externalRefundedAmount > 0) lines.push(`Refunded ${formatMoney(externalRefundedAmount)} to the buyer's card from the Stripe Dashboard.`);
  return lines;
}

const buyerName = (buyer: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null) =>
  buyer ? [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || buyer.displayName || undefined : undefined;

async function ticketEvidence(orderId: string): Promise<Evidence | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, quantity: true, totalAmount: true, purchasedTicketTypeName: true, sellerName: true, paidAt: true, ticketEmailSentAt: true, externalRefundedAmount: true,
      ...buyerIdentitySelect,
      user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
      ticketType: { select: { name: true } },
      event: { select: { title: true, startTime: true, location: true, organisation: { select: { name: true, timeZone: true, refundPolicy: true } } } },
      tickets: { orderBy: { issueSequence: "asc" }, select: { id: true, checkedInAt: true } },
      refundRequests: { where: { status: "succeeded" }, select: { amount: true, stripeRefundId: true, resolvedAt: true, createdAt: true } },
      compensationRefundJob: { select: { state: true, amount: true, stripeRefundId: true, updatedAt: true } }
    }
  });
  if (!order) return null;
  const { timeZone, refundPolicy } = order.event.organisation;
  const buyer = retainedBuyerIdentity(order);
  const seller = order.sellerName ?? order.event.organisation.name;
  const checkedIn = order.tickets.filter((ticket) => ticket.checkedInAt);
  const refunds: Refunded[] = order.refundRequests.map((refund) => ({ amount: refund.amount, stripeRefundId: refund.stripeRefundId, at: refund.resolvedAt ?? refund.createdAt }));
  const job = order.compensationRefundJob;
  if (job?.state === "refunded") refunds.push({ amount: job.amount, stripeRefundId: job.stripeRefundId, at: job.updatedAt });
  return {
    customer_name: buyerName(buyer),
    customer_email_address: buyer?.email,
    product_description: `${order.quantity} × ${order.purchasedTicketTypeName ?? order.ticketType.name} ticket for ${order.event.title}, an event run by ${seller} at ${order.event.location}, sold through Thunderstrux.`,
    service_date: formatDate(order.event.startTime, timeZone),
    access_activity_log: order.tickets.length === 0
      ? "No tickets were issued for this order."
      : checkedIn.length
        ? checkedIn.map((ticket) => `Ticket ${ticketReference(ticket.id)} was scanned in at the door at ${at(ticket.checkedInAt as Date, timeZone)}.`).join("\n")
        : `None of the order's ${order.tickets.length} tickets was scanned in at the door.`,
    refund_policy_disclosure: refundPolicy ? `Shown on the checkout page before payment (current wording): "Refunds: ${refundPolicy}"` : undefined,
    uncategorized_text: [
      `Order ${orderReference(order.id)}: ${formatMoney(order.totalAmount)} paid${order.paidAt ? ` on ${at(order.paidAt, timeZone)}` : ""}${buyer ? ` by ${buyer.email}` : ""}.`,
      ...(order.ticketEmailSentAt ? [`The tickets were emailed to the buyer on ${at(order.ticketEmailSentAt, timeZone)}.`] : []),
      ...refundLines(refunds, order.externalRefundedAmount, timeZone)
    ].join("\n")
  };
}

async function commerceEvidence(commerceOrderId: string): Promise<Evidence | null> {
  const order = await prisma.commerceOrder.findUnique({
    where: { id: commerceOrderId },
    select: {
      id: true, kind: true, totalAmount: true, sellerName: true, paidAt: true, externalRefundedAmount: true, buyerEmailSnapshot: true, buyerNameSnapshot: true, pickupStatus: true,
      organisation: { select: { timeZone: true, refundPolicy: true } },
      lines: { orderBy: { lineNumber: "asc" }, select: { quantity: true, nameSnapshot: true } },
      refundRequests: { where: { status: "succeeded" }, select: { amount: true, stripeRefundId: true, resolvedAt: true, createdAt: true } }
    }
  });
  if (!order) return null;
  const { timeZone, refundPolicy } = order.organisation;
  const refunds = order.refundRequests.map((refund) => ({ amount: refund.amount, stripeRefundId: refund.stripeRefundId, at: refund.resolvedAt ?? refund.createdAt }));
  return {
    customer_name: order.buyerNameSnapshot ?? undefined,
    customer_email_address: order.buyerEmailSnapshot,
    product_description: `${order.lines.map((line) => `${line.quantity} × ${line.nameSnapshot}`).join(", ")} from ${order.sellerName}, sold through Thunderstrux.`,
    refund_policy_disclosure: refundPolicy ? `Shown on the checkout page before payment (current wording): "Refunds: ${refundPolicy}"` : undefined,
    uncategorized_text: [
      `Order ${orderReference(order.id)}: ${formatMoney(order.totalAmount)} paid${order.paidAt ? ` on ${at(order.paidAt, timeZone)}` : ""} by ${order.buyerEmailSnapshot}.`,
      ...(order.kind === "merchandise" && order.pickupStatus === "collected" ? ["The buyer collected the items in person."] : []),
      ...refundLines(refunds, order.externalRefundedAmount, timeZone)
    ].join("\n")
  };
}

// Called once, after the transaction that recorded a newly opened dispute. A
// failure never reaches the webhook: the event is already journalled, so the
// operator is alerted to answer from the order page instead.
export async function stageDisputeEvidence(dispute: Stripe.Dispute, purchase: Purchase) {
  if (!answerable.has(dispute.status) || dispute.evidence_details?.has_evidence) return;
  try {
    const evidence = "orderId" in purchase ? await ticketEvidence(purchase.orderId) : await commerceEvidence(purchase.commerceOrderId);
    if (!evidence) return;
    // submit: false only stages the draft; Stripe's default would send it to the bank.
    await getStripe().disputes.update(dispute.id, { evidence, submit: false });
    logInfo("stripe.dispute.evidence_staged", { disputeId: dispute.id, ...purchase });
  } catch (error) {
    logWarn("stripe.dispute.evidence_not_staged", { disputeId: dispute.id, ...purchase, error });
    emitOperationalAlert("dispute_evidence_not_staged", { disputeId: dispute.id, ...purchase, evidenceDueBy: dispute.evidence_details?.due_by ?? null });
  }
}
