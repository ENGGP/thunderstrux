import { mfaGrantDigest } from "@/lib/security/csrf";
import { MfaInputError, MfaRequiredError, mfaEnforcementMode, verifyStaffMfa } from "@/lib/security/staff-mfa";

// Outside MFA "off", an action that can move a society's money needs a fresh
// authenticator code. Kept apart from staff-mfa.ts, which workers load without
// the auth secret that the session grant digest needs.
export async function requireFreshStaffMfa(actor: { id: string; mfaSessionId?: string }, mfaCode: string | undefined, prompt: string) {
  if (mfaEnforcementMode() === "off") return;
  if (!mfaCode) throw new MfaInputError(prompt);
  const digest = mfaGrantDigest(actor.mfaSessionId);
  if (!digest) throw new MfaRequiredError();
  await verifyStaffMfa(actor.id, mfaCode, digest);
}
