import { NextResponse } from "next/server";
import { publicAsset } from "@/lib/assets/service";
import { notFound } from "@/lib/api/errors";
import { organisationError } from "@/lib/organisations/http";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const image = await publicAsset((await context.params).assetId);
    if (!image) return notFound("Image was not found");
    const headers = { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300", ETag: `"${image.asset.sha256}"` };
    return new NextResponse(request.headers.get("if-none-match") === headers.ETag ? null : new Uint8Array(image.bytes), {
      status: request.headers.get("if-none-match") === headers.ETag ? 304 : 200, headers
    });
  } catch (error) { return organisationError(error); }
}
