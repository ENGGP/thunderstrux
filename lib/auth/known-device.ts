import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/lib/auth/secret";
import { appCookieSecure } from "@/lib/auth/public-origin";

// SEC-050 (C7): anonymous wrong passwords fill an account's login_email bucket and
// would lock its owner out too. A browser that signed in before carries this cookie,
// bound to the account, its address and its authVersion, and counts on its own bucket
// (login_known_device) instead. A password reset, email change, closure or support
// sign-out bumps authVersion, which ends it.
export const knownDeviceCookie = "thunderstrux-known-device";
const path = "/api/auth/callback/credentials";
const maxAgeSeconds = 365 * 86_400;

type Account = { id: string; email: string; authVersion: number };
// The user id too, so a cookie never carries over to a new account that reuses a closed one's address.
const sign = (account: Account, nonce: string) =>
  createHmac("sha256", authSecret).update(`known-device:v1:${account.id}:${account.email}:${account.authVersion}:${nonce}`).digest("base64url");

// Set-Cookie for a browser that just signed in as this account.
export function knownDeviceSetCookie(account: Account) {
  const nonce = randomBytes(16).toString("base64url");
  return `${knownDeviceCookie}=${nonce}.${sign(account, nonce)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${appCookieSecure() ? "; Secure" : ""}`;
}

// The device's id when the cookie was issued for this account at its current address and authVersion, else null.
export function knownDeviceId(raw: string | undefined, account: Account) {
  const [nonce, signature, extra] = (raw ?? "").split(".");
  if (extra !== undefined || !nonce || !signature || !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return null;
  const expected = Buffer.from(sign(account, nonce));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? nonce : null;
}
