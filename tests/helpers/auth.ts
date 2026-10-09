import { encodeContext, type ContextSelection } from "@/lib/auth/context-cookie";
import type { AccountRole } from "@prisma/client";

export function clearMockSession() {
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = null;
  globalThis.__THUNDERSTRUX_TEST_CONTEXT__ = undefined;
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

export function selectMockContext(selection: ContextSelection) {
  const user = globalThis.__THUNDERSTRUX_TEST_SESSION__?.user;
  if (!user || user.authVersion === undefined) throw new Error("Set a mock session before selecting context");
  globalThis.__THUNDERSTRUX_TEST_CONTEXT__ = encodeContext(selection, { id: user.id, authVersion: user.authVersion, mfaSessionId: user.staffMfaSessionId });
}
