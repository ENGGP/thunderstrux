import { auth } from "@/auth";
import { getSessionIdentity } from "./session-identity";
export async function getLiveSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const identity = await getSessionIdentity(session.user.id, session.user.authVersion);
  if (!identity) return null;
  return { ...session, user: { ...session.user, id: identity.id, email: identity.email,
    accountRole: identity.accountRole, authVersion: identity.authVersion, firstName: identity.firstName,
    lastName: identity.lastName, onboardingCompletedAt: identity.onboardingCompletedAt?.toISOString() ?? null,
    emailVerifiedAt: identity.emailVerifiedAt?.toISOString() ?? null } };
}
