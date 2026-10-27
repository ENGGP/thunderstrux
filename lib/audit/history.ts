import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney, formatPrice, membershipLabel, orderReference } from "@/lib/format";
import { decodeTimestampCursor, encodeTimestampCursor } from "@/lib/pagination/cursor";
import { nextDay, startOfZonedDay, toZonedInput } from "@/lib/zoned-time";

// The society History (T38, design round C2): AuditLog rows of one society,
// newest first, told as sentences with safe facts. Facts come only from the
// fields named below for each action; ids, provider payloads, buyer emails
// and tokens in metadata never reach the page.

export const historyCategories = {
  events: "Events",
  orders: "Orders and refunds",
  memberships: "Memberships",
  merchandise: "Merchandise",
  checkins: "Check-ins",
  staff: "Staff and security",
  payments: "Payments setup",
  profile: "Society profile"
} as const;
export type HistoryCategory = keyof typeof historyCategories;

const prefixes: Record<HistoryCategory, string[]> = {
  events: ["event.", "ticket_type."],
  orders: ["order.", "commerce_order.", "email_outbox.", "notification."],
  memberships: ["membership_plan.", "membership."],
  merchandise: ["merchandise_product.", "merchandise_order."],
  checkins: ["ticket.checked_"],
  staff: ["staff.", "staff_mfa."],
  payments: ["stripe_connect."],
  profile: ["organisation.", "asset."]
};
// Automatic steps Thunderstrux takes; any other row without a person came from Stripe.
// Outcomes Stripe reports (refunds settling, disputes closing) stay Stripe's even when a worker reads them.
const automaticActions = [
  "order.compensation_refund_queued", "order.compensation_refund_review_required", "order.compensation_refund_started", "order.compensation_review_required",
  "commerce_order.compensation_refund_queued", "order.dispute_funds_recovered", "commerce_order.dispute_funds_recovered", "asset.orphan_removed",
  // Without a person: the refund an early fraud warning starts (lib/payments/fraud-warnings.ts).
  "order.refund_requested", "commerce_order.refund_requested"
];

export const historyPageSize = 50;
export class HistoryCursorError extends Error {}

export function categoryOf(action: string): HistoryCategory | null {
  return (Object.keys(prefixes) as HistoryCategory[]).find((category) => prefixes[category].some((prefix) => action.startsWith(prefix))) ?? null;
}


export type HistoryFilters = { category?: HistoryCategory; who?: string; from?: string; to?: string };

function filterWhere(organisationId: string, filters: HistoryFilters, timeZone: string): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ organisationId }];
  // Check-ins only under their own filter, so the door doesn't bury the rest.
  if (filters.category) and.push({ OR: prefixes[filters.category].map((prefix) => ({ action: { startsWith: prefix } })) });
  else and.push({ NOT: { action: { startsWith: prefixes.checkins[0] } } });
  if (filters.who === "thunderstrux") and.push({ actorUserId: null, action: { in: automaticActions } });
  else if (filters.who === "stripe") and.push({ actorUserId: null, action: { notIn: automaticActions } });
  else if (filters.who) and.push({ actorUserId: filters.who });
  if (filters.from) and.push({ createdAt: { gte: startOfZonedDay(filters.from, timeZone) } });
  if (filters.to) and.push({ createdAt: { lt: startOfZonedDay(nextDay(filters.to), timeZone) } });
  return { AND: and };
}

const rowSelect = {
  id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actorUserId: true, actorRole: true,
  actor: { select: { displayName: true, firstName: true, lastName: true, email: true, closedAt: true } }
} satisfies Prisma.AuditLogSelect;
type Row = Prisma.AuditLogGetPayload<{ select: typeof rowSelect }>;

