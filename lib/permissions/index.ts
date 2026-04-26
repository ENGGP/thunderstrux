export type OrganisationRole =
  | "org_owner"
  | "org_admin"
  | "event_manager"
  | "finance_manager"
  | "content_manager"
  | "member";

const eventManagementRoles: OrganisationRole[] = [
  "org_owner",
  "org_admin",
  "event_manager"
];

const financeManagementRoles: OrganisationRole[] = [
  "org_owner",
  "org_admin",
  "finance_manager"
];

const allowedRoles: OrganisationRole[] = [
  "org_owner",
  "org_admin",
  "event_manager",
  "finance_manager",
  "content_manager",
  "member"
];

export function canManageEvents(userRole: OrganisationRole): boolean {
  return eventManagementRoles.includes(userRole);
}

export function canManageFinance(userRole: OrganisationRole): boolean {
  return financeManagementRoles.includes(userRole);
}

export function canManageStripeConnect(userRole: OrganisationRole): boolean {
  return userRole !== "member";
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
