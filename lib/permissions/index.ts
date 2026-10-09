export type OrganisationRole =
  | "org_owner"
  | "org_admin"
  | "event_manager"
  | "finance_manager"
  | "content_manager"
  | "member";

const allowedRoles: OrganisationRole[] = [
  "org_owner",
  "org_admin",
  "event_manager",
  "finance_manager",
  "content_manager",
  "member"
];

export type OrganisationStaffRole =
  | "owner"
  | "admin"
  | "event_manager"
  | "finance_manager"
  | "check_in_staff";

export const organisationPermissions = [
  "events:read", "events:manage", "orders:read", "orders:refund_mark", "orders:refund",
  "orders:email_resend", "stripe:manage", "tickets:check_in", "staff:manage",
  "organisation:settings", "members:read", "members:manage", "memberships:manage",
  "merchandise:manage", "merchandise:fulfil", "analytics:read", "audit:read", "openclaw:use"
] as const;
export type OrganisationPermission = typeof organisationPermissions[number];
const rolePermissions: Record<OrganisationStaffRole, readonly OrganisationPermission[]> = {
  owner: organisationPermissions,
  admin: organisationPermissions,
  event_manager: ["events:read", "events:manage", "tickets:check_in", "analytics:read", "openclaw:use"],
  finance_manager: ["events:read", "orders:read", "orders:refund_mark", "orders:refund", "orders:email_resend", "analytics:read", "openclaw:use"],
  check_in_staff: ["events:read", "tickets:check_in"]
};

// Role helpers are compatibility checks after access has already been resolved.
// Management entrypoints resolve active OrganisationStaff authority, with the
// explicit legacy-owner fallback in auth/access. OrganisationMember is join state.
export function canManageEvents(userRole: OrganisationRole): boolean {
  return ["org_owner", "org_admin", "event_manager"].includes(userRole);
}

export function canManageFinance(userRole: OrganisationRole): boolean {
  return ["org_owner", "org_admin", "finance_manager"].includes(userRole);
}

export function canManageStripeConnect(userRole: OrganisationRole): boolean {
  return userRole !== "member";
}

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

export function parseRoleHeader(request: Request):
  | { success: true; role: OrganisationRole }
  | { success: false } {
  const role = request.headers.get("x-user-role");

  if (!role || !allowedRoles.includes(role as OrganisationRole)) {
    return { success: false };
  }

  return { success: true, role: role as OrganisationRole };
}
