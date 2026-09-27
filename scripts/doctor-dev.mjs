import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { join } from "node:path";
import {
  isValidMfaEncryptionKey,
  migrationStatusIsCurrent,
  startupAppliesMigrations
} from "./dev-doctor-guards.mjs";

const projectRoot = process.cwd();

function pathExists(...parts) {
  return existsSync(join(projectRoot, ...parts));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(projectRoot, path), "utf8"));
  } catch {
    return null;
  }
}

function checkPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (open) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const checks = [];
const suggestions = [];
const recreateCommand =
  "pnpm docker:restart";

const devCacheExists = pathExists(".next", "dev");
const appManifestExists = pathExists(".next", "dev", "server", "app-paths-manifest.json");
const devRoutesTypesExist = pathExists(".next", "dev", "types", "routes.d.ts");
const buildCacheExists = pathExists(".next-build");
const proxyExists = pathExists("proxy.ts");
const middlewareExists = pathExists("middleware.ts");
const tsconfig = readJson("tsconfig.json");
const tsIncludes = Array.isArray(tsconfig?.include) ? tsconfig.include : [];
const hasVolatileNextTypes =
  tsIncludes.includes(".next/types/**/*.ts") ||
  tsIncludes.includes(".next/dev/types/**/*.ts");

checks.push(`.next/dev cache: ${devCacheExists ? "present" : "not present"}`);
checks.push(`dev app manifest: ${appManifestExists ? "present" : "missing"}`);
checks.push(`dev route types: ${devRoutesTypesExist ? "present" : "missing"}`);
checks.push(`.next-build output: ${buildCacheExists ? "present" : "not present"}`);
checks.push(`proxy.ts route guard: ${proxyExists ? "present" : "missing"}`);
checks.push(`middleware.ts legacy file: ${middlewareExists ? "present" : "not present"}`);
checks.push(`tsconfig volatile .next type includes: ${hasVolatileNextTypes ? "present" : "not present"}`);

if (devCacheExists && (!appManifestExists || !devRoutesTypesExist)) {
  suggestions.push(`Dev cache looks incomplete. Run: ${recreateCommand}`);
  suggestions.push("If the route manifest remains stale, run inside the app container: pnpm dev");
}

if (hasVolatileNextTypes) {
  suggestions.push("Volatile .next type include found. Remove .next type includes from tsconfig and rely on .next-build route types.");
}

if (middlewareExists) {
  suggestions.push("Next 16 uses proxy.ts. Remove middleware.ts only if it is not intentionally kept for reference.");
}

const portOpen = await checkPort("127.0.0.1", 3000);
checks.push(`localhost:3000: ${portOpen ? "accepting connections" : "not accepting connections"}`);

if (!portOpen) {
  suggestions.push(`Dev server is not reachable. Run: ${recreateCommand}`);
}

if (process.env.THUNDERSTRUX_RUNTIME_CONTAINER !== undefined &&
    process.platform !== "win32" && existsSync("/proc/1/cmdline")) {
  const pidOneCommand = readFileSync("/proc/1/cmdline", "utf8").replaceAll("\0", " ").trim();
  const appliesMigrations = startupAppliesMigrations(pidOneCommand);
  checks.push(`container startup applies migrations: ${appliesMigrations ? "yes" : "no"}`);
  if (!appliesMigrations) suggestions.push(`Running app command is stale. Run: ${recreateCommand}`);
}

const migrationStatus = spawnSync("pnpm", ["prisma", "migrate", "status"], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
  shell: process.platform === "win32"
});
const migrationOutput = `${migrationStatus.stdout || ""}\n${migrationStatus.stderr || ""}`;
const migrationsCurrent = migrationStatusIsCurrent(migrationStatus.status, migrationOutput);
checks.push(`database migrations: ${migrationsCurrent ? "up to date" : "pending, failed, or unavailable"}`);
if (!migrationsCurrent) suggestions.push(`Check migration output, then run: ${recreateCommand}`);

const mfaMode = process.env.MFA_ENFORCEMENT_MODE || (process.env.NODE_ENV === "production" ? "unset" : "off");
const mfaKey = process.env.MFA_ENCRYPTION_KEY || "";
const mfaKeyValid = isValidMfaEncryptionKey(mfaKey);
checks.push(`MFA mode: ${mfaMode}`);
checks.push(`MFA encryption key: ${mfaKeyValid ? "valid 32-byte key configured" : "missing or invalid"}`);
checks.push(`Redis-backed rate limiting: ${process.env.RATE_LIMIT_ENABLED === "true" ? "enabled" : "disabled"}`);
if (mfaMode !== "off" && (!mfaKeyValid || process.env.RATE_LIMIT_ENABLED !== "true")) {
  suggestions.push("MFA enroll/enforce mode requires a valid 32-byte base64 key and RATE_LIMIT_ENABLED=true.");
}

console.log(["Thunderstrux dev environment report", "", ...checks.map((check) => `- ${check}`)].join("\n"));

if (suggestions.length > 0) {
  console.log(["", "Suggested next steps:", ...suggestions.map((step) => `- ${step}`)].join("\n"));
} else {
  console.log("\nNo obvious dev environment issue detected.");
}
