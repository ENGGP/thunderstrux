import { forbidden } from "@/lib/api/errors";

const TRUSTED_ORIGIN_ERROR = "Untrusted request origin";
const warnedKeys = new Set<string>();
const MAX_WARNED_KEYS = 500;

type RejectReason = "untrusted_origin" | "null_origin" | "untrusted_referer";
type WarnReason = "missing_origin_and_referer_allowed";

function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
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
  console.warn("Trusted origin guard rejected request", {
    method: request.method,
    path: getRequestPath(request),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    reason
  });
}

function logCompatibilityWarning(request: Request, reason: WarnReason) {
  const key = `${request.method}:${reason}`;

  if (warnedKeys.has(key)) {
    return;
  }

  if (warnedKeys.size >= MAX_WARNED_KEYS) {
    warnedKeys.clear();
  }

  warnedKeys.add(key);
  console.warn("Trusted origin guard compatibility allow", {
    method: request.method,
    path: getRequestPath(request),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
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

    const origin = normaliseOrigin(originHeader);

    if (!origin || !trustedOrigins.has(origin)) {
      logRejectedRequest(request, "untrusted_origin");
      return forbidden(TRUSTED_ORIGIN_ERROR);
    }

    return null;
  }

  const refererHeader = request.headers.get("referer");

  if (refererHeader !== null) {
    const refererOrigin = normaliseOrigin(refererHeader);

    if (!refererOrigin || !trustedOrigins.has(refererOrigin)) {
      logRejectedRequest(request, "untrusted_referer");
      return forbidden(TRUSTED_ORIGIN_ERROR);
    }

    return null;
  }

  logCompatibilityWarning(request, "missing_origin_and_referer_allowed");
  return null;
}
