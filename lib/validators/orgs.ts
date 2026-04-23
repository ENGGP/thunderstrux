import { z } from "zod";

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional()
});
