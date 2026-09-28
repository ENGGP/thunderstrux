export function startupAppliesMigrations(command) {
  const migrationIndex = command.indexOf("prisma:migrate:deploy");
  const devServerIndex = command.indexOf("pnpm dev");
  return migrationIndex >= 0 && devServerIndex > migrationIndex;
}

export function migrationStatusIsCurrent(status, output) {
  return status === 0 && /Database schema is up to date/i.test(output);
}

export function isValidMfaEncryptionKey(encoded) {
  try {
    const key = Buffer.from(encoded, "base64");
    return key.length === 32 && key.toString("base64") === encoded;
  } catch {
    return false;
  }
}
