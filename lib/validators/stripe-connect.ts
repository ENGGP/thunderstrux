import { z } from "zod";

export const organisationConnectSchema = z.object({
  organisationId: z.string().trim().min(1)
});

// Onboarding, the dashboard link and disconnect also carry the authenticator code when staff MFA is on.
export const stripeDisconnectSchema = organisationConnectSchema.extend({
  mfaCode: z.string().trim().min(1).max(40).optional()
});
