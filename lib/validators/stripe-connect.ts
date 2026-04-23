import { z } from "zod";

export const organisationConnectSchema = z.object({
  organisationId: z.string().trim().min(1)
});
