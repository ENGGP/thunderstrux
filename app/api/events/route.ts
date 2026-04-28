import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireEventManagementAccess
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import {
  OrganisationMismatchError,
  OrganisationScopeError,
  requireOrganisationId,
  scopedByOrganisation
} from "@/lib/db/organisation-scope";
import { validateJson } from "@/lib/validators";
import { createEventSchema } from "@/lib/validators/events";

export async function POST(request: Request) {
  const validation = await validateJson(request, createEventSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireEventManagementAccess(organisationId);

    const organisation = await prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true }
    });

    if (!organisation) {
      return badRequest("Invalid organisationId", [
        { path: ["organisationId"], message: "Organisation does not exist" }
      ]);
    }

    const event = await prisma.event.create({
      data: {
        organisationId,
        title: validation.data.title,
        description: validation.data.description,
        startTime: validation.data.startTime,
        endTime: validation.data.endTime,
        location: validation.data.location,
        status: validation.data.status,
        ticketTypes: {
          create: validation.data.ticketTypes.map((ticketType) => ({
            name: ticketType.name,
            price: ticketType.price,
            quantity: ticketType.quantity
          }))
        }
      },
      select: {
        id: true,
        organisationId: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        location: true,
        status: true,
        createdAt: true,
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationMismatchError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["organisationId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error(error);
    return internalError();
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organisationId = requireOrganisationId(searchParams.get("orgId"));
    await requireEventManagementAccess(organisationId);

    const events = await prisma.event.findMany({
      where: scopedByOrganisation(organisationId),
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        organisationId: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        location: true,
        status: true,
        createdAt: true,
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    return NextResponse.json({ events });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["orgId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error(error);
    return internalError();
  }
}
