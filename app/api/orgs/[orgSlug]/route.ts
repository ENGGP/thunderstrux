import { NextResponse } from "next/server";
import { forbidden, internalError, unauthorized } from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationMembershipBySlug
} from "@/lib/auth/access";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { orgSlug } = await context.params;

  try {
    const organisation = await requireOrganisationMembershipBySlug(orgSlug);

    return NextResponse.json({ organisation });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error(error);
    return internalError();
  }
}
