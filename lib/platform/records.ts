import { prisma } from "@/lib/db";
import { readHistory } from "@/lib/audit/history";
import { formatDateTime } from "@/lib/format";
import { accessActions } from "./audit";

// T54: what an operator sees on a user, society or order record. Every select
// is an allow-list: never a password hash, authenticator secret, recovery code,
// token digest, encrypted payload or raw provider payload.

export type ActivitySource = "SUPPORT" | "SOCIETY" | "STRIPE" | "THUNDERSTRUX" | "ACCOUNT" | "CHECKOUT";
export type ActivityRow = { id: string; source: ActivitySource; text: string; detail?: string; at: Date; facts?: unknown };
export type Attention = { tone: "danger" | "warning" | "info"; title: string; body: string };

// How a person reads in the portal: their chosen name, else first and last, else their email.
export const personLabel = (user: { firstName: string | null; lastName: string | null; displayName: string | null; email: string }) =>
  user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
const words = (value: string) => value.replace(/[._]/g, " ");
const newestFirst = (rows: ActivityRow[]) => rows.sort((a, b) => b.at.getTime() - a.at.getTime());

// Support changes about one record; views and searches stay on the Audit page.
async function supportRows(targetType: string, targetId: string): Promise<ActivityRow[]> {
  const rows = await prisma.platformAuditLog.findMany({
    where: { targetType, targetId, action: { notIn: accessActions } },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, action: true, reason: true, metadata: true, createdAt: true, actor: { select: { email: true, firstName: true, lastName: true, displayName: true } } }
  });
  return rows.map((row) => ({ id: row.id, source: "SUPPORT", text: `${row.actor ? personLabel(row.actor) : "The CLI"}: ${words(row.action.replace(/^platform\./, ""))}`,
    detail: row.reason ?? undefined, at: row.createdAt, facts: { action: row.action, ...(row.metadata as object | null ?? {}) } }));
}

export async function readUserRecord(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: {
    id: true, email: true, emailVerifiedAt: true, accountRole: true, authVersion: true, disabledAt: true, closedAt: true,
    createdAt: true, lastSignInAt: true, firstName: true, lastName: true, displayName: true,
    mfa: { select: { enabledAt: true } },
    platformOperator: { select: { role: true, status: true } },
    _count: { select: { mfaRecoveryCodes: true, orders: true, commerceOrders: true, organisationMemberships: true } },
    organisationStaff: { orderBy: { createdAt: "asc" }, select: { role: true, status: true, createdAt: true, organisation: { select: { id: true, name: true } } } },
    securityEvents: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, createdAt: true } }
  } });
  if (!user) return null;
  const [support, society] = await Promise.all([
    supportRows("User", id),
    prisma.auditLog.findMany({
      where: { OR: [{ actorUserId: id }, { targetType: "User", targetId: id }] },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, action: true, createdAt: true, organisation: { select: { name: true } } }
    })
  ]);
  const activity = newestFirst([
    ...support,
    ...society.map((row): ActivityRow => ({ id: row.id, source: "SOCIETY", text: words(row.action), detail: row.organisation.name, at: row.createdAt })),
    ...user.securityEvents.map((row): ActivityRow => ({ id: row.id, source: "ACCOUNT", text: words(row.type), at: row.createdAt }))
  ]).slice(0, 40);
  const attention: Attention[] = [];
  if (user.closedAt) attention.push({ tone: "info", title: "Closed by its owner", body: "Closure is permanent; orders and history stay." });
  else if (user.disabledAt) attention.push({ tone: "danger", title: "Disabled", body: "Can't sign in and holds no society authority." });
  if (!user.closedAt && !user.emailVerifiedAt) attention.push({ tone: "warning", title: "Email not verified", body: "Can sign in, but can't buy, join or accept staff access until it's verified." });
  if (user.mfa?.enabledAt && user._count.mfaRecoveryCodes === 0) attention.push({ tone: "warning", title: "No recovery codes left", body: "If the phone is lost too, they can't verify. The way back is an authenticator reset." });
  return { user, activity, attention };
}

export async function readSocietyRecord(id: string) {
  const society = await prisma.organisation.findUnique({ where: { id }, select: {
    id: true, name: true, slug: true, timeZone: true, supportEmail: true, createdAt: true, accountUserId: true,
    stripeAccountId: true, stripeAccountStatus: true, stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, payoutCheckedAt: true,
    _count: { select: { members: true, events: true } },
    staff: { orderBy: [{ status: "asc" }, { createdAt: "asc" }], select: { role: true, status: true, createdAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, lastSignInAt: true, mfa: { select: { enabledAt: true } } } } } },
    events: { orderBy: { startTime: "desc" }, take: 20, select: { id: true, title: true, status: true, saleState: true, startTime: true, cancelledAt: true } },
    payouts: { orderBy: { createdAt: "desc" }, take: 10, select: { stripePayoutId: true, amount: true, status: true, createdAt: true } },
    purchaseDisputes: { where: { providerStatus: { in: ["needs_response", "warning_needs_response", "appeal_needs_response", "under_review", "warning_under_review", "appeal_under_review"] } },
      orderBy: { evidenceDueBy: "asc" }, take: 10, select: { stripeDisputeId: true, amount: true, providerStatus: true, evidenceDueBy: true, orderId: true, commerceOrderId: true } }
  } });
  if (!society) return null;
  const [history, support] = await Promise.all([readHistory(id, {}, society.timeZone), supportRows("Organisation", id)]);
  const attention: Attention[] = [];
  for (const dispute of society.purchaseDisputes) {
    if (dispute.evidenceDueBy && dispute.providerStatus.endsWith("needs_response")) {
      attention.push({ tone: "warning", title: "Dispute answer due", body: `Due ${formatDateTime(dispute.evidenceDueBy)}, Brisbane time. Answer it in Stripe's Dashboard from the staged draft.` });
    }
  }
  if (!society.staff.some((row) => row.role === "owner" && row.status === "active")) {
    attention.push({ tone: "warning", title: "No active owner", body: "Nobody can hand over ownership or manage staff above admin." });
  }
  return { society, history: history.entries.slice(0, 10), support, attention };
}

