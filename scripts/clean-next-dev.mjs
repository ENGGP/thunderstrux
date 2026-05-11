import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const volatileNextPaths = [
  resolve(process.cwd(), ".next", "dev"),
  resolve(process.cwd(), ".next", "types")
];

for (const volatilePath of volatileNextPaths) {
  const nextDirPath = dirname(volatilePath);

  if (
    !["dev", "types"].includes(basename(volatilePath)) ||
    basename(nextDirPath) !== ".next"
  ) {
    throw new Error(`Refusing to clear unexpected Next.js cache path: ${volatilePath}`);
  }
}

try {
  for (const volatilePath of volatileNextPaths) {
    rmSync(volatilePath, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100
    });
  }
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;

  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
    console.warn(
      [
        "Unable to clear volatile Next.js cache paths: .next/dev and .next/types.",
        "A stale Next.js or Node process may still have files open.",
        "Continuing startup so Docker dev is not blocked.",
        "If route manifests look stale, stop local Node/Next processes and restart Docker.",
        "",
        "This script only removes volatile .next paths and never removes .next-build."
      ].join("\n")
    );
    process.exit(0);
  }

  throw error;
}
