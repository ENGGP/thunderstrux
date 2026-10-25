import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth/live-session";
import { assetBytes, memberEventAsset, publicAsset } from "@/lib/assets/service";
import { notFound } from "@/lib/api/errors";
import { organisationError } from "@/lib/organisations/http";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  try {
    const id = (await context.params).assetId;
    const shared = await publicAsset(id);
    // A members-only event's image goes only to members it is open to, never to a shared cache.
    const session = shared ? null : await getLiveSession();
    const asset = shared ?? (session ? await memberEventAsset(id, session.user.id) : null);
    if (!asset) return notFound("Image was not found");
    const headers = { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": shared ? "public, max-age=300" : "private, no-store", ETag: `"${asset.sha256}"` };
    // A revalidation or a HEAD (Next serves HEAD through GET) is answered from the row, without reading storage (SEC-021).
    if (request.headers.get("if-none-match") === headers.ETag) return new NextResponse(null, { status: 304, headers });
    if (request.method === "HEAD") return new NextResponse(null, { status: 200, headers: { ...headers, "Content-Length": String(asset.byteSize) } });
    return new NextResponse(new Uint8Array(await assetBytes(asset)), { status: 200, headers });
  } catch (error) { return organisationError(error); }
}