export async function readHistory(organisationId: string, filters: HistoryFilters, timeZone: string, cursor?: string) {
  let after: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    try {
      after = decodeTimestampCursor("createdAt", cursor);
    } catch {
      throw new HistoryCursorError("That page of History is no longer available");
    }
  }
  const where = filterWhere(organisationId, filters, timeZone);
  const rows = await prisma.auditLog.findMany({
    where: after ? { AND: [where, { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: historyPageSize + 1,
    select: rowSelect
  });
  const page = rows.slice(0, historyPageSize);
  const targets = await readTargets(organisationId, page);
  const last = page.at(-1);
  return {
    entries: page.map((row) => describe(row, targets, timeZone)),
    nextCursor: rows.length > historyPageSize && last ? encodeTimestampCursor("createdAt", last) : null
  };
}

// Whether the society has any History at all, for the first-visit state.
export async function hasHistory(organisationId: string) {
  return (await prisma.auditLog.findFirst({ where: { organisationId }, select: { id: true } })) !== null;
}

// People who appear in this society's History, for the Who filter.
export async function historyPeople(organisationId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { organisationId, actorUserId: { not: null } },
    distinct: ["actorUserId"],
    select: { actorUserId: true, actor: { select: { displayName: true, firstName: true, lastName: true, email: true, closedAt: true } } },
    take: 200
  });
  return rows
    .map((row) => ({ id: row.actorUserId!, name: personName(row.actor) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Person = { displayName: string | null; firstName: string | null; lastName: string | null; email: string; closedAt: Date | null } | null;
function personName(person: Person) {
  if (!person || person.closedAt) return "A former staff member";
  return person.displayName || [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email;
}

// Live names for what each row points at, read in one pass per kind and
// always inside this society.
async function readTargets(organisationId: string, rows: Row[]) {
  const ids = (type: string) => [...new Set(rows.filter((row) => row.targetType === type && row.targetId).map((row) => row.targetId!))];
  const meta = (row: Row) => (row.metadata ?? {}) as Record<string, unknown>;
  const eventIds = [...new Set([...ids("Event"), ...rows.flatMap((row) => (typeof meta(row).eventId === "string" ? [meta(row).eventId as string] : []))])];
  const [events, orders, commerce, grants, plans, products, staff, invites, tickets, ticketTypes, assets] = await Promise.all([
    prisma.event.findMany({ where: { organisationId, id: { in: eventIds } }, select: { id: true, title: true } }),
    prisma.order.findMany({ where: { id: { in: ids("Order") }, event: { is: { organisationId } } }, select: { id: true, status: true, event: { select: { id: true, title: true } } } }),
    prisma.commerceOrder.findMany({ where: { organisationId, id: { in: ids("CommerceOrder") } }, select: { id: true, kind: true, lines: { take: 1, orderBy: { lineNumber: "asc" }, select: { nameSnapshot: true, membershipGrant: { select: { id: true } } } } } }),
    prisma.membershipGrant.findMany({ where: { organisationId, id: { in: ids("MembershipGrant") } }, select: { id: true, product: { select: { name: true } }, user: { select: { displayName: true, firstName: true, lastName: true, email: true, closedAt: true } } } }),
    prisma.membershipProduct.findMany({ where: { organisationId, id: { in: ids("MembershipProduct") } }, select: { id: true, name: true } }),
    prisma.merchandiseProduct.findMany({ where: { organisationId, id: { in: ids("MerchandiseProduct") } }, select: { id: true, name: true } }),
    prisma.organisationStaff.findMany({ where: { organisationId, id: { in: ids("OrganisationStaff") } }, select: { id: true, user: { select: { displayName: true, firstName: true, lastName: true, email: true, closedAt: true } } } }),
    prisma.organisationStaffInvite.findMany({ where: { organisationId, id: { in: ids("OrganisationStaffInvite") } }, select: { id: true, email: true } }),
    prisma.ticket.findMany({ where: { organisationId, id: { in: ids("Ticket") } }, select: { id: true, event: { select: { id: true, title: true } } } }),
    prisma.ticketType.findMany({ where: { id: { in: ids("TicketType") }, event: { organisationId } }, select: { id: true, name: true, event: { select: { id: true, title: true } } } }),
    prisma.asset.findMany({ where: { organisationId, id: { in: ids("Asset") } }, select: { id: true, kind: true } })
  ]);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((item) => [item.id, item]));
  return { events: byId(events), orders: byId(orders), commerce: byId(commerce), grants: byId(grants), plans: byId(plans), products: byId(products), staff: byId(staff), invites: byId(invites), tickets: byId(tickets), ticketTypes: byId(ticketTypes), assets: byId(assets) };
}
type Targets = Awaited<ReturnType<typeof readTargets>>;

// A sentence is plain text and links; facts are label and value pairs, with
// an optional "was" value for before and after.
export type Part = string | { text: string; href: string | null };
export type Fact = { label: string; value: string; was?: string };
export type HistoryEntry = {
  id: string;
  at: Date;
  category: HistoryCategory | null;
  actor: { kind: "person" | "former" | "stripe" | "thunderstrux"; name: string; role: string | null; initials: string };
  sentence: Part[];
  facts: Fact[];
  // Recorded before History kept what changed.
  detailUnavailable: boolean;
};

const roleLabels: Record<string, string> = { owner: "Owner", admin: "Admin", event_manager: "Event manager", finance_manager: "Finance manager", check_in_staff: "Check-in staff" };
const statusLabels: Record<string, string> = { active: "Active", revoked: "Removed", invited: "Invited" };
const fieldLabels: Record<string, string> = {
  title: "Title", description: "Description", startTime: "Starts", endTime: "Ends", location: "Location", capacity: "Capacity", salesCloseAt: "Ticket sales close",
  visibility: "Visibility", heroAssetId: "Image", name: "Name", priceAmount: "Price", startsAt: "First day", endsAt: "Last day", entitlements: "Benefits",
  supportEmail: "Contact email", refundPolicy: "Refund policy", pickupPolicy: "Pickup policy", logoAssetId: "Logo", coverAssetId: "Cover image", timeZone: "Time zone"
};
const visibilityLabels: Record<string, string> = { public: "Public", unlisted: "Link only", members_only: "Members only" };
const assetKinds: Record<string, string> = { event: "an event image", logo: "the society logo", cover: "the society cover image", product: "a product photo" };
const reviewReasons: Record<string, string> = {
  sold_out: "Paid after the last ticket sold, so no ticket was issued.",
  capacity: "Paid after the event filled up, so no ticket was issued.",
  sales_closed: "Paid after ticket sales closed, so no ticket was issued."
};

const text = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" ? value : null);
const initialsOf = (name: string) => name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

export function describe(row: Row, targets: Targets, timeZone: string): HistoryEntry {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const when = (iso: unknown) => {
    const value = text(iso);
    if (!value) return "";
    const local = toZonedInput(new Date(value), timeZone);
    const day = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${local.slice(0, 10)}T12:00:00Z`)).replace(",", "");
    const clock = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
    return `${day}, ${clock}`;
  };

  // Who.
  let actor: HistoryEntry["actor"];
  if (row.actorUserId) {
    const name = personName(row.actor);
    actor = { kind: name === "A former staff member" ? "former" : "person", name, role: row.actorRole ? roleLabels[row.actorRole] ?? null : null, initials: initialsOf(name) };
  } else if (automaticActions.includes(row.action)) actor = { kind: "thunderstrux", name: "Thunderstrux", role: null, initials: "T" };
  else actor = { kind: "stripe", name: "Stripe", role: null, initials: "S" };

  // What it points at.
  const event = (id: unknown) => {
    const found = typeof id === "string" ? targets.events.get(id) : undefined;
    return found ? { text: found.title, href: `/dashboard/events/${found.id}` } : { text: text(m.title) ?? "a deleted event", href: null };
  };
  const order = () => {
    const found = row.targetId ? targets.orders.get(row.targetId) : undefined;
    const label = `order ${orderReference(row.targetId ?? "")}`;
    return found
      ? [{ text: label, href: found.status === "pending" ? null : `/dashboard/orders/${found.id}` }, ` for ${found.event.title}`]
      : [label];
  };
  const commerceOrder = () => {
    const found = row.targetId ? targets.commerce.get(row.targetId) : undefined;
    const label = `order ${orderReference(row.targetId ?? "")}`;
    if (!found) return [label];
    const grant = found.lines[0]?.membershipGrant;
    const href = found.kind === "merchandise" ? `/dashboard/merchandise/orders/${found.id}` : grant ? `/dashboard/memberships/members/${grant.id}` : null;
    return [{ text: label, href }, found.kind === "membership" && found.lines[0] ? ` for ${membershipLabel(found.lines[0].nameSnapshot)}` : ""];
  };
  const anyOrder = () => (row.targetType === "CommerceOrder" ? commerceOrder() : order());
  const staffMember = () => {
    const found = row.targetId ? targets.staff.get(row.targetId) : undefined;
    return { text: found ? personName(found.user) : "a staff member", href: "/dashboard/settings/staff" };
  };
  const plan = () => {
    const found = row.targetId ? targets.plans.get(row.targetId) : undefined;
    return { text: found ? membershipLabel(found.name) : "a membership plan", href: found ? `/dashboard/memberships/${found.id}` : null };
  };
  const product = () => {
    const found = row.targetId ? targets.products.get(row.targetId) : undefined;
    return { text: found?.name ?? "a product", href: found ? `/dashboard/merchandise/${found.id}` : null };
  };
  const grant = () => {
    const found = row.targetId ? targets.grants.get(row.targetId) : undefined;
    return found ? [{ text: personName(found.user), href: `/dashboard/memberships/members/${found.id}` }, `'s ${membershipLabel(found.product.name)}`] : ["a membership"];
  };
  const reason = () => (text(m.reason) ? [{ label: "Reason", value: `“${m.reason}”` }] : []);
  const amount = (key = "amount") => (num(m[key]) !== null ? [{ label: "Amount", value: formatMoney(m[key] as number) }] : []);

  let sentence: Part[] = [];
  let facts: Fact[] = [];
  let detailUnavailable = false;
  const a = row.action;
  const verbs: Record<string, string> = { created: "created", updated: "edited", published: "published", archived: "archived", restored: "restored", unpublished: "unpublished" };

  if (a === "event.created") sentence = ["created ", event(row.targetId)];
  else if (a === "event.updated") {
    sentence = ["edited ", event(row.targetId)];
    const changes = Array.isArray(m.changes) ? (m.changes as Array<Record<string, unknown>>) : null;
    if (!changes) detailUnavailable = true;
    else facts = changes.flatMap((change) => eventChangeFact(change, when));
  } else if (a === "event.published" || a === "event.unpublished") sentence = [`${verbs[a.slice(6)]} `, event(row.targetId)];
  else if (a === "event.sales_closed") sentence = ["closed ticket sales for ", event(row.targetId)];
  else if (a === "event.sales_reopened") sentence = ["reopened ticket sales for ", event(row.targetId)];
  else if (a === "event.deleted") sentence = ["deleted the draft ", { text: text(m.title) ?? "event", href: null }];
  else if (a === "event.cancelled") {
    sentence = ["cancelled ", event(row.targetId)];
    const skipped = Array.isArray(m.skipped) ? m.skipped.length : 0;
    facts = [
      ...(text(m.reason) ? [{ label: "Message", value: text(m.reason) as string }] : []),
      { label: "Refunds started", value: String(m.refundsQueued ?? 0) },
      { label: "Free registrations cancelled", value: String(m.freeCancelled ?? 0) },
      ...(skipped ? [{ label: "Orders to settle in Orders", value: String(skipped) }] : [])
    ];
  }
  else if (a === "ticket_type.created") {
    const found = row.targetId ? targets.ticketTypes.get(row.targetId) : undefined;
    sentence = ["added a ticket type to ", event(found?.event.id ?? m.eventId)];
    if (found) facts = [{ label: "Ticket type", value: found.name }];
  } else if (a === "ticket.checked_in" || a === "ticket.checked_out") {
    const found = row.targetId ? targets.tickets.get(row.targetId) : undefined;
    sentence = [a.endsWith("in") ? "checked in a ticket for " : "checked out a ticket for ", event(found?.event.id)];
    facts = [{ label: "Ticket", value: orderReference(row.targetId ?? "") }];
  } else if (a === "order.refund_requested" || a === "commerce_order.refund_requested") {
    sentence = ["refunded ", ...anyOrder()];
    facts = [...amount(), ...reason()];
  } else if (/^(order|commerce_order)\.refund_(succeeded|pending|failed|canceled)$/.test(a)) {
    const state = a.split("refund_")[1];
    sentence = [state === "succeeded" ? "confirmed the refund of " : state === "pending" ? "is still processing the refund of " : state === "canceled" ? "cancelled the refund of " : "couldn't complete the refund of ", ...anyOrder()];
  } else if (a === "order.manual_refund_marked") sentence = ["marked ", ...order(), " as refunded outside Thunderstrux"];
  else if (a === "order.external_refund_recorded" || a === "commerce_order.external_refund_recorded") {
    sentence = ["reported a refund made in the Stripe dashboard for ", ...anyOrder()];
    if (num(m.refundedOutside) !== null) facts = [{ label: "Refunded", value: formatMoney(m.refundedOutside as number), was: num(m.totalAmount) !== null ? `${formatMoney(m.totalAmount as number)} paid` : undefined }];
  } else if (a === "order.external_refund_reviewed" || a === "commerce_order.external_refund_reviewed") sentence = ["reviewed the refund made in Stripe for ", ...anyOrder()];
  else if (a === "order.dispute_opened" || a === "commerce_order.dispute_opened") {
    sentence = ["opened a dispute on ", ...anyOrder()];
    facts = amount();
  } else if (a === "order.dispute_resolved") {
    sentence = ["restored the tickets on ", ...order(), " after its dispute"];
    facts = [...reason(), ...(num(m.ticketCount) !== null ? [{ label: "Tickets", value: `${m.ticketCount} valid again` }] : [])];
  } else if (a === "order.dispute_funds_recovered" || a === "commerce_order.dispute_funds_recovered") {
    // PAY-004: a lost dispute's money taken back from the society's Stripe balance.
    sentence = ["took back the lost dispute's money for ", ...anyOrder(), " from the society's Stripe balance"];
    facts = amount();
  } else if (/^(order|commerce_order)\.dispute_/.test(a)) sentence = [`closed the dispute on `, ...anyOrder(), `: ${a.split(".dispute_")[1].replaceAll("_", " ")}`];
  else if (a === "order.free_cancelled" || a === "merchandise_order.free_cancelled") {
    sentence = ["cancelled the free ", ...anyOrder()];
    facts = [...reason(), ...(num(m.ticketCount) !== null ? [{ label: "Tickets", value: `${m.ticketCount} no longer valid` }] : [])];
  } else if (a === "order.guest_claimed") sentence = ["moved their guest ", ...order(), " into their account"];
  else if (a === "order.ticket_email_queued") sentence = ["sent the tickets email for ", ...order(), " again"];
  else if (a === "email_outbox.requeued") {
    sentence = ["retried the tickets email for ", ...(typeof m.orderId === "string" ? [{ text: `order ${orderReference(m.orderId)}`, href: `/dashboard/orders/${m.orderId}` }] : ["an order"])];
    facts = reason();
  } else if (a === "notification.requeued") sentence = ["retried an email notice"];
  else if (a === "order.compensation_refund_queued" || a === "commerce_order.compensation_refund_queued") sentence = ["queued an automatic refund for ", ...anyOrder()];
  else if (a === "order.compensation_refund_review_required") {
    sentence = ["put ", ...order(), " in payment review"];
    facts = [{ label: "Why", value: `${reviewReasons[text(m.reason) ?? ""] ?? "Paid, but what they bought couldn't be issued."} Decide on it in Orders.` }];
  } else if (a === "order.compensation_refund_started") sentence = ["started the automatic refund of ", ...order()];
  else if (a === "order.compensation_refund_confirmed") sentence = ["confirmed the refund of ", ...order(), " in payment review"];
  else if (a.startsWith("order.compensation_")) sentence = [a.endsWith("refunded") ? "confirmed the automatic refund of " : "reports a problem with the automatic refund of ", ...order()];
  else if (a.startsWith("membership_plan.")) {
    sentence = [`${verbs[a.slice(16)] ?? "changed"} the membership plan `, plan()];
    if (Array.isArray(m.changedFields) && m.changedFields.length) facts = [{ label: "Changed", value: (m.changedFields as string[]).map((field) => (fieldLabels[field] ?? field).toLowerCase()).join(", ") }];
  } else if (a === "membership.revoked") {
    sentence = ["ended ", ...grant(), " early"];
    facts = reason();
  } else if (a === "membership.free_cancelled") {
    sentence = ["cancelled ", ...grant()];
    facts = reason();
  } else if (a.startsWith("merchandise_product.")) {
    sentence = [`${verbs[a.slice(20)] ?? "changed"} `, product()];
    const stock = Array.isArray(m.stock) ? (m.stock as Array<Record<string, unknown>>) : [];
    facts = stock.map((option) => ({ label: `Stock, ${text(option.option) ?? "option"}`, value: String(option.after ?? ""), was: option.before === undefined || option.before === null ? undefined : String(option.before) }));
  } else if (a === "merchandise_order.ready") sentence = ["marked ", ...commerceOrder(), " ready to collect"];
  else if (a === "merchandise_order.collected") sentence = ["handed over ", ...commerceOrder()];
  else if (a === "merchandise_order.return_recorded") {
    sentence = ["recorded a return on ", ...commerceOrder()];
    facts = [...(num(m.quantity) !== null ? [{ label: "Items", value: String(m.quantity) }] : []), ...(typeof m.restocked === "boolean" ? [{ label: "Back in stock", value: m.restocked ? "Yes" : "No" }] : [])];
  } else if (a === "staff.updated") {
    const removed = m.nextStatus === "revoked" && m.previousStatus !== "revoked";
    sentence = removed ? ["removed ", staffMember(), " from the staff"] : ["changed ", staffMember(), "'s access"];
    if (m.previousRole !== m.nextRole) facts.push({ label: "Role", value: roleLabels[String(m.nextRole)] ?? "", was: roleLabels[String(m.previousRole)] });
    if (m.previousStatus !== m.nextStatus && !removed) facts.push({ label: "Access", value: statusLabels[String(m.nextStatus)] ?? "", was: statusLabels[String(m.previousStatus)] });
  } else if (a === "staff.ownership.handed_over") sentence = ["handed ownership to ", staffMember()];
  else if (a.startsWith("staff.invite.")) {
    const invite = row.targetId ? targets.invites.get(row.targetId) : undefined;
    const who = invite?.email ?? "someone";
    const step = a.slice(13);
    sentence = step === "accepted" ? ["accepted their staff invitation"] : [step === "created" ? "invited " : step === "resent" ? "sent the invitation again to " : "withdrew the invitation to ", who];
    if (text(m.role)) facts = [{ label: "Role", value: roleLabels[String(m.role)] ?? "" }];
  } else if (a === "staff_mfa.enabled") sentence = ["turned on their authenticator app"];
  else if (a === "staff_mfa.verified") sentence = ["signed in with their authenticator app"];
  else if (a === "staff_mfa.recovery_used") sentence = ["signed in with a recovery code"];
  else if (a === "stripe_connect.account_created") sentence = ["started connecting a Stripe account"];
  else if (a === "stripe_connect.disconnected") sentence = ["disconnected the Stripe account"];
  else if (a === "stripe_connect.dashboard_opened") sentence = ["opened the Stripe dashboard"];
  else if (a === "organisation.created") sentence = ["set up the society"];
  else if (a === "organisation.profile_updated") {
    sentence = ["updated the society profile"];
    if (Array.isArray(m.changedFields) && m.changedFields.length) facts = [{ label: "Changed", value: (m.changedFields as string[]).map((field) => (fieldLabels[field] ?? field).toLowerCase()).join(", ") }];
  } else if (a === "asset.uploaded") sentence = [`uploaded ${assetKinds[text(m.kind) ?? ""] ?? "an image"}`];
  else if (a === "asset.deleted") sentence = [`removed ${assetKinds[text(m.kind) ?? ""] ?? "an image"}`];
  else if (a === "asset.orphan_removed") sentence = ["removed an unused image"];
  else sentence = [`recorded “${a.replace(/[._]/g, " ")}”`];

  return { id: row.id, at: row.createdAt, category: categoryOf(a), actor, sentence, facts, detailUnavailable };
}

function eventChangeFact(change: Record<string, unknown>, when: (iso: unknown) => string): Fact[] {
  const field = text(change.field) ?? "";
  if (field === "ticketTypes") {
    const added = Array.isArray(change.added) ? (change.added as string[]) : [];
    const removed = Array.isArray(change.removed) ? (change.removed as string[]) : [];
    const edited = Array.isArray(change.changed) ? (change.changed as Array<Record<string, unknown>>) : [];
    return [
      ...added.map((name) => ({ label: "Ticket type added", value: name })),
      ...removed.map((name) => ({ label: "Ticket type removed", value: name })),
      ...edited.flatMap((type) => [
        ...(type.price ? [{ label: `${type.name}, price`, value: formatPrice((type.price as number[])[1]), was: formatPrice((type.price as number[])[0]) }] : []),
        ...(type.quantity ? [{ label: `${type.name}, left`, value: String((type.quantity as number[])[1]), was: String((type.quantity as number[])[0]) }] : []),
        ...(type.renamedFrom ? [{ label: "Ticket type renamed", value: String(type.name), was: String(type.renamedFrom) }] : [])
      ])
    ];
  }
  if (field === "description") return [{ label: "Description", value: "Changed" }];
  if (field === "heroAssetId") return [{ label: "Image", value: change.after ? "Changed" : "Removed" }];
  const show = (value: unknown) =>
    value === null || value === undefined ? "None" : field === "visibility" ? visibilityLabels[String(value)] ?? String(value) : ["startTime", "endTime", "salesCloseAt"].includes(field) ? when(value) : String(value);
  return [{ label: fieldLabels[field] ?? field, value: show(change.after), was: show(change.before) }];
}
