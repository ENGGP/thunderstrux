import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import type { OrganisationPermission } from "@/lib/permissions";

export async function requireManagementPage(
  permission: OrganisationPermission,
  callbackPath: string
) {
  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, permission);
    return organisation;
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
    }
    if (error instanceof OrganisationAccessError) notFound();
    throw error;
  }
}
