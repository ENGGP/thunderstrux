import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getSessionIdentity } from "@/lib/auth/session-identity";

const unsafeAuthSecrets = new Set([
  "",
  "dev-secret",
  "replace-with-a-non-empty-secret"
]);

function resolveProxyAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim() ?? "";

  if (process.env.NODE_ENV === "production" && unsafeAuthSecrets.has(secret)) {
    throw new Error(
      "AUTH_SECRET must be set to a strong non-placeholder value in production."
    );
  }

  return secret || "dev-secret";
}

const authSecret = resolveProxyAuthSecret();

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: authSecret
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
