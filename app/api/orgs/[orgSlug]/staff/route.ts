import { NextResponse } from "next/server";
import { mapRouteError, notFound } from "@/lib/api/errors";
import { authenticationRule, organisationAccessRule } from "@/lib/api/route-rules";
import { requireOrganisationPermission } from "@/lib/auth/access";
import { organisationIdBySlug } from "@/lib/organisations/authority";
import { listOrganisationStaff } from "@/lib/staff/management";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { orgSlug } = await context.params;

  try {
    const organisationId = await organisationIdBySlug(orgSlug);

    if (!organisationId) {
      return notFound("Organisation was not found");
    }

    await requireOrganisationPermission(organisationId, "staff:manage");

    return NextResponse.json(await listOrganisationStaff(organisationId), {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return mapRouteError(error, {
      operation: "staff.list",
      request,
      rules: [authenticationRule, organisationAccessRule]
    });
  }
}
