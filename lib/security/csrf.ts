import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/auth";

export const CSRF_HEADER = "x-thunderstrux-csrf-token";
const TOKEN_VERSION = "v1";
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.session-token"
];

function sessionCookieFromHeader(raw: string | null): string | null {
  if (!raw) return null;
  const cookies = new Map<string, string>();
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    // The first of duplicate cookies wins, as Auth.js reads them, so the token binds the session it authenticates (T53).
    if (!cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  // As Auth.js's SessionStore reads a session: every cookie whose name starts with
  // the session cookie's, in chunk-suffix order, joined. Any such cookie needs a token,
  // so a lone or reordered chunk can't skip the check (SEC-027).
  const suffix = (name: string) => parseInt(name.split(".").pop() || "0");
  for (const name of SESSION_COOKIE_NAMES) {
    const parts = [...cookies].filter(([cookieName, value]) => cookieName.startsWith(name) && value);
    if (parts.length === 0) continue;
    parts.sort(([a], [b]) => suffix(a) - suffix(b));
    return `${name}:${parts.map(([, value]) => value).join("")}`;
  }
  return null;
}

function sessionCookie(request: Request) {
  return sessionCookieFromHeader(request.headers.get("cookie"));
}

export function mfaGrantDigest(sessionId: string | undefined) {
  if (!sessionId) return null;
  return createHmac("sha256", csrfSecret()).update(`mfa-grant:v2:${sessionId}`).digest("hex");
}

function csrfSecret() {
  return authSecret;
}

function signature(cookie: string, hour: number) {
  return createHmac("sha256", csrfSecret())
    .update(`${TOKEN_VERSION}:${hour}:${cookie}`)
    .digest("hex");
}

export function hasAuthSessionCookie(request: Request) {
  return sessionCookie(request) !== null;
}

export function createCsrfTokenForRequest(request: Request, now = Date.now()) {
  const cookie = sessionCookie(request);
  if (!cookie) return null;
  const hour = Math.floor(now / TOKEN_LIFETIME_MS);
  return `${TOKEN_VERSION}.${hour}.${signature(cookie, hour)}`;
}

export function verifyCsrfTokenForRequest(request: Request, now = Date.now()) {
  const cookie = sessionCookie(request);
  const supplied = request.headers.get(CSRF_HEADER);
  if (!cookie || !supplied) return false;
  const [version, hourText, digest, extra] = supplied.split(".");
  if (version !== TOKEN_VERSION || extra !== undefined || !/^\d+$/.test(hourText ?? "")) {
    return false;
  }
  const hour = Number(hourText);
  if (hour !== Math.floor(now / TOKEN_LIFETIME_MS) || !/^[a-f0-9]{64}$/.test(digest ?? "")) {
    return false;
  }
  const actual = Buffer.from(digest, "hex");
  const expected = Buffer.from(signature(cookie, hour), "hex");
  return timingSafeEqual(actual, expected);
}
