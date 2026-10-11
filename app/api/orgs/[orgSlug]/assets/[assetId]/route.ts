import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { organisationActor, organisationError } from "@/lib/organisations/http";
import { assetPermission, deleteAsset, previewAsset, type AssetKind } from "@/lib/assets/service";
import { AssetError } from "@/lib/assets/image";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

type Context = { params: Promise<{ orgSlug: string; assetId: string }> };
async function access(context: Context) {
  const { orgSlug, assetId } = await context.params;
  const snapshot = await prisma.asset.findFirst({ where: { id: assetId, organisation: { slug: orgSlug } }, select: { kind: true } });
  // Authenticate before disclosing whether an image exists.
  const access = await organisationActor(orgSlug, assetPermission((snapshot?.kind ?? "logo") as AssetKind));
  if (!snapshot) throw new AssetError(404, "Image was not found");
  return { ...access, assetId };
}
export async function GET(_request: Request, context: Context) {
  try {
    const { organisationId, assetId } = await access(context);
    const { bytes, asset } = await previewAsset(organisationId, assetId);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": asset.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (error) { return organisationError(error); }
}
export async function DELETE(request: Request, context: Context) {
  const guard = enforceTrustedMutationRequest(request);
  if (guard) return guard;
  try {
    const { actor, organisationId, assetId } = await access(context);
    const limit = await enforceRateLimit({ policy: "asset_delete", request, keyParts: [actor.id, organisationId], required: true });
    if (limit) return limit;
    return NextResponse.json(await deleteAsset(actor, organisationId, assetId));
  } catch (error) { return organisationError(error); }
}
