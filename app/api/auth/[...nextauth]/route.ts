import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { badRequest, passwordBusyResponse } from "@/lib/api/errors";
import { readBodyUpTo } from "@/lib/api/request";
import { authSecret } from "@/lib/auth/secret";
import { publicOriginIsHttps } from "@/lib/auth/public-origin";
import { knownDeviceClearCookie, knownDeviceCookie, knownDeviceId, knownDeviceSetCookie } from "@/lib/auth/known-device";
import { passwordWorkBusy } from "@/lib/auth/password-hash";
import { endLoginMfaGrant, signInAccount } from "@/lib/auth/sign-in-records";

export const { GET } = handlers;

const nextAuthPost = handlers.POST;

// The app's sign-in posts a form. Auth.js also reads JSON, and picks it whenever
// the header merely contains `application/json`, so anything else here would reach
// Auth.js with an address the limits below never saw (SEC-040).
const formContentType = /^application\/x-www-form-urlencoded(\s*;\s*charset=utf-8)?$/i;
// An address, a password, a CSRF token and a callback URL, encoded (SEC-041). Every
// other Auth.js POST (sign-out, session update, sign-in start) is smaller still.
const maxAuthBodyBytes = 10_000;
// Auth.js sets this (chunked as .0, .1, … when large) only when a sign-in succeeded,
// and clears it (an empty value) only when a sign-out did.
const sessionCookie = /^(__Secure-)?authjs\.session-token(\.\d+)?=[^;]+/;
const clearedSessionCookie = /^(__Secure-)?authjs\.session-token(\.\d+)?=;/;

export async function POST(request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  const ip = getRateLimitClientIp(request);
  const signingOut = pathname.endsWith("/api/auth/signout");
  // Every Auth.js POST but sign-out (SEC-049). A budget shared by everyone behind
  // one address, or a limiter outage, must never keep a session alive (SEC-058).
  if (!signingOut) {
    const globalLimitResponse = await enforceRateLimit({ policy: "login_ip_global", request, keyParts: [ip] });
    if (globalLimitResponse) return globalLimitResponse;
  }

  // Read at most 10 KB before Auth.js parses anything, whatever the route (SEC-049).
  const body = await readBodyUpTo(request.clone(), maxAuthBodyBytes);
  if (body === null) return badRequest("Request body is too large");

  if (signingOut) return signOut(request);
  if (!pathname.endsWith("/api/auth/callback/credentials")) return nextAuthPost(request);

  if (!formContentType.test(request.headers.get("content-type") ?? "")) return badRequest("Sign in through the sign-in form");
  const formData = new URLSearchParams(body);
  // Auth.js signs in with the last "email" field while this throttle reads the first, so
  // duplicates could move each attempt into a fresh bucket (SEC-007). A form sends one.
  if (formData.getAll("email").length > 1) return badRequest("Send one email address");
  const submittedEmail = formData.get("email");
  const email = typeof submittedEmail === "string" ? submittedEmail.trim().toLowerCase() : "";
  if (!email) return badRequest("Enter your email address");
  // Per account across addresses, so guesses spread over many IPs still stop (DEBT-002);
  // a browser that signed in to it before counts on its own bucket alone (SEC-050), so
  // someone behind the same address can't spend its per-address budget either (SEC-063).
  const account = await signInAccount(email);
  const device = account ? knownDeviceId(request.cookies.get(knownDeviceCookie)?.value, account) : null;
  const accountLimitResponse = device
    ? await enforceRateLimit({ policy: "login_known_device", request, keyParts: [email, device] })
    : await enforceRateLimit({ policy: "login_ip_email", request, keyParts: [ip, email] }) ??
      await enforceRateLimit({ policy: "login_email", request, keyParts: [email] });
  if (accountLimitResponse) return accountLimitResponse;

  // Password checks run on the event loop: past the gate, refuse rather than queue (SEC-019).
  if (passwordWorkBusy()) return passwordBusyResponse();
  const response = await nextAuthPost(request);
  if (!account || !response.headers.getSetCookie().some((cookie) => sessionCookie.test(cookie))) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", knownDeviceSetCookie(account));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Signing out ends this login's staff MFA grant too, so a copied session token
// can't keep using it until it expires (#49). Only once Auth.js accepted the
// sign-out (its CSRF check passed and it cleared the session cookie).
async function signOut(request: NextRequest) {
  const token = await getToken({ req: request, secret: authSecret, secureCookie: publicOriginIsHttps(request.url) }).catch(() => null);
  const response = await nextAuthPost(request);
  if (!response.headers.getSetCookie().some((cookie) => clearedSessionCookie.test(cookie))) return response;
  await endLoginMfaGrant(typeof token?.staffMfaSessionId === "string" ? token.staffMfaSessionId : undefined);
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", knownDeviceClearCookie());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
