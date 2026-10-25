import { NextResponse } from "next/server";
import { organisationActor, organisationError } from "@/lib/organisations/http";
import {
  profileSchema,
  readProfile,
  updateProfile,
} from "@/lib/organisations/profile";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { AssetError } from "@/lib/assets/image";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/api/request";
type Context = { params: Promise<{ orgSlug: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { organisationId } = await organisationActor(
      (await context.params).orgSlug,
      "organisation:settings",
    );
    return NextResponse.json(
      { profile: await readProfile(organisationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return organisationError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const { actor, organisationId } = await organisationActor(
      (await context.params).orgSlug,
      "organisation:settings",
    );
    const limited = await enforceRateLimit({
      policy: "organisation_profile",
      request,
      keyParts: [actor.id, organisationId],
    });
    if (limited) return limited;
    let json: unknown;
    try {
      json = await readJsonBody(request, 80000);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw new AssetError(413, "Profile request is too large");
      throw new AssetError(400, "Request body must be valid JSON");
    }
    return NextResponse.json(
      {
        profile: await updateProfile(
          actor,
          organisationId,
          profileSchema.parse(json),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return organisationError(error);
  }
}
