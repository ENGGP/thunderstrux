import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class NotificationConfigurationError extends Error {}

function key() {
  const encoded = process.env.NOTIFICATION_ENCRYPTION_KEY ?? "";
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== encoded) {
    throw new NotificationConfigurationError("NOTIFICATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return bytes;
}

export function assertNotificationConfiguration() { key(); }

export function encryptNotification(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptNotification(value: string, context: string): unknown {
  const [version, iv, tag, ciphertext, extra] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid notification envelope");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext, "base64url")), cipher.final()]).toString("utf8"));
}
