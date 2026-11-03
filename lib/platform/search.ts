import { prisma } from "@/lib/db";
import { orderReference } from "@/lib/format";
import { personLabel } from "./records";

// T54: the omnibox. Developers paste whatever they have (an email from a
// support message, an id from a log line, a Stripe id from the Dashboard), so
// the shape of the text decides where to look. Search, never browse: each
// group is capped, and every search is logged as a digest (./audit.ts).

export type SearchHit = { kind: "User" | "Society" | "Order" | "Membership order" | "Merchandise order" | "Event"; id: string; label: string; detail: string; href: string };

const cap = 20;
const userHref = (id: string) => `/admin/users/${id}`;
const societyHref = (id: string) => `/admin/societies/${id}`;
const orderHref = (id: string) => `/admin/orders/${id}`;
const commerceKind = (kind: string): SearchHit["kind"] => (kind === "membership" ? "Membership order" : "Merchandise order");

const orderHit = (order: { id: string; status: string; event: { title: string; organisation: { name: string } } }): SearchHit =>
  ({ kind: "Order", id: order.id, label: `${orderReference(order.id)} · ${order.event.title}`, detail: `${order.event.organisation.name} · ${order.status}`, href: orderHref(order.id) });
const commerceHit = (order: { id: string; kind: string; status: string; organisation: { name: string } }): SearchHit =>
  ({ kind: commerceKind(order.kind), id: order.id, label: orderReference(order.id), detail: `${order.organisation.name} · ${order.status}`, href: orderHref(order.id) });
const orderSelect = { id: true, status: true, event: { select: { title: true, organisation: { select: { name: true } } } } } as const;
const commerceSelect = { id: true, kind: true, status: true, organisation: { select: { name: true } } } as const;
const userSelect = { id: true, email: true, firstName: true, lastName: true, displayName: true } as const;
const userHit = (user: { id: string; email: string; firstName: string | null; lastName: string | null; displayName: string | null }): SearchHit =>
  ({ kind: "User", id: user.id, label: personLabel(user), detail: user.email, href: userHref(user.id) });

async function byPayment(field: "stripeSessionId" | "stripePaymentIntentId", value: string) {
  const [orders, commerce] = await Promise.all([
    prisma.order.findMany({ where: { [field]: value }, select: orderSelect, take: cap }),
    prisma.commerceOrder.findMany({ where: { [field]: value }, select: commerceSelect, take: cap })
  ]);
  return [...orders.map(orderHit), ...commerce.map(commerceHit)];
}

// Order, refund or dispute rows point at a ticket order or a commerce order.
async function byOrderLink(rows: Array<{ orderId: string | null; commerceOrderId: string | null }>) {
  const [orders, commerce] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: rows.flatMap((row) => row.orderId ?? []) } }, select: orderSelect }),
    prisma.commerceOrder.findMany({ where: { id: { in: rows.flatMap((row) => row.commerceOrderId ?? []) } }, select: commerceSelect })
  ]);
  return [...orders.map(orderHit), ...commerce.map(commerceHit)];
}

export async function searchPlatform(raw: string): Promise<SearchHit[]> {
  const query = raw.trim();
  if (query.length < 2 || query.length > 200) return [];
  if (query.includes("@")) {
    const user = await prisma.user.findUnique({ where: { email: query.toLowerCase() }, select: userSelect });
    return user ? [userHit(user)] : [];
  }
  if (/^cs_/.test(query)) return byPayment("stripeSessionId", query);
  if (/^pi_/.test(query)) return byPayment("stripePaymentIntentId", query);
  if (/^acct_/.test(query)) {
    const society = await prisma.organisation.findUnique({ where: { stripeAccountId: query }, select: { id: true, name: true, slug: true } });
    return society ? [{ kind: "Society", id: society.id, label: society.name, detail: society.slug, href: societyHref(society.id) }] : [];
  }
  if (/^re_/.test(query)) return byOrderLink(await prisma.refundRequest.findMany({ where: { stripeRefundId: query }, select: { orderId: true, commerceOrderId: true } }));
  if (/^(du|dp)_/.test(query)) return byOrderLink(await prisma.purchaseDispute.findMany({ where: { stripeDisputeId: query }, select: { orderId: true, commerceOrderId: true } }));
  if (/^po_/.test(query)) {
    const payout = await prisma.societyPayout.findUnique({ where: { stripePayoutId: query }, select: { organisation: { select: { id: true, name: true, slug: true } } } });
    return payout ? [{ kind: "Society", id: payout.organisation.id, label: payout.organisation.name, detail: payout.organisation.slug, href: societyHref(payout.organisation.id) }] : [];
  }
  // An app id (cuid): it could be any record.
  if (/^c[a-z0-9]{20,30}$/.test(query)) {
    const [user, society, event, order, commerce] = await Promise.all([
      prisma.user.findUnique({ where: { id: query }, select: userSelect }),
      prisma.organisation.findUnique({ where: { id: query }, select: { id: true, name: true, slug: true } }),
      prisma.event.findUnique({ where: { id: query }, select: { id: true, title: true, organisation: { select: { id: true, name: true } } } }),
      prisma.order.findUnique({ where: { id: query }, select: orderSelect }),
      prisma.commerceOrder.findUnique({ where: { id: query }, select: commerceSelect })
    ]);
    return [
      ...(user ? [userHit(user)] : []),
      ...(society ? [{ kind: "Society" as const, id: society.id, label: society.name, detail: society.slug, href: societyHref(society.id) }] : []),
      ...(event ? [{ kind: "Event" as const, id: event.id, label: event.title, detail: event.organisation.name, href: societyHref(event.organisation.id) }] : []),
      ...(order ? [orderHit(order)] : []),
      ...(commerce ? [commerceHit(commerce)] : [])
    ];
  }
  // An order reference: the last six characters of an id, as buyers and staff see it.
  // No index serves it, so a word without a digit tries names first.
  const reference = /^[A-Za-z0-9]{6}$/.test(query);
  if (reference && /\d/.test(query)) {
    const hits = await byReference(query);
    if (hits.length) return hits;
  }
  const [users, societies] = await Promise.all([
    prisma.user.findMany({
      where: { closedAt: null, OR: ["firstName", "lastName", "displayName"].map((field) => ({ [field]: { startsWith: query, mode: "insensitive" as const } })) },
      orderBy: [{ firstName: "asc" }, { id: "asc" }], select: userSelect, take: cap
    }),
    prisma.organisation.findMany({
      where: { OR: [{ name: { contains: query, mode: "insensitive" } }, { slug: { startsWith: query.toLowerCase() } }] },
      orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, slug: true }, take: cap
    })
  ]);
  const named = [
    ...users.map(userHit),
    ...societies.map((society) => ({ kind: "Society" as const, id: society.id, label: society.name, detail: society.slug, href: societyHref(society.id) }))
  ];
  return named.length || !reference || /\d/.test(query) ? named : byReference(query);
}

async function byReference(query: string) {
  const suffix = query.toLowerCase();
  const [orders, commerce] = await Promise.all([
    prisma.order.findMany({ where: { id: { endsWith: suffix } }, select: orderSelect, take: cap }),
    prisma.commerceOrder.findMany({ where: { id: { endsWith: suffix } }, select: commerceSelect, take: cap })
  ]);
  return [...orders.map(orderHit), ...commerce.map(commerceHit)];
}
