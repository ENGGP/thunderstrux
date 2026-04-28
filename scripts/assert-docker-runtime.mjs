import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readDotenvDatabaseUrl() {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return "";
  }

  const match = readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.*)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

const databaseUrl = process.env.DATABASE_URL || readDotenvDatabaseUrl();
const usesDockerDatabaseHost = /@db:5432\//.test(databaseUrl);
const isDockerRuntime =
  existsSync("/.dockerenv") || process.env.THUNDERSTRUX_ALLOW_HOST_DEV === "1";

if (usesDockerDatabaseHost && !isDockerRuntime) {
  console.error(
    [
      "Thunderstrux dev must run inside Docker when DATABASE_URL uses db:5432.",
      "Use: docker compose up -d",
      "Then open: http://localhost:3000",
      "",
      "Host next dev is unsupported with the Docker .env because db only resolves inside the Compose network.",
      "For one-off host debugging, set THUNDERSTRUX_ALLOW_HOST_DEV=1 and use a localhost DATABASE_URL."
    ].join("\n")
  );
  process.exit(1);
}
