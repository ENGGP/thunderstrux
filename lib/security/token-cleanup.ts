import { prisma } from "@/lib/db";
import { accessActions, accessRetentionMs } from "@/lib/platform/audit";

// T39: sign-in, reset, verification and guest tokens and staff MFA grants
// are deleted a while after they stop working, a bounded batch per run, so the
// tables don't grow without end. Rows that point at them are set to null.
// SEC-043: finished notifications go the same way, as each holds its recipient in
// plain text. A key dedupes only while its row exists, and every producer has its
// own guard or a window shorter than this (Retention in Email Delivery Implementation).
export const tokenRetentionMs = 30 * 24 * 60 * 60 * 1000;

// The one exception: only this row stops `stripe-deadline/{org}/{time}` announcing a
// deadline again, and Stripe can set one further off than the retention period.
// shortcut: a kept row still fills a batch slot, so 500 of them would stall deletion; filter in SQL if that ever happens.
const deadlineStillStands = (eventKey: string, before: Date) =>
  eventKey.startsWith("stripe-deadline/") && !(new Date(eventKey.split("/")[2]) < before);

export async function cleanUpExpiredTokens(now = new Date(), batch = 500) {
  const before = new Date(now.getTime() - tokenRetentionMs);
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);
  const finished = { status: { in: ["sent", "cancelled", "failed"] }, updatedAt: { lt: before } };
  // T54: an operator's views and searches are kept two years (Q8); the trigger lets only those go.
  const accessBefore = new Date(now.getTime() - accessRetentionMs);
  const oldAccess = { action: { in: accessActions }, createdAt: { lt: accessBefore } };
  const [authTokens, guestGrants, mfaGrants, notifications, access] = await Promise.all([
    // #34: oldest first, so a backlog clears in order rather than in whatever order the index returns.
    prisma.authToken.findMany({ where: { expiresAt: { lt: before } }, select: { id: true }, take: batch, orderBy: { expiresAt: "asc" } }),
    prisma.guestAccessGrant.findMany({
      where: { expiresAt: { lt: before }, OR: [{ sessionExpiresAt: null }, { sessionExpiresAt: { lt: before } }] },
      select: { id: true },
      take: batch
    }),
    prisma.mfaGrant.findMany({ where: { expiresAt: { lt: before } }, select: { sessionDigest: true }, take: batch, orderBy: { expiresAt: "asc" } }),
    prisma.notificationOutbox.findMany({ where: finished, select: { id: true, eventKey: true }, take: batch }),
    prisma.platformAuditLog.findMany({ where: oldAccess, select: { id: true }, take: batch })
  ]);
  const [auth, guest, mfa, sent, viewed] = await Promise.all([
    prisma.authToken.deleteMany({ where: { id: { in: ids(authTokens) }, expiresAt: { lt: before } } }),
    prisma.guestAccessGrant.deleteMany({ where: { id: { in: ids(guestGrants) }, expiresAt: { lt: before } } }),
    prisma.mfaGrant.deleteMany({ where: { sessionDigest: { in: mfaGrants.map((grant) => grant.sessionDigest) }, expiresAt: { lt: before } } }),
    prisma.notificationOutbox.deleteMany({ where: { id: { in: ids(notifications.filter((row) => !deadlineStillStands(row.eventKey, before))) }, ...finished } }),
    prisma.platformAuditLog.deleteMany({ where: { id: { in: ids(access) }, ...oldAccess } })
  ]);
  return { authTokens: auth.count, guestAccessGrants: guest.count, mfaGrants: mfa.count, notifications: sent.count, platformAccessRows: viewed.count };
}
