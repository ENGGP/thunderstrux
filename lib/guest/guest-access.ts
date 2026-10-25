import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNotificationConfiguration } from "@/lib/email/notification-crypto";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { safeReturnPath } from "@/lib/security/safe-return-path";
import { appUrl } from "@/lib/app-url";
import { appCookieSecure } from "@/lib/auth/public-origin";

// Verified guest access (T16a). An emailed link proves the address; redeeming
// it by POST starts a short browser session. Raw link tokens and session ids
// exist only in the email and the cookie; the database keeps their digests.

export const guestCookieName = "thunderstrux-guest";
const linkLifetimeMs = 30 * 60 * 1000;
// Purchase links (ticket email and recovery) open one order for a day.
const purchaseLinkLifetimeMs = 24 * 60 * 60 * 1000;
export const guestSessionLifetimeMs = 2 * 60 * 60 * 1000;
const rawPattern = /^[A-Za-z0-9_-]{43}$/;

export class GuestAccessError extends Error {
  constructor(message = "This link is invalid or expired. Request a new link.") { super(message); }
}
export const guestSessionEndedMessage = "Your guest session has ended. Confirm your email again.";

export const guestDigest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");

export function guestCookieOptions(expires: Date) {
  return { httpOnly: true, secure: appCookieSecure(), sameSite: "lax" as const, path: "/", expires };
}

async function revokeOpenGrants(tx: Prisma.TransactionClient, guestIdentityId: string, now: Date) {
  const where = { guestIdentityId, purpose: "checkout", consumedAt: null, revokedAt: null };
  const open = await tx.guestAccessGrant.findMany({ where, select: { id: true } });
  await tx.guestAccessGrant.updateMany({ where, data: { revokedAt: now } });
  await tx.notificationOutbox.updateMany({
    where: { guestAccessGrantId: { in: open.map((grant) => grant.id) }, status: { in: ["pending", "processing"] } },
    data: { status: "cancelled", lastError: "superseded", processingToken: null, processingStartedAt: null }
  });
}

// Always the same outcome for the caller, whatever the address; only a newer
// link replaces an unused one.
export async function requestGuestAccess(email: string, callbackUrl?: string, now = new Date()) {
  assertNotificationConfiguration();
  const address = email.trim().toLowerCase();
  const raw = newSecret();
  await prisma.$transaction(async (tx) => {
    const identity = await tx.guestIdentity.upsert({ where: { email: address }, create: { email: address }, update: {} });
    await tx.$queryRaw`SELECT "id" FROM "GuestIdentity" WHERE "id" = ${identity.id} FOR UPDATE`;
    await revokeOpenGrants(tx, identity.id, now);
    const grant = await tx.guestAccessGrant.create({ data: {
      guestIdentityId: identity.id, purpose: "checkout", tokenDigest: guestDigest(raw),
      callbackPath: safeReturnPath(callbackUrl, "/events"), expiresAt: new Date(now.getTime() + linkLifetimeMs)
    } });
    const link = new URL("/guest/access", appUrl());
    link.hash = new URLSearchParams({ token: raw }).toString();
    await enqueueNotification(tx, {
      eventKey: `guest/${grant.id}`, guestAccessGrantId: grant.id, recipient: address, template: "guest_access", expiresAt: grant.expiresAt,
      payload: { message: "Confirm your email to carry on with your Thunderstrux order. This link works once and stops working after 30 minutes.", link: link.toString() }
    });
  });
}

