import { prisma } from "@/lib/db";
import { orderReference } from "@/lib/format";
import { queueThresholds, readDisputesDue, readQueues, readWorkers, STUCK_AFTER_SECONDS, WORKER_STALE_AFTER_SECONDS } from "@/lib/ops/monitor";
import { checkApplicationReadiness } from "@/lib/ops/readiness";
import { mfaEnforcementMode } from "@/lib/security/staff-mfa";
import { legacyOrganisationAccessMode } from "@/lib/staff/live-authority";

// T54: the admin overview. "Needs you" comes first, worst first, from the same
// readings the monitor alerts on; then health; then plain counts (no charts).

export type NeedItem = { level: "hot" | "warm" | "cool"; title: string; detail: string; due?: Date; age?: Date; href: string; action: string };

const openDisputeStatuses = ["needs_response", "warning_needs_response", "appeal_needs_response", "under_review", "warning_under_review", "appeal_under_review"];
const queueLabels: Record<string, string> = {
  email_outbox: "Ticket emails", notification_outbox: "Notifications", checkout_attempts: "Uncertain checkouts", compensation_refunds: "Compensation refunds",
  order_refunds: "Order refunds", dispute_reversals: "Dispute reversals", ticket_holds: "Expired ticket holds", commerce_checkouts: "Expired shop checkouts"
};

export async function readNeeds(now = new Date()): Promise<NeedItem[]> {
  const [disputes, reviews, refunds, payouts, queues, workers] = await Promise.all([
    readDisputesDue(now),
    prisma.order.findMany({ where: { requiresCompensationReview: true }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true, createdAt: true, event: { select: { title: true, organisation: { select: { name: true } } } } } }),
    prisma.refundRequest.findMany({ where: { status: "uncertain" }, orderBy: { createdAt: "asc" }, take: 10, select: { orderId: true, commerceOrderId: true, createdAt: true } }),
    prisma.societyPayout.findMany({ where: { status: "failed", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, take: 10, select: { createdAt: true, organisation: { select: { id: true, name: true } } } }),
    readQueues(now),
    readWorkers(now)
  ]);
  const needs: NeedItem[] = [
    ...disputes.flatMap((dispute) => {
      const orderId = dispute.orderId ?? dispute.commerceOrderId;
      return orderId && dispute.evidenceDueBy ? [{ level: "hot" as const, title: "Dispute answer due", detail: `Order ${orderReference(orderId)}. The staged answer is waiting in Stripe.`, due: dispute.evidenceDueBy, href: `/admin/orders/${orderId}`, action: "Open order" }] : [];
    }),
    ...reviews.map((order) => ({ level: "warm" as const, title: "Payment in compensation review", detail: `${order.event.organisation.name} · ${order.event.title}. Paid but not issued; a finance manager decides.`, age: order.createdAt, href: `/admin/orders/${order.id}`, action: "Open order" })),
    ...refunds.flatMap((refund) => {
      const orderId = refund.orderId ?? refund.commerceOrderId;
      return orderId ? [{ level: "warm" as const, title: "Refund outcome unknown", detail: `Order ${orderReference(orderId)}. Don't refund by hand while it may exist.`, age: refund.createdAt, href: `/admin/orders/${orderId}`, action: "Open order" }] : [];
    }),
    ...payouts.map((payout) => ({ level: "warm" as const, title: "Payout refused by the bank", detail: `${payout.organisation.name} fixes bank details in Stripe; the money waits for the next payout.`, age: payout.createdAt, href: `/admin/societies/${payout.organisation.id}`, action: "Open society" })),
    ...queues.filter((queue) => queue.oldestAgeSeconds > queueThresholds[queue.queue] || queue.stuck > 0).map((queue) => ({
      level: "cool" as const, title: `${queueLabels[queue.queue]} backing up`,
      detail: `${queue.backlog} waiting${queue.stuck ? `, ${queue.stuck} stuck over ${STUCK_AFTER_SECONDS / 60} min` : ""}. Alerts at ${queueThresholds[queue.queue] / 60} min.`,
      age: new Date(now.getTime() - queue.oldestAgeSeconds * 1000), href: "/admin/operations", action: "Operations"
    })),
    ...workers.filter((worker) => worker.paused || worker.secondsSinceSuccess > WORKER_STALE_AFTER_SECONDS).map((worker) => ({
      level: "cool" as const, title: worker.paused ? `${worker.worker} job paused` : `${worker.worker} job hasn't succeeded`,
      detail: worker.paused ? "Its queue waits until it resumes (pnpm ops:workers -- resume)." : "Check its schedule is running.",
      age: worker.lastSucceededAt ?? undefined, href: "/admin/operations", action: "Operations"
    }))
  ];
  const rank = { hot: 0, warm: 1, cool: 2 };
  return needs.sort((a, b) => rank[a.level] - rank[b.level] || (a.due ?? a.age ?? now).getTime() - (b.due ?? b.age ?? now).getTime());
}

export async function readHealth() {
  const ready = await checkApplicationReadiness().then(() => true, () => false);
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  let mfaMode: string;
  try { mfaMode = mfaEnforcementMode(); } catch { mfaMode = "invalid"; }
  return {
    ready,
    rateLimiting: process.env.RATE_LIMIT_ENABLED === "true",
    stripeMode: /^(sk|rk)_live_/.test(key) ? "live" : key ? "test" : "none",
    staffMfa: mfaMode,
    legacyAccess: legacyOrganisationAccessMode(),
    startedAt: new Date(Date.now() - process.uptime() * 1000)
  };
}

async function countsSince(since: Date) {
  const paid = { paidAt: { gte: since }, status: "paid" as const };
  const [signups, societies, events, orders, commerce, refunds, orderMoney, commerceMoney] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.organisation.count({ where: { createdAt: { gte: since } } }),
    prisma.event.count({ where: { createdAt: { gte: since }, status: "published" } }),
    prisma.order.count({ where: paid }),
    prisma.commerceOrder.count({ where: paid }),
    prisma.refundRequest.count({ where: { status: "succeeded", createdAt: { gte: since } } }),
    prisma.order.aggregate({ where: paid, _sum: { totalAmount: true, feeAmount: true } }),
    prisma.commerceOrder.aggregate({ where: paid, _sum: { totalAmount: true, feeAmount: true } })
  ]);
  return {
    signups, societies, events, paidOrders: orders + commerce, refunds,
    gross: (orderMoney._sum.totalAmount ?? 0) + (commerceMoney._sum.totalAmount ?? 0),
    fees: (orderMoney._sum.feeAmount ?? 0) + (commerceMoney._sum.feeAmount ?? 0)
  };
}

export async function readCounts(now = new Date()) {
  const [day, week, openDisputes] = await Promise.all([
    countsSince(new Date(now.getTime() - 86_400_000)),
    countsSince(new Date(now.getTime() - 7 * 86_400_000)),
    prisma.purchaseDispute.count({ where: { providerStatus: { in: openDisputeStatuses } } })
  ]);
  return { day, week, openDisputes };
}
