import { NextResponse } from "next/server";
import { z } from "zod";
import { organisationActor, organisationError } from "@/lib/organisations/http";
import { assetKinds, assetPermission, uploadAsset } from "@/lib/assets/service";
import { readImageForm } from "@/lib/assets/image";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ orgSlug: string }> }) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    const { orgSlug } = await context.params;
    const kind = z.enum(assetKinds).parse(new URL(request.url).searchParams.get("kind"));
    const { actor, organisationId } = await organisationActor(orgSlug, assetPermission(kind));
    for (const keyParts of [["actor", actor.id], ["tenant", organisationId]]) {
      const limit = await enforceRateLimit({ policy: "asset_upload", request, keyParts, required: true });
      if (limit) return limit;
    }
    const asset = await uploadAsset(actor, organisationId, kind, await readImageForm(request));
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) { return organisationError(error); }
}
