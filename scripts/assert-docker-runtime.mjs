import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const shouldBlockNextDev = process.argv.includes("--block-next-dev");

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
  const message = [
    "Thunderstrux is configured for Docker-first development.",
    "DATABASE_URL uses db:5432, which only resolves inside the Docker Compose network.",
    "",
    "Use: docker compose up -d",
    "Then open: http://localhost:3000",
    "",
    "If the app shows a database connection error, make sure the Docker stack is running:",
    "  docker compose ps",
    "  docker compose logs --tail=80 app",
    "",
    "For one-off host debugging only, set THUNDERSTRUX_ALLOW_HOST_DEV=1 and use a localhost DATABASE_URL."
  ].join("\n");

  if (shouldBlockNextDev) {
    console.error(message);
    process.exit(1);
  }

  console.warn(message);
}
