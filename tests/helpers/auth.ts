import type { AccountRole } from "@prisma/client";

export function clearMockSession() {
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = null;
}

export function setMockSession({
  userId,
  email,
  accountRole,
  authVersion = 0,
  mfaSessionId = "integration-session"
}: {
  userId: string;
  email: string;
  accountRole: AccountRole;
  authVersion?: number;
  mfaSessionId?: string;
}) {
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = {
    user: {
      id: userId,
      authVersion,
      staffMfaSessionId: mfaSessionId,
      email,
      accountRole,
      firstName: null,
      lastName: null,
      onboardingCompletedAt: null
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
}
