import { rmSync } from "node:fs";
import { join } from "node:path";

const devCachePath = join(process.cwd(), ".next", "dev");

try {
  rmSync(devCachePath, {
    force: true,
    recursive: true
  });
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;

  if (code === "EPERM" || code === "EBUSY") {
    console.error(
      [
        `Unable to clear ${devCachePath}.`,
        "A stale Next.js or Node process may still have files open.",
        "Stop local Node/Next processes or run: docker compose restart app"
      ].join("\n")
    );
  }

  throw error;
}
