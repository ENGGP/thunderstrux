import { prisma } from "@/lib/db";

export class OrganisationScopeError extends Error {
  constructor(message = "organisationId is required for this operation") {
    super(message);
    this.name = "OrganisationScopeError";
  }
}

export class OrganisationMismatchError extends Error {
  constructor(message = "x-org-id does not match organisationId") {
    super(message);
    this.name = "OrganisationMismatchError";
  }
}

export function requireOrganisationId(organisationId: unknown): string {
  if (typeof organisationId !== "string" || organisationId.trim().length === 0) {
    throw new OrganisationScopeError();
  }

  return organisationId.trim();
}

export function requireOrganisationHeader(request: Request): string {
  return requireOrganisationId(request.headers.get("x-org-id"));
}

export function requireMatchingOrganisationScope(
  request: Request,
  organisationId: unknown
): string {
  const headerOrganisationId = requireOrganisationHeader(request);
  const bodyOrganisationId = requireOrganisationId(organisationId);

  if (headerOrganisationId !== bodyOrganisationId) {
    throw new OrganisationMismatchError();
  }

  return bodyOrganisationId;
}

export function scopedByOrganisation<TWhere extends object>(
  organisationId: string,
  where?: TWhere
): TWhere & { organisationId: string } {
  return {
    ...(where ?? ({} as TWhere)),
    organisationId
  };
}

export async function assertEventBelongsToOrganisation(
  eventId: string,
  organisationId: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: { id: true }
  });

  if (!event) {
    throw new OrganisationScopeError("Event was not found in this organisation");
  }

  return event;
}