const lifecycleSource = (source: string): ActivitySource =>
  source === "checkout" || source === "buyer_action" ? "CHECKOUT" : source === "stripe_webhook" ? "STRIPE" : source === "staff_action" ? "SOCIETY" : "THUNDERSTRUX";

const disputeAttention = (disputes: Array<{ providerStatus: string; evidenceDueBy: Date | null }>): Attention[] =>
  disputes.filter((dispute) => dispute.evidenceDueBy && dispute.providerStatus.endsWith("needs_response")).map((dispute) => ({
    tone: "warning", title: "Dispute answer due",
    body: `Due ${formatDateTime(dispute.evidenceDueBy)}, Brisbane time. A draft answer was staged in Stripe; review it and submit it there. An unanswered dispute is lost.`
  }));

const buyerSelect = { id: true, email: true, firstName: true, lastName: true, displayName: true } as const;
const disputeSelect = { stripeDisputeId: true, amount: true, reason: true, providerStatus: true, evidenceDueBy: true } as const;
const refundSelect = { id: true, status: true, amount: true, stripeRefundId: true, createdAt: true } as const;

// A ticket order or a commerce (membership or merchandise) order, by its id.
export async function readOrderRecord(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, select: {
    id: true, status: true, paymentKind: true, quantity: true, unitPrice: true, totalAmount: true, feeAmount: true, currency: true,
    createdAt: true, paidAt: true, cancelledAt: true, refundStatus: true, disputeStatus: true, requiresCompensationReview: true,
    stripeSessionId: true, stripePaymentIntentId: true, stripeCheckedAt: true, purchasedTicketTypeName: true,
    buyerEmailSnapshot: true, buyerIdentityProvenance: true,
    user: { select: buyerSelect }, guestIdentity: { select: { email: true } },
    event: { select: { id: true, title: true, startTime: true, organisation: { select: { id: true, name: true, timeZone: true } } } },
    tickets: { orderBy: { issueSequence: "asc" }, select: { id: true, issueSequence: true, validity: true, checkedInAt: true } },
    lifecycleEvents: { orderBy: { sequence: "desc" }, take: 40, select: { id: true, type: true, source: true, sequence: true, createdAt: true, reason: true } },
    refundRequests: { orderBy: { createdAt: "desc" }, select: refundSelect },
    disputes: { orderBy: { createdAt: "desc" }, select: disputeSelect }
  } });
  if (order) {
    const activity = newestFirst([
      ...(await supportRows("Order", id)),
      ...order.lifecycleEvents.map((row): ActivityRow => ({ id: row.id, source: lifecycleSource(row.source), text: words(row.type), detail: row.reason ?? undefined, at: row.createdAt,
        facts: { type: row.type, source: row.source, sequence: row.sequence } }))
    ]);
    return { family: "ticket" as const, order, society: order.event.organisation, activity, attention: disputeAttention(order.disputes) };
  }
  const commerce = await prisma.commerceOrder.findUnique({ where: { id }, select: {
    id: true, kind: true, status: true, paymentKind: true, totalAmount: true, feeAmount: true, currency: true,
    createdAt: true, paidAt: true, cancelledAt: true, refundStatus: true, disputeStatus: true,
    stripeSessionId: true, stripePaymentIntentId: true, stripeCheckedAt: true, buyerEmailSnapshot: true, buyerNameSnapshot: true,
    user: { select: buyerSelect }, organisation: { select: { id: true, name: true, timeZone: true } },
    lines: { orderBy: { lineNumber: "asc" }, select: { lineNumber: true, quantity: true, lineAmount: true, nameSnapshot: true } },
    lifecycleEvents: { orderBy: { sequence: "desc" }, take: 40, select: { id: true, type: true, source: true, sequence: true, createdAt: true } },
    refundRequests: { orderBy: { createdAt: "desc" }, select: refundSelect },
    disputes: { orderBy: { createdAt: "desc" }, select: disputeSelect }
  } });
  if (!commerce) return null;
  const activity = newestFirst([
    ...(await supportRows("CommerceOrder", id)),
    ...commerce.lifecycleEvents.map((row): ActivityRow => ({ id: row.id, source: lifecycleSource(row.source), text: words(row.type), at: row.createdAt,
      facts: { type: row.type, source: row.source, sequence: row.sequence } }))
  ]);
  return { family: "commerce" as const, order: commerce, society: commerce.organisation, activity, attention: disputeAttention(commerce.disputes) };
}

// Users are found by search; this short list is for spotting new signups and never pages further.
export function listNewestUsers(limit = 50) {
  return prisma.user.findMany({
    where: { closedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit,
    select: { id: true, email: true, firstName: true, lastName: true, displayName: true, emailVerifiedAt: true, disabledAt: true, createdAt: true }
  });
}

// Societies are few, so they list; 200 at most, by name.
export function listSocieties() {
  return prisma.organisation.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }], take: 200,
    select: { id: true, name: true, slug: true, createdAt: true, stripeChargesEnabled: true, stripePayoutsEnabled: true,
      _count: { select: { events: true, staff: { where: { status: "active" } } } } }
  });
}
