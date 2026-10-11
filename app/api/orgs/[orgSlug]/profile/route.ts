import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { organisationActor, organisationError } from "@/lib/organisations/http";
import {
  profileSchema,
  profileSelect,
  updateProfile,
} from "@/lib/organisations/profile";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { AssetError } from "@/lib/assets/image";
type Context = { params: Promise<{ orgSlug: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { organisationId } = await organisationActor(
      (await context.params).orgSlug,
      "organisation:settings",
    );
    return NextResponse.json(
      {
        profile: await prisma.organisation.findUnique({
          where: { id: organisationId },
          select: profileSelect,
        }),
      },
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
    let length = 0;
    const chunks: Uint8Array[] = [];
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 80000) {
            await reader.cancel();
            throw new AssetError(413, "Profile request is too large");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
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
