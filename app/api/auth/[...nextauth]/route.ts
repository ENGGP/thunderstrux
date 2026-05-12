import { handlers } from "@/auth";
import type { NextRequest } from "next/server";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";

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
  }

  return nextAuthPost(request);
}