// Single use: the identity row is locked and the grant consumed with a guarded
// update, so two redemptions of one link cannot both start a session.
export async function redeemGuestAccess(raw: string, now = new Date()) {
  if (!rawPattern.test(raw)) throw new GuestAccessError();
  const digest = guestDigest(raw);
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.guestAccessGrant.findUnique({ where: { tokenDigest: digest }, select: { guestIdentityId: true } });
    if (!candidate) throw new GuestAccessError();
    await tx.$queryRaw`SELECT "id" FROM "GuestIdentity" WHERE "id" = ${candidate.guestIdentityId} FOR UPDATE`;
    const grant = await tx.guestAccessGrant.findUnique({ where: { tokenDigest: digest } });
    if (!grant || !["checkout", "purchase"].includes(grant.purpose) || grant.consumedAt || grant.revokedAt || grant.expiresAt <= now) throw new GuestAccessError();
    const sessionId = newSecret();
    const sessionExpiresAt = new Date(now.getTime() + guestSessionLifetimeMs);
    const consumed = await tx.guestAccessGrant.updateMany({
      where: { id: grant.id, consumedAt: null, revokedAt: null },
      data: { consumedAt: now, sessionDigest: guestDigest(sessionId), sessionExpiresAt }
    });
    if (consumed.count !== 1) throw new GuestAccessError();
    await tx.guestIdentity.updateMany({ where: { id: grant.guestIdentityId, verifiedAt: null }, data: { verifiedAt: now } });
    await tx.notificationOutbox.updateMany({
      where: { guestAccessGrantId: grant.id, status: { in: ["pending", "processing"] } },
      data: { status: "cancelled", lastError: "consumed", processingToken: null }
    });
    const callbackUrl = grant.orderId ? `/guest/orders/${grant.orderId}`
      : grant.commerceOrderId ? `/merchandise/orders/${grant.commerceOrderId}`
      : safeReturnPath(grant.callbackPath, "/events");
    return { sessionId, sessionExpiresAt, callbackUrl };
  });
}

// The live guest session for a cookie value, or null when missing, unknown,
// expired or revoked.
export async function readGuestSession(sessionId: string | undefined, now = new Date()) {
  if (!sessionId || !rawPattern.test(sessionId)) return null;
  const grant = await prisma.guestAccessGrant.findUnique({
    where: { sessionDigest: guestDigest(sessionId) },
    include: { guestIdentity: { select: { id: true, email: true, verifiedAt: true } } }
  });
  if (!grant?.sessionExpiresAt || grant.sessionExpiresAt <= now || grant.revokedAt || !grant.guestIdentity.verifiedAt) return null;
  return {
    grantId: grant.id, guestIdentityId: grant.guestIdentity.id, email: grant.guestIdentity.email, expiresAt: grant.sessionExpiresAt,
    purpose: grant.purpose, orderId: grant.orderId, commerceOrderId: grant.commerceOrderId
  };
}

export type GuestSession = NonNullable<Awaited<ReturnType<typeof readGuestSession>>>;

// A guest session opens one order: the order its purchase link names, or an
// order bought during this checkout session. Nothing else, whatever the email.
export async function canOpenGuestOrder(session: GuestSession, orderId: string) {
  if (session.purpose === "purchase") return session.orderId === orderId;
  return Boolean(await prisma.checkoutAttempt.findFirst({ where: { actorKind: "guest", actorId: session.grantId, orderId }, select: { id: true } }));
}

// The same rule for a merchandise order (T27b): the one its purchase link
// names, or one bought during this checkout session.
export async function canOpenGuestCommerceOrder(session: GuestSession, commerceOrderId: string) {
  if (session.purpose === "purchase") return session.commerceOrderId === commerceOrderId;
  return Boolean(await prisma.checkoutAttempt.findFirst({ where: { actorKind: "guest", actorId: session.grantId, commerceOrderId }, select: { id: true } }));
}

function orderLink(raw: string) {
  const link = new URL("/guest/access", appUrl());
  link.hash = new URLSearchParams({ token: raw }).toString();
  return link.toString();
}

type PurchaseTarget = { orderId: string } | { commerceOrderId: string };

