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

export function scopedByOrganisation<TWhere extends object>(
  organisationId: string,
  where?: TWhere
): TWhere & { organisationId: string } {
  return {
    ...(where ?? ({} as TWhere)),
    organisationId
  };
}
