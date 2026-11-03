import type { PlatformOperatorRole } from "@prisma/client";

// T54: what a platform operator may do. Like staff roles, the role decides;
// there is no per-person list. T55 added the changes.
export const platformPermissions = [
  "platform:monitor", "platform:read", "platform:audit_read", "platform:operators",
  "platform:account_assist", "platform:account_disable", "platform:recovery", "platform:society_control", "platform:operations"
] as const;
export type PlatformPermission = typeof platformPermissions[number];

const rolePermissions: Record<PlatformOperatorRole, readonly PlatformPermission[]> = {
  admin: platformPermissions,
  support: ["platform:monitor", "platform:read", "platform:account_assist"]
};

export function hasPlatformPermission(role: PlatformOperatorRole, permission: PlatformPermission) {
  return rolePermissions[role].includes(permission);
}
