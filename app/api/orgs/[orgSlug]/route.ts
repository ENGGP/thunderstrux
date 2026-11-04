import { NextResponse } from "next/server";
import {
  forbidden,
  mapRouteError,
  notFound,
  routeErrorRule
} from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import {
  OrganisationAccessError,
  requireOrganisationAccessBySlug
} from "@/lib/auth/access";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { orgSlug } = await context.params;

  try {
    const organisation = await requireOrganisationAccessBySlug(orgSlug);

    // #21: staff-only details; no shared cache may keep them.
    return NextResponse.json({ organisation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "organisations.read",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (denied) =>
          denied.message === "Organisation not found or access denied"
            ? notFound("Organisation was not found")
            : forbidden(denied.message)
        )
      ]
    });
  }
}
