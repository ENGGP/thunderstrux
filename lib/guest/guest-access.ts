import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { authSecret } from "@/auth";
import { prisma } from "@/lib/db";
import { assertNotificationConfiguration } from "@/lib/email/notification-crypto";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { safeReturnPath } from "@/lib/security/safe-return-path";

// Verified guest access (T16a). An emailed link proves the address; redeeming
// it by POST starts a short browser session. Raw link tokens and session ids
// exist only in the email and the cookie; the database keeps their digests.

export const guestCookieName = "thunderstrux-guest";
export const GUEST_CSRF_HEADER = "x-thunderstrux-guest-csrf";
const linkLifetimeMs = 30 * 60 * 1000;
export const guestSessionLifetimeMs = 2 * 60 * 60 * 1000;
const rawPattern = /^[A-Za-z0-9_-]{43}$/;

export class GuestAccessError extends Error {
  constructor() { super("This link is invalid or expired. Request a new link."); }
}

export const guestDigest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");

export function guestCookieOptions(expires: Date) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", expires };
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
    const link = new URL("/guest/access", process.env.NEXT_PUBLIC_APP_URL);
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
    if (!grant || grant.purpose !== "checkout" || grant.consumedAt || grant.revokedAt || grant.expiresAt <= now) throw new GuestAccessError();
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
    return { sessionId, sessionExpiresAt, callbackUrl: safeReturnPath(grant.callbackPath, "/events") };
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
  return { grantId: grant.id, guestIdentityId: grant.guestIdentity.id, email: grant.guestIdentity.email, expiresAt: grant.sessionExpiresAt };
}

// The guest session's own CSRF token, bound to the session id (not the login cookie).
export function guestCsrfToken(sessionId: string) {
  return createHmac("sha256", authSecret).update(`guest-csrf:v1:${sessionId}`).digest("hex");
}

export function verifyGuestCsrf(sessionId: string, supplied: string | null) {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(guestCsrfToken(sessionId), "hex"));
}

export function guestSessionIdFrom(request: Request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === guestCookieName) return value.join("=");
  }
  return undefined;
}
