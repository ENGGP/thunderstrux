import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200)
});

export const signupSchema = credentialsSchema.extend({
  accountRole: z.enum(["member", "organisation"]).default("member"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional()
});

export const memberProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  studentNumber: z.string().trim().max(80).optional()
});
