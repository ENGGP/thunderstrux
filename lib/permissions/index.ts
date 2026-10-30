export type OrganisationRole =
  | "org_owner"
  | "org_admin"
  | "event_manager"
  | "finance_manager"
  | "content_manager"
  | "member";

export type OrganisationStaffRole =
  | "owner"
  | "admin"
  | "event_manager"
  | "finance_manager"
  | "check_in_staff";

export const organisationPermissions = [
  "events:read", "events:manage", "orders:read", "orders:refund_mark", "orders:refund",
  "orders:email_resend", "stripe:manage", "tickets:check_in", "staff:manage",
  "organisation:settings", "members:read", "memberships:manage",
  "merchandise:manage", "merchandise:fulfil", "analytics:read", "audit:read"
] as const;
export type OrganisationPermission = typeof organisationPermissions[number];
const rolePermissions: Record<OrganisationStaffRole, readonly OrganisationPermission[]> = {
  owner: organisationPermissions,
  admin: organisationPermissions,
  event_manager: ["events:read", "events:manage", "tickets:check_in", "analytics:read"],
  finance_manager: ["events:read", "orders:read", "orders:refund_mark", "orders:refund", "orders:email_resend", "analytics:read"],
  check_in_staff: ["events:read", "tickets:check_in"]
};

export function hasOrganisationPermission(
  role: OrganisationStaffRole,
  permission: OrganisationPermission
) {
  return rolePermissions[role].includes(permission);
}

export function organisationRolesWithPermission(permission: OrganisationPermission) {
  return (Object.keys(rolePermissions) as OrganisationStaffRole[]).filter((role) =>
    hasOrganisationPermission(role, permission)
  );
}
