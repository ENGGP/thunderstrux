import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { authSecret } from "@/lib/auth/secret";
import { publicOriginIsHttps } from "@/lib/auth/public-origin";
import { adminHostAllowed, isAdminPortalEnabled } from "@/lib/platform/mode";

export async function proxy(request: NextRequest) {
  // T54: the public app never serves the admin portal, and the admin process
  // serves it only to its own loopback host (no DNS rebinding).
  if ((request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/")) && (!isAdminPortalEnabled() || !adminHostAllowed(request.headers.get("host")))) {
    return new NextResponse("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const token = await getToken({
    req: request,
    secret: authSecret,
    // Match Auth.js's public URL even when TLS ends at the tunnel.
    secureCookie: publicOriginIsHttps(request.url)
  });
  const identity = token ? await getSessionIdentity(token.userId, token.authVersion) : null;

  if (!identity) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set(
      "callbackUrl",
      `${request.nextUrl.pathname}${request.nextUrl.search}`
    );

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Event pages are public (T15a); their checkout pages ask for sign-in themselves.
  matcher: ["/dashboard/:path*", "/account/:path*", "/admin/:path*"]
};
