import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const periodMs = 30_000;
const pendingLifetimeMs = 10 * 60_000;
const grantLifetimeMs = 12 * 60 * 60_000;

export class MfaRequiredError extends Error {
  constructor(message = "Staff MFA verification required") {
    super(message);
    this.name = "MfaRequiredError";
  }
}

export class MfaInputError extends Error {}
export class MfaConfigurationError extends Error {}

export function mfaEnforcementMode() {
  const mode = process.env.MFA_ENFORCEMENT_MODE ||
    (process.env.NODE_ENV === "production" ? "unset" : "off");
  if (mode !== "off" && mode !== "enroll" && mode !== "enforce") {
    throw new MfaConfigurationError("MFA_ENFORCEMENT_MODE must be set to off, enroll, or enforce");
  }
  return mode;
}

export function assertStaffMfaMutationConfiguration() {
  encryptionKey();
  if (process.env.RATE_LIMIT_ENABLED !== "true") {
    throw new MfaConfigurationError("RATE_LIMIT_ENABLED=true is required for staff MFA operations");
  }
}

function encryptionKey() {
  const encoded = process.env.MFA_ENCRYPTION_KEY || "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new MfaConfigurationError("MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function assertStaffMfaConfiguration() {
  if (mfaEnforcementMode() !== "off") assertStaffMfaMutationConfiguration();
}

function encrypt(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid encrypted MFA secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(text: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text.toUpperCase().replace(/=+$/, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new MfaInputError("Invalid authenticator secret");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function acceptedStep(secret: string, code: string, now: Date, lastStep: bigint | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now.getTime() / periodMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && BigInt(step) <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

function recoveryHash(userId: string, code: string) {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHmac("sha256", encryptionKey()).update(`recovery:v1:${userId}:${normalized}`).digest("hex");
}

async function requireStaffEligibility(userId: string) {
  const active = await prisma.organisationStaff.findFirst({
    where: { userId, status: "active" }, select: { id: true }
  });
  if (active) return;
  const legacy = await prisma.organisation.findFirst({
    where: { accountUserId: userId, staff: { none: { userId } } }, select: { id: true }
  });
  if (!legacy) throw new MfaInputError("Staff access is required for MFA setup");
}

async function auditStaffMfa(tx: Prisma.TransactionClient, userId: string, action: string) {
  const [staff, legacy] = await Promise.all([
    tx.organisationStaff.findMany({ where: { userId, status: "active" },
      select: { organisationId: true } }),
    tx.organisation.findMany({ where: { accountUserId: userId, staff: { none: { userId } } },
      select: { id: true } })
  ]);
  const organisationIds = new Set([...staff.map((row) => row.organisationId),
    ...legacy.map((row) => row.id)]);
  if (organisationIds.size > 0) {
    await tx.auditLog.createMany({ data: [...organisationIds].map((organisationId) => ({
      organisationId, actorUserId: userId, action, targetType: "User", targetId: userId
    })) });
  }
}

export async function getStaffMfaStatus(userId: string) {
  await requireStaffEligibility(userId);
  const mfa = await prisma.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
  return { enabled: Boolean(mfa?.enabledAt), mode: mfaEnforcementMode() };
}

export async function beginStaffMfaEnrollment(userId: string, email: string, now = new Date()) {
  await requireStaffEligibility(userId);
  const existing = await prisma.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
  if (existing?.enabledAt) throw new MfaInputError("MFA is already enabled");
  const secret = base32Encode(randomBytes(20));
  await prisma.userMfa.upsert({
    where: { userId },
    create: { userId, pendingEncryptedSecret: encrypt(secret),
      pendingExpiresAt: new Date(now.getTime() + pendingLifetimeMs) },
    update: { pendingEncryptedSecret: encrypt(secret),
      pendingExpiresAt: new Date(now.getTime() + pendingLifetimeMs) }
  });
  const label = encodeURIComponent(`Thunderstrux:${email}`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Thunderstrux&algorithm=SHA1&digits=6&period=30` };
}

export async function confirmStaffMfaEnrollment(userId: string, code: string, sessionDigest: string, now = new Date()) {
  if (!/^\d{6}$/.test(code)) throw new MfaInputError("Invalid authenticator code");
  await requireStaffEligibility(userId);
  const mfa = await prisma.userMfa.findUnique({ where: { userId } });
  if (!mfa?.pendingEncryptedSecret || !mfa.pendingExpiresAt || mfa.pendingExpiresAt <= now || mfa.enabledAt) {
    throw new MfaInputError("MFA setup expired; start again");
  }
  const step = acceptedStep(decrypt(mfa.pendingEncryptedSecret), code, now, null);
  if (step === null) throw new MfaInputError("Invalid authenticator code");
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(10).toString("hex").toUpperCase());
  await prisma.$transaction(async (tx) => {
    const updated = await tx.userMfa.updateMany({
      where: { userId, enabledAt: null, pendingEncryptedSecret: mfa.pendingEncryptedSecret,
        pendingExpiresAt: { gt: now } },
      data: { encryptedSecret: mfa.pendingEncryptedSecret, pendingEncryptedSecret: null,
        pendingExpiresAt: null, enabledAt: now, lastAcceptedStep: BigInt(step) }
    });
    if (updated.count !== 1) throw new MfaInputError("MFA setup changed; start again");
    await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map((entry) => ({
      userId, codeHash: recoveryHash(userId, entry)
    })) });
    await tx.mfaGrant.upsert({ where: { sessionDigest },
      create: { sessionDigest, userId, verifiedAt: now, expiresAt: new Date(now.getTime() + grantLifetimeMs) },
      update: { userId, verifiedAt: now, expiresAt: new Date(now.getTime() + grantLifetimeMs) } });
    await auditStaffMfa(tx, userId, "staff_mfa.enabled");
  });
  return { recoveryCodes };
}

export async function verifyStaffMfa(userId: string, code: string, sessionDigest: string, now = new Date()) {
  const recoveryCode = code.toUpperCase().replace(/-/g, "");
  if (!/^\d{6}$/.test(code) && (code.length > 32 || !/^[A-F0-9]{20}$/.test(recoveryCode))) {
    throw new MfaInputError("Invalid MFA or recovery code");
  }
  await requireStaffEligibility(userId);
  const mfa = await prisma.userMfa.findUnique({ where: { userId } });
  if (!mfa?.enabledAt || !mfa.encryptedSecret) throw new MfaRequiredError("Staff MFA enrollment required");
  const step = acceptedStep(decrypt(mfa.encryptedSecret), code, now, mfa.lastAcceptedStep);
  const codeHash = /^\d{6}$/.test(code) ? null : recoveryHash(userId, recoveryCode);
  await prisma.$transaction(async (tx) => {
    if (step !== null) {
      const changed = await tx.userMfa.updateMany({ where: { userId,
        OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: BigInt(step) } }] },
        data: { lastAcceptedStep: BigInt(step) } });
      if (changed.count !== 1) throw new MfaInputError("Authenticator code was already used");
    } else {
      if (!codeHash) throw new MfaInputError("Invalid MFA or recovery code");
      const deleted = await tx.mfaRecoveryCode.deleteMany({ where: { userId, codeHash } });
      if (deleted.count !== 1) throw new MfaInputError("Invalid MFA or recovery code");
    }
    await tx.mfaGrant.upsert({ where: { sessionDigest },
      create: { sessionDigest, userId, verifiedAt: now, expiresAt: new Date(now.getTime() + grantLifetimeMs) },
      update: { userId, verifiedAt: now, expiresAt: new Date(now.getTime() + grantLifetimeMs) } });
    await auditStaffMfa(tx, userId, step === null ? "staff_mfa.recovery_used" : "staff_mfa.verified");
  });
}

export async function requireStaffMfa(userId: string, sessionDigest: string | null, now = new Date()) {
  const mode = mfaEnforcementMode();
  if (mode === "off") return;
  assertStaffMfaConfiguration();
  const mfa = await prisma.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
  if (!mfa?.enabledAt) {
    if (mode === "enroll") return;
    throw new MfaRequiredError("Staff MFA enrollment required");
  }
  if (!sessionDigest) throw new MfaRequiredError();
  const grant = await prisma.mfaGrant.findUnique({ where: { sessionDigest },
    select: { userId: true, expiresAt: true } });
  if (grant?.userId !== userId || grant.expiresAt <= now) throw new MfaRequiredError();
}

export async function deleteExpiredMfaGrants(now = new Date(), limit = 500, dryRun = false) {
  const expired = await prisma.mfaGrant.findMany({
    where: { expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" },
    take: limit, select: { sessionDigest: true }
  });
  if (expired.length === 0) return 0;
  if (dryRun) return 0;
  const result = await prisma.mfaGrant.deleteMany({ where: {
    sessionDigest: { in: expired.map((grant) => grant.sessionDigest) },
    expiresAt: { lte: now }
  } });
  return result.count;
}
