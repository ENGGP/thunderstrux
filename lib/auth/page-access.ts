import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  StaffMfaRequiredError,
  requireAnyOrganisationPermission,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { readAccountContext } from "@/lib/auth/context";
import { organisationIdBySlug } from "@/lib/organisations/authority";
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
    if (error instanceof StaffMfaRequiredError) {
      redirect(`/mfa?callbackUrl=${encodeURIComponent(callbackPath)}`);
    }
    if (error instanceof OrganisationAccessError) notFound();
    throw error;
  }
}

// Legacy /dashboard/[orgSlug]/* links: confirm live authority for that slug,
// then continue on the slugless route. Anything else is a concealed 404.
export async function redirectLegacyOrganisationPage(
  orgSlug: string,
  permissions: OrganisationPermission[],
  legacyPath: string,
  target: string
): Promise<never> {
  const organisationId = await organisationIdBySlug(orgSlug);

  if (!organisationId) {
    notFound();
  }

  try {
    await requireAnyOrganisationPermission(organisationId, permissions);
  } catch (error) {
    if (error instanceof StaffMfaRequiredError) {
      redirect(`/mfa?callbackUrl=${encodeURIComponent(legacyPath)}`);
    }
    notFound();
  }

  if ((await readAccountContext()).selected?.id !== organisationId) {
    redirect("/dashboard");
  }

  redirect(target);
}
