import { prisma } from "@/lib/db";

// T39: sign-in, reset, verification and guest tokens and staff MFA grants
// are deleted a while after they stop working, a bounded batch per run, so the
// tables don't grow without end. Rows that point at them are set to null.
export const tokenRetentionMs = 30 * 24 * 60 * 60 * 1000;

export async function cleanUpExpiredTokens(now = new Date(), batch = 500) {
  const before = new Date(now.getTime() - tokenRetentionMs);
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);
  const [authTokens, guestGrants, mfaGrants] = await Promise.all([
    prisma.authToken.findMany({ where: { expiresAt: { lt: before } }, select: { id: true }, take: batch }),
    prisma.guestAccessGrant.findMany({
      where: { expiresAt: { lt: before }, OR: [{ sessionExpiresAt: null }, { sessionExpiresAt: { lt: before } }] },
      select: { id: true },
      take: batch
    }),
    prisma.mfaGrant.findMany({ where: { expiresAt: { lt: before } }, select: { sessionDigest: true }, take: batch })
  ]);
  const [auth, guest, mfa] = await Promise.all([
    prisma.authToken.deleteMany({ where: { id: { in: ids(authTokens) }, expiresAt: { lt: before } } }),
    prisma.guestAccessGrant.deleteMany({ where: { id: { in: ids(guestGrants) }, expiresAt: { lt: before } } }),
    prisma.mfaGrant.deleteMany({ where: { sessionDigest: { in: mfaGrants.map((grant) => grant.sessionDigest) }, expiresAt: { lt: before } } })
  ]);
  return { authTokens: auth.count, guestAccessGrants: guest.count, mfaGrants: mfa.count };
}
