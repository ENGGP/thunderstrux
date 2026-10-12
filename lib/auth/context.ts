import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireAuthenticatedUser, getCurrentStaffOrganisations } from "./access";
import { contextCookieName, decodeContext } from "./context-cookie";
import { hasOrganisationPermission, organisationPermissions } from "@/lib/permissions";

// The legacy bootstrap association; handover retires it permanently.
export async function bootstrapOrganisationId(userId: string) {
  return (await prisma.organisation.findUnique({ where: { accountUserId: userId }, select: { id: true } }))?.id ?? null;
}

export async function readAccountContext() {
  const user = await requireAuthenticatedUser();
  const organisations = await getCurrentStaffOrganisations();
  const raw = (await cookies()).get(contextCookieName)?.value;
  const preference = decodeContext(raw, user);
  const bootstrap = !raw && user.accountRole === "organisation"
    ? await bootstrapOrganisationId(user.id) : null;
  const selected = preference?.mode === "staff"
    ? organisations.find(row => row.id === preference.organisationId) ?? null
    : bootstrap ? organisations.find(row => row.id === bootstrap) ?? null : null;
  return { mode: selected ? "staff" as const : "personal" as const, selected,
    organisations: organisations.map(row => ({ ...row, permissions: organisationPermissions.filter(
      permission => hasOrganisationPermission(row.staffRole, permission)) })), accountRole: user.accountRole };
}
