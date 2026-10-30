import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { badRequest } from "@/lib/api/errors";

export const { GET } = handlers;

const nextAuthPost = handlers.POST;

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

    const formData = await request
      .clone()
      .formData()
      .catch(() => new FormData());
    // Auth.js signs in with the last "email" field while this throttle reads the first, so
    // duplicates could move each attempt into a fresh bucket (SEC-007). A form sends one.
    if (formData.getAll("email").length > 1) return badRequest("Send one email address");
    const submittedEmail = formData.get("email");
    const email =
      typeof submittedEmail === "string" ? submittedEmail.trim().toLowerCase() : "";
    const emailLimitResponse = await enforceRateLimit({
      policy: "login_ip_email",
      request,
      keyParts: [ip, email]
    });

    if (emailLimitResponse) {
      return emailLimitResponse;
    }

    // Per account across addresses, so guesses spread over many IPs still stop (DEBT-002).
    const accountLimitResponse = email
      ? await enforceRateLimit({ policy: "login_email", request, keyParts: [email] })
      : null;

    if (accountLimitResponse) {
      return accountLimitResponse;
    }
  }

  return nextAuthPost(request);
}
