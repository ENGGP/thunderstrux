import { prisma } from "@/lib/db";
export async function getSessionIdentity(userId: unknown, authVersion: unknown) {
  if (typeof userId !== "string" || !userId || typeof authVersion !== "number" || !Number.isInteger(authVersion) || authVersion < 0) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
    id: true, email: true, accountRole: true, authVersion: true, disabledAt: true,
    firstName: true, lastName: true, onboardingCompletedAt: true, emailVerifiedAt: true
  } });
  return user && !user.disabledAt && user.authVersion === authVersion ? user : null;
}
