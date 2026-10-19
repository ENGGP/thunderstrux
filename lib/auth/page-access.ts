import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  StaffMfaRequiredError,
  requireAnyOrganisationPermission,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
import { contextChoices, readAccountContext } from "@/lib/auth/context";
import { organisationIdBySlug } from "@/lib/organisations/authority";
import type { OrganisationPermission } from "@/lib/permissions";

// One permission, or any of several (a page staff reach from different places, T29b).
export async function requireManagementPage(
  permission: OrganisationPermission | OrganisationPermission[],
  callbackPath: string
) {
  try {
    const organisation = await requireCurrentOrganisationAccount();
    if (Array.isArray(permission)) await requireAnyOrganisationPermission(organisation.id, permission);
    else await requireOrganisationPermission(organisation.id, permission);
    // Read after both guards pass: the shell's switcher lists live authority only.
    return {
      ...organisation,
      contexts: contextChoices(await readAccountContext())
    };
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
