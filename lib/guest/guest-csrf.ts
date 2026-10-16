import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/auth";

// Kept apart from guest-access so the workers that load guest links never
// need the auth secret.
export const GUEST_CSRF_HEADER = "x-thunderstrux-guest-csrf";

// The guest session's own CSRF token, bound to the session id (not the login cookie).
export function guestCsrfToken(sessionId: string) {
  return createHmac("sha256", authSecret).update(`guest-csrf:v1:${sessionId}`).digest("hex");
}

export function verifyGuestCsrf(sessionId: string, supplied: string | null) {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(guestCsrfToken(sessionId), "hex"));
}
