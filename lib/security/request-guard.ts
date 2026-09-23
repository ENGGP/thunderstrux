import { forbidden } from "@/lib/api/errors";
import { logWarn } from "@/lib/ops/logger";
import { hasAuthSessionCookie, verifyCsrfTokenForRequest } from "@/lib/security/csrf";

const TRUSTED_ORIGIN_ERROR = "Untrusted request origin";
type RejectReason =
  | "untrusted_origin"
  | "null_origin"
  | "untrusted_referer"
  | "missing_origin_and_referer"
  | "missing_or_invalid_csrf_token";

function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseOriginHeader(value: string): string | null {
  const origin = normaliseOrigin(value);
  // An Origin header is a serialized origin, never a full URL with a path,
  // query, fragment, or credentials.
  return origin === value ? origin : null;
}

function configuredTrustedOrigins(): Set<string> {
  const trusted = new Set<string>();
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.TRUSTED_APP_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const origin = normaliseOrigin(candidate);

    if (origin) {
      trusted.add(origin);
    }
  }

  return trusted;
}

function getRequestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

function logRejectedRequest(request: Request, reason: RejectReason) {
  logWarn("trusted_origin.rejected", {
    method: request.method,
    path: getRequestPath(request),
    origin: parseOriginHeader(request.headers.get("origin") ?? ""),
    refererOrigin: normaliseOrigin(request.headers.get("referer") ?? ""),
    reason
  });
}

export function enforceTrustedMutationRequest(request: Request) {
  const trustedOrigins = configuredTrustedOrigins();
  const originHeader = request.headers.get("origin");

  if (originHeader !== null) {
    if (originHeader === "null") {
      logRejectedRequest(request, "null_origin");
      return forbidden(TRUSTED_ORIGIN_ERROR);
    }

    const origin = parseOriginHeader(originHeader);

    if (!origin || !trustedOrigins.has(origin)) {
      logRejectedRequest(request, "untrusted_origin");
      return forbidden(TRUSTED_ORIGIN_ERROR);
    }

    return enforceCsrfToken(request);
  }

  const refererHeader = request.headers.get("referer");

  if (refererHeader !== null) {
    const refererOrigin = normaliseOrigin(refererHeader);

    if (!refererOrigin || !trustedOrigins.has(refererOrigin)) {
      logRejectedRequest(request, "untrusted_referer");
      return forbidden(TRUSTED_ORIGIN_ERROR);
    }

    return enforceCsrfToken(request);
  }

  logRejectedRequest(request, "missing_origin_and_referer");
  return forbidden(TRUSTED_ORIGIN_ERROR);
}

function enforceCsrfToken(request: Request) {
  // Signup is anonymous. Auth.js routes have their own CSRF protection, and
  // signed Stripe webhook routes do not call this guard.
  if (getRequestPath(request) === "/api/auth/signup" || !hasAuthSessionCookie(request)) {
    return null;
  }
  if (verifyCsrfTokenForRequest(request)) return null;
  logRejectedRequest(request, "missing_or_invalid_csrf_token");
  return forbidden("Invalid CSRF token");
}
