import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const devCachePath = resolve(process.cwd(), ".next", "dev");
const nextDirPath = dirname(devCachePath);

if (basename(devCachePath) !== "dev" || basename(nextDirPath) !== ".next") {
  throw new Error(`Refusing to clear unexpected Next.js dev cache path: ${devCachePath}`);
}

try {
  rmSync(devCachePath, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 100
  });
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;

  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
    console.warn(
      [
        `Unable to clear ${devCachePath}.`,
        "A stale Next.js or Node process may still have files open.",
        "Continuing startup so Docker dev is not blocked.",
        "If route manifests look stale, stop local Node/Next processes and restart Docker.",
        "",
        "This script only removes .next/dev and never removes .next-build."
      ].join("\n")
    );
    process.exit(0);
  }

  throw error;
}
