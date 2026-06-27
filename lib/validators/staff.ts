import { z } from "zod";

export const staffRoleSchema = z.enum([
  "owner",
  "admin",
  "event_manager",
  "finance_manager",
  "check_in_staff"
]);

export const createStaffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: staffRoleSchema
});

export const updateStaffSchema = z.object({
  role: staffRoleSchema.optional(),
  status: z.enum(["active", "revoked"]).optional()
}).refine((value) => value.role !== undefined || value.status !== undefined, {
  message: "At least one staff change is required"
});

export const acceptStaffInviteSchema = z.object({
  token: z.string().trim().min(32).max(256)
});
