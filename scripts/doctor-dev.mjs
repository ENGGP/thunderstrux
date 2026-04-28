import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

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

const devCacheExists = pathExists(".next", "dev");
const appManifestExists = pathExists(".next", "dev", "server", "app-paths-manifest.json");
const devRoutesTypesExist = pathExists(".next", "dev", "types", "routes.d.ts");
const buildCacheExists = pathExists(".next-build");
const proxyExists = pathExists("proxy.ts");
const middlewareExists = pathExists("middleware.ts");
const tsconfig = readJson("tsconfig.json");
const tsIncludes = Array.isArray(tsconfig?.include) ? tsconfig.include : [];
const hasStaleDevTypes = tsIncludes.includes(".next/dev/types/**/*.ts");

checks.push(`.next/dev cache: ${devCacheExists ? "present" : "not present"}`);
checks.push(`dev app manifest: ${appManifestExists ? "present" : "missing"}`);
checks.push(`dev route types: ${devRoutesTypesExist ? "present" : "missing"}`);
checks.push(`.next-build output: ${buildCacheExists ? "present" : "not present"}`);
checks.push(`proxy.ts route guard: ${proxyExists ? "present" : "missing"}`);
checks.push(`middleware.ts legacy file: ${middlewareExists ? "present" : "not present"}`);
checks.push(`tsconfig stale .next/dev include: ${hasStaleDevTypes ? "present" : "not present"}`);

if (devCacheExists && (!appManifestExists || !devRoutesTypesExist)) {
  suggestions.push("Dev cache looks incomplete. Run: docker compose restart app");
  suggestions.push("If the route manifest remains stale, run inside the app container: pnpm dev");
}

if (hasStaleDevTypes) {
  suggestions.push("Stale dev type include found. Run: docker compose exec app pnpm build");
}

if (middlewareExists) {
  suggestions.push("Next 16 uses proxy.ts. Remove middleware.ts only if it is not intentionally kept for reference.");
}

const portOpen = await checkPort("127.0.0.1", 3000);
checks.push(`localhost:3000: ${portOpen ? "accepting connections" : "not accepting connections"}`);

if (!portOpen) {
  suggestions.push("Dev server is not reachable. Run: docker compose up -d");
}

console.log(["Thunderstrux dev environment report", "", ...checks.map((check) => `- ${check}`)].join("\n"));

if (suggestions.length > 0) {
  console.log(["", "Suggested next steps:", ...suggestions.map((step) => `- ${step}`)].join("\n"));
} else {
  console.log("\nNo obvious dev environment issue detected.");
}