// A purchase link opening one ticket or merchandise order for a day. Only its
// digest is stored.
export async function mintPurchaseLink(tx: Prisma.TransactionClient, guestIdentityId: string, target: PurchaseTarget, now = new Date()) {
  const raw = newSecret();
  const grant = await tx.guestAccessGrant.create({ data: {
    guestIdentityId, purpose: "purchase", ...target, tokenDigest: guestDigest(raw), expiresAt: new Date(now.getTime() + purchaseLinkLifetimeMs)
  } });
  return { grant, link: orderLink(raw) };
}

// The link in a guest's ticket email, minted on each send attempt: a retry
// sends a new, equally valid link. No secret is needed, so the email worker
// can mint it.
export async function purchaseLinkForEmail(orderId: string, guestIdentityId: string, now = new Date()) {
  return (await mintPurchaseLink(prisma, guestIdentityId, { orderId }, now)).link;
}

// Find your purchase: a fresh link per paid guest ticket or merchandise order,
// sent to the address only. The caller always gets the same answer.
export async function requestGuestRecovery(email: string, now = new Date()) {
  assertNotificationConfiguration();
  const identity = await prisma.guestIdentity.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!identity) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "GuestIdentity" WHERE "id" = ${identity.id} FOR UPDATE`;
    const orders = await tx.order.findMany({
      where: { guestIdentityId: identity.id, userId: null, status: "paid" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, event: { select: { title: true } } }
    });
    const merchandise = await tx.commerceOrder.findMany({
      where: { guestIdentityId: identity.id, userId: null, kind: "merchandise", status: "paid" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, sellerName: true }
    });
    const purchases: Array<{ target: PurchaseTarget; what: string }> = [
      ...orders.map((order) => ({ target: { orderId: order.id }, what: `your order for ${order.event.title}` })),
      ...merchandise.map((order) => ({ target: { commerceOrderId: order.id }, what: `your merchandise order from ${order.sellerName}` }))
    ];
    for (const { target, what } of purchases) {
      const open = { ...target, purpose: "purchase", consumedAt: null, revokedAt: null };
      const older = await tx.guestAccessGrant.findMany({ where: open, select: { id: true } });
      await tx.guestAccessGrant.updateMany({ where: open, data: { revokedAt: now } });
      await tx.notificationOutbox.updateMany({
        where: { guestAccessGrantId: { in: older.map((grant) => grant.id) }, status: { in: ["pending", "processing"] } },
        data: { status: "cancelled", lastError: "superseded", processingToken: null, processingStartedAt: null }
      });
      const { grant, link } = await mintPurchaseLink(tx, identity.id, target, now);
      await enqueueNotification(tx, {
        eventKey: `guest/${grant.id}`, guestAccessGrantId: grant.id, recipient: email.trim().toLowerCase(), template: "guest_order_link", expiresAt: grant.expiresAt,
        payload: { message: `Open ${what}. This link works once and stops working after 24 hours.`, link }
      });
    }
  });
}

// The buyer for a guest checkout, under the GuestIdentity lock: the session
// must still be a live checkout session of a verified address.
export async function lockGuestBuyer(tx: Prisma.TransactionClient, grantId: string, now: Date) {
  const candidate = await tx.guestAccessGrant.findUnique({ where: { id: grantId }, select: { guestIdentityId: true } });
  if (!candidate) throw new GuestAccessError(guestSessionEndedMessage);
  await tx.$queryRaw`SELECT "id" FROM "GuestIdentity" WHERE "id" = ${candidate.guestIdentityId} FOR UPDATE`;
  const grant = await tx.guestAccessGrant.findUnique({ where: { id: grantId }, include: { guestIdentity: true } });
  if (!grant || grant.purpose !== "checkout" || grant.revokedAt || !grant.sessionExpiresAt || grant.sessionExpiresAt <= now || !grant.guestIdentity.verifiedAt) {
    throw new GuestAccessError(guestSessionEndedMessage);
  }
  return { email: grant.guestIdentity.email, firstName: null, lastName: null, displayName: null };
}

export function guestSessionIdFrom(request: Request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === guestCookieName) return value.join("=");
  }
  return undefined;
}
