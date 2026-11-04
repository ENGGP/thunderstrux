import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/lib/auth/secret";
import { appCookieSecure } from "@/lib/auth/public-origin";

// SEC-050 (C7): anonymous wrong passwords fill an account's login_email bucket and
// would lock its owner out too. A browser that signed in before carries this cookie,
// bound to the address and the account's authVersion, and counts on its own bucket
// (login_known_device) instead. A password reset, email change, closure or support
// sign-out bumps authVersion, which ends it.
export const knownDeviceCookie = "thunderstrux-known-device";
const path = "/api/auth/callback/credentials";
const maxAgeSeconds = 365 * 86_400;

const sign = (email: string, authVersion: number, nonce: string) =>
  createHmac("sha256", authSecret).update(`known-device:v1:${email}:${authVersion}:${nonce}`).digest("base64url");

// Set-Cookie for a browser that just signed in as this account.
export function knownDeviceSetCookie(email: string, authVersion: number) {
  const nonce = randomBytes(16).toString("base64url");
  return `${knownDeviceCookie}=${nonce}.${sign(email, authVersion, nonce)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${appCookieSecure() ? "; Secure" : ""}`;
}

// The device's id when the cookie was issued for this address at its current authVersion, else null.
export function knownDeviceId(raw: string | undefined, email: string, authVersion: number) {
  const [nonce, signature, extra] = (raw ?? "").split(".");
  if (extra !== undefined || !nonce || !signature || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return null;
  const expected = Buffer.from(sign(email, authVersion, nonce));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? nonce : null;
}
