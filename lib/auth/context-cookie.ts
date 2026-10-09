import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/auth";

export const contextCookieName = "thunderstrux-context";
export type ContextSelection = { mode: "personal" } | { mode: "staff"; organisationId: string };
type Identity = { id: string; authVersion: number; mfaSessionId?: string };
export function encodeContext(selection: ContextSelection, user: Identity) {
  const body = Buffer.from(JSON.stringify({ ...selection, userId: user.id, version: user.authVersion,
    login: user.mfaSessionId })).toString("base64url");
  const signature = createHmac("sha256", authSecret).update(`context:v1:${body}`).digest("hex");
  return `${body}.${signature}`;
}
export function decodeContext(raw: string | undefined, user: Identity): ContextSelection | null {
  if (!raw || raw.length > 2000 || !user.mfaSessionId) return null;
  const [body, signature, extra] = raw.split(".");
  if (extra || !body || !/^[a-f0-9]{64}$/.test(signature ?? "")) return null;
  const expected = createHmac("sha256", authSecret).update(`context:v1:${body}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (value.userId !== user.id || value.version !== user.authVersion || value.login !== user.mfaSessionId) return null;
    if (value.mode === "personal") return { mode: "personal" };
    if (value.mode === "staff" && typeof value.organisationId === "string" && value.organisationId.length <= 100)
      return { mode: "staff", organisationId: value.organisationId };
  } catch { /* Invalid preferences do not grant authority. */ }
  return null;
}
