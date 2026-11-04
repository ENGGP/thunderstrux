import { prisma } from "@/lib/db";
import { mfaGrantDigest } from "@/lib/security/csrf";

// The Auth.js route's reads and writes (app/api/auth/[...nextauth]/route.ts).

// The account a sign-in names, for its known-device cookie (SEC-050).
export function signInAccount(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true, email: true, authVersion: true } });
}

// An accepted sign-out ends that login's staff MFA grant, and only that one (#49).
export async function endLoginMfaGrant(staffMfaSessionId: string | undefined) {
  const digest = mfaGrantDigest(staffMfaSessionId);
  if (digest) await prisma.mfaGrant.deleteMany({ where: { sessionDigest: digest } });
}
