import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { badRequest } from "@/lib/api/errors";
import { readBodyUpTo } from "@/lib/api/request";

export const { GET } = handlers;

const nextAuthPost = handlers.POST;

// The app's sign-in posts a form. Auth.js also reads JSON, and picks it whenever
// the header merely contains `application/json`, so anything else here would reach
// Auth.js with an address the limits below never saw (SEC-040).
const formContentType = /^application\/x-www-form-urlencoded(\s*;\s*charset=utf-8)?$/i;
// An address, a password, a CSRF token and a callback URL, encoded (SEC-041).
const maxSignInBodyBytes = 10_000;

export async function POST(request: NextRequest) {
  const pathname = new URL(request.url).pathname;

  if (pathname.endsWith("/api/auth/callback/credentials")) {
    const ip = getRateLimitClientIp(request);
    const globalLimitResponse = await enforceRateLimit({
      policy: "login_ip_global",
      request,
      keyParts: [ip]
    });

    if (globalLimitResponse) {
      return globalLimitResponse;
    }

    if (!formContentType.test(request.headers.get("content-type") ?? "")) return badRequest("Sign in through the sign-in form");

    const body = await readBodyUpTo(request.clone(), maxSignInBodyBytes);
    if (body === null) return badRequest("Request body is too large");
    const formData = new URLSearchParams(body);
    // Auth.js signs in with the last "email" field while this throttle reads the first, so
    // duplicates could move each attempt into a fresh bucket (SEC-007). A form sends one.
    if (formData.getAll("email").length > 1) return badRequest("Send one email address");
    const submittedEmail = formData.get("email");
    const email =
      typeof submittedEmail === "string" ? submittedEmail.trim().toLowerCase() : "";
    if (!email) return badRequest("Enter your email address");
    const emailLimitResponse = await enforceRateLimit({
      policy: "login_ip_email",
      request,
      keyParts: [ip, email]
    });

    if (emailLimitResponse) {
      return emailLimitResponse;
    }

    // Per account across addresses, so guesses spread over many IPs still stop (DEBT-002).
    const accountLimitResponse = await enforceRateLimit({ policy: "login_email", request, keyParts: [email] });

    if (accountLimitResponse) {
      return accountLimitResponse;
    }
  }

  return nextAuthPost(request);
}
