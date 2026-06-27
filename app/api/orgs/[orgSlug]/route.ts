import { NextResponse } from "next/server";
import { forbidden, internalError, notFound, unauthorized } from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireOrganisationAccessBySlug
} from "@/lib/auth/access";

type RouteContext = {
  params: Promise<{
    orgSlug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { orgSlug } = await context.params;

  try {
    const organisation = await requireOrganisationAccessBySlug(orgSlug);

    return NextResponse.json({ organisation });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      if (error.message === "Organisation not found or access denied") {
        return notFound("Organisation was not found");
      }

      return forbidden(error.message);
    }

    console.error(error);
    return internalError();
  }
}
