import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth/live-session";
import { memberEventAsset, publicAsset } from "@/lib/assets/service";
import { notFound } from "@/lib/api/errors";
import { organisationError } from "@/lib/organisations/http";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const id = (await context.params).assetId;
    const shared = await publicAsset(id);
    // A members-only event's image goes only to members it is open to, never to a shared cache.
    const session = shared ? null : await getLiveSession();
    const image = shared ?? (session ? await memberEventAsset(id, session.user.id) : null);
    if (!image) return notFound("Image was not found");
    const headers = { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": shared ? "public, max-age=300" : "private, no-store", ETag: `"${image.asset.sha256}"` };
    return new NextResponse(request.headers.get("if-none-match") === headers.ETag ? null : new Uint8Array(image.bytes), {
      status: request.headers.get("if-none-match") === headers.ETag ? 304 : 200, headers
    });
  } catch (error) { return organisationError(error); }
}
