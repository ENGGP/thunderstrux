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

export type OrganisationPermission =
  | "events:manage"
  | "orders:read"
  | "orders:refund_mark"
  | "orders:email_resend"
  | "stripe:manage"
  | "tickets:check_in"
  | "staff:manage";

const rolePermissions: Record<OrganisationStaffRole, OrganisationPermission[]> = {
  owner: [
    "events:manage",
    "orders:read",
    "orders:refund_mark",
    "orders:email_resend",
    "stripe:manage",
    "tickets:check_in",
    "staff:manage"
  ],
  admin: [
    "events:manage",
    "orders:read",
    "orders:refund_mark",
    "orders:email_resend",
    "stripe:manage",
    "tickets:check_in",
    "staff:manage"
  ],
  event_manager: ["events:manage", "tickets:check_in"],
  finance_manager: ["orders:read", "orders:refund_mark", "orders:email_resend"],
  check_in_staff: ["tickets:check_in"]
};

// Role helpers are compatibility checks after access has already been resolved.
// In the current account model, management entrypoints must first prove
// Organisation.accountUserId ownership; OrganisationMember is member join state.
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

export function parseRoleHeader(request: Request):
  | { success: true; role: OrganisationRole }
  | { success: false } {
  const role = request.headers.get("x-user-role");

  if (!role || !allowedRoles.includes(role as OrganisationRole)) {
    return { success: false };
  }

  return { success: true, role: role as OrganisationRole };
}
