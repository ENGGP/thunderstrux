import { z } from "zod";

export const organisationConnectSchema = z.object({
  organisationId: z.string().trim().min(1)
});

// Onboarding, the dashboard link and disconnect name the society only.
export const stripeDisconnectSchema = organisationConnectSchema;
