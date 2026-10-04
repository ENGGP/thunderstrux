import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { accountTokenDigest } from "./account-lifecycle";
export function lifecycleIpLimit(request: Request) {
  return enforceRateLimit({ policy: "signup_ip", request, keyParts: [getRateLimitClientIp(request)], required: true });
}
export function lifecycleEmailLimit(request: Request, email: string) {
  return enforceRateLimit({ policy: "signup_email", request, keyParts: [email.trim().toLowerCase()], required: true });
}
export async function lifecycleRedemptionLimit(request: Request, raw: string) {
  return await enforceRateLimit({ policy: "account_token_ip", request, keyParts: [getRateLimitClientIp(request)], required: true }) ??
    await enforceRateLimit({ policy: "account_token_digest", request, keyParts: [accountTokenDigest(raw)], required: true });
}
