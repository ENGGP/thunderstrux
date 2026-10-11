import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assetReferenced } from "@/lib/assets/references";
import { previewAsset } from "@/lib/assets/service";
import { notFound } from "@/lib/api/errors";
import { organisationError } from "@/lib/organisations/http";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const { assetId } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { organisationId: true, status: true } });
    if (!asset || asset.status !== "ready" || !await prisma.$transaction(tx => assetReferenced(tx, assetId))) return notFound("Image was not found");
    const image = await previewAsset(asset.organisationId, assetId);
    const headers = { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300", ETag: `"${image.asset.sha256}"` };
    return new NextResponse(request.headers.get("if-none-match") === headers.ETag ? null : new Uint8Array(image.bytes), {
      status: request.headers.get("if-none-match") === headers.ETag ? 304 : 200, headers
    });
  } catch (error) { return organisationError(error); }
}
