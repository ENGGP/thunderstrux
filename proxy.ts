import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { authSecret } from "@/lib/auth/secret";

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: authSecret,
    // Match Auth.js's public URL even when TLS ends at the tunnel.
    secureCookie: new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.url).protocol === "https:"
  });
  const pathname = request.nextUrl.pathname;
  const identity = token ? await getSessionIdentity(token.userId, token.authVersion) : null;

  if (
    identity?.accountRole === "organisation" &&
    pathname.startsWith("/events/")
  ) {
    const eventId = pathname.split("/")[2];

    if (eventId) {
      return NextResponse.redirect(
        new URL(`/dashboard/events/${eventId}`, request.nextUrl.origin)
      );
    }
  }

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
  matcher: ["/dashboard/:path*", "/events/:path*", "/account/:path*"]
};
