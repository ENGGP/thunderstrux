import type { PlatformOperatorRole } from "@prisma/client";

// T54: what a platform operator may do. Like staff roles, the role decides;
// there is no per-person list. Changes (T55) add their permissions here.
export const platformPermissions = [
  "platform:monitor", "platform:read", "platform:audit_read", "platform:operators"
] as const;
export type PlatformPermission = typeof platformPermissions[number];

const rolePermissions: Record<PlatformOperatorRole, readonly PlatformPermission[]> = {
  admin: platformPermissions,
  support: ["platform:monitor", "platform:read"]
};

export function hasPlatformPermission(role: PlatformOperatorRole, permission: PlatformPermission) {
  return rolePermissions[role].includes(permission);
}
