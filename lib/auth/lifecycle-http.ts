import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { accountTokenDigest } from "./account-lifecycle";
export function lifecycleIpLimit(request: Request) {
  return enforceRateLimit({ policy: "signup_ip", request, keyParts: [getRateLimitClientIp(request)], required: true });
}
// One bucket per purpose (SEC-026): requests that send nothing, such as a signup for an
// existing address, must not use up the owner's password-reset budget.
export function lifecycleEmailLimit(request: Request, email: string, purpose: "signup" | "verification" | "password_reset") {
  return enforceRateLimit({ policy: "signup_email", request, keyParts: [purpose, email.trim().toLowerCase()], required: true });
}
export async function lifecycleRedemptionLimit(request: Request, raw: string) {
  return await enforceRateLimit({ policy: "account_token_ip", request, keyParts: [getRateLimitClientIp(request)], required: true }) ??
    await enforceRateLimit({ policy: "account_token_digest", request, keyParts: [accountTokenDigest(raw)], required: true });
}
