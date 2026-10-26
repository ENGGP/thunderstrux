import { mfaGrantDigest } from "@/lib/security/csrf";
import { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, totpCode } from "@/lib/security/staff-mfa";
import { setMockSession } from "@/tests/helpers/auth";

// Enrols a staff account, grants its mock session (setMockSession's default
// session id unless given), and returns fresh authenticator codes: code(1) is
// the next step, which the replay guard accepts once.
export async function enrolStaffMfa(user: { id: string; email: string }, mfaSessionId = "integration-session") {
  const step = Math.floor(Date.now() / 30_000);
  const { secret } = await beginStaffMfaEnrollment(user.id, user.email);
  await confirmStaffMfaEnrollment(user.id, totpCode(secret, step), mfaGrantDigest(mfaSessionId)!);
  setMockSession({ userId: user.id, email: user.email, accountRole: "organisation", mfaSessionId });
  return { secret, code: (offset = 1) => totpCode(secret, step + offset) };
}
