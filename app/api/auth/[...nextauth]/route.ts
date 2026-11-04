import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { badRequest, passwordBusyResponse } from "@/lib/api/errors";
import { readBodyUpTo } from "@/lib/api/request";
import { prisma } from "@/lib/db";
import { authSecret } from "@/lib/auth/secret";
import { publicOriginIsHttps } from "@/lib/auth/public-origin";
import { knownDeviceCookie, knownDeviceId, knownDeviceSetCookie } from "@/lib/auth/known-device";
import { passwordWorkBusy } from "@/lib/auth/password-hash";
import { mfaGrantDigest } from "@/lib/security/csrf";

export const { GET } = handlers;

const nextAuthPost = handlers.POST;

// The app's sign-in posts a form. Auth.js also reads JSON, and picks it whenever
// the header merely contains `application/json`, so anything else here would reach
// Auth.js with an address the limits below never saw (SEC-040).
const formContentType = /^application\/x-www-form-urlencoded(\s*;\s*charset=utf-8)?$/i;
// An address, a password, a CSRF token and a callback URL, encoded (SEC-041). Every
// other Auth.js POST (sign-out, session update, sign-in start) is smaller still.
const maxAuthBodyBytes = 10_000;
// Auth.js sets this (chunked as .0, .1, … when large) only when a sign-in succeeded.
const sessionCookie = /^(__Secure-)?authjs\.session-token(\.\d+)?=[^;]+/;

export async function POST(request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  const ip = getRateLimitClientIp(request);
  // Every Auth.js POST, not only the credentials callback (SEC-049).
  const globalLimitResponse = await enforceRateLimit({ policy: "login_ip_global", request, keyParts: [ip] });
  if (globalLimitResponse) return globalLimitResponse;

  // Read at most 10 KB before Auth.js parses anything, whatever the route (SEC-049).
  const body = await readBodyUpTo(request.clone(), maxAuthBodyBytes);
  if (body === null) return badRequest("Request body is too large");

  if (pathname.endsWith("/api/auth/signout")) await endMfaGrant(request);
  if (!pathname.endsWith("/api/auth/callback/credentials")) return nextAuthPost(request);

  if (!formContentType.test(request.headers.get("content-type") ?? "")) return badRequest("Sign in through the sign-in form");
  const formData = new URLSearchParams(body);
  // Auth.js signs in with the last "email" field while this throttle reads the first, so
  // duplicates could move each attempt into a fresh bucket (SEC-007). A form sends one.
  if (formData.getAll("email").length > 1) return badRequest("Send one email address");
  const submittedEmail = formData.get("email");
  const email = typeof submittedEmail === "string" ? submittedEmail.trim().toLowerCase() : "";
  if (!email) return badRequest("Enter your email address");
  const emailLimitResponse = await enforceRateLimit({ policy: "login_ip_email", request, keyParts: [ip, email] });
  if (emailLimitResponse) return emailLimitResponse;

  // Per account across addresses, so guesses spread over many IPs still stop (DEBT-002);
  // a browser that signed in to it before counts on its own bucket (SEC-050).
  const account = await prisma.user.findUnique({ where: { email }, select: { authVersion: true } });
  const device = account ? knownDeviceId(request.cookies.get(knownDeviceCookie)?.value, email, account.authVersion) : null;
  const accountLimitResponse = device
    ? await enforceRateLimit({ policy: "login_known_device", request, keyParts: [email, device] })
    : await enforceRateLimit({ policy: "login_email", request, keyParts: [email] });
  if (accountLimitResponse) return accountLimitResponse;

  // Password checks run on the event loop: past the gate, refuse rather than queue (SEC-019).
  if (passwordWorkBusy()) return passwordBusyResponse();
  const response = await nextAuthPost(request);
  if (!response.headers.getSetCookie().some((cookie) => sessionCookie.test(cookie))) return response;
  const signedIn = await prisma.user.findUnique({ where: { email }, select: { authVersion: true } });
  if (!signedIn) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", knownDeviceSetCookie(email, signedIn.authVersion));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Signing out ends this login's staff MFA grant too, so a copied session token
// can't keep using it until it expires (#49).
async function endMfaGrant(request: NextRequest) {
  const token = await getToken({ req: request, secret: authSecret, secureCookie: publicOriginIsHttps(request.url) }).catch(() => null);
  const digest = mfaGrantDigest(typeof token?.staffMfaSessionId === "string" ? token.staffMfaSessionId : undefined);
  if (digest) await prisma.mfaGrant.deleteMany({ where: { sessionDigest: digest } });
}
