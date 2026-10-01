import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateHostedConfig } from "./container-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envIndex = process.argv.indexOf("--env-file");
const envFile = envIndex === -1 ? null : process.argv[envIndex + 1];
if (!envFile || envFile.startsWith("--")) {
  throw new Error("Use --env-file <secret-free hosted configuration file>");
}

const result = spawnSync(
  process.platform === "win32" ? "docker.exe" : "docker",
  [
    "compose",
    "--env-file", resolve(root, envFile),
    "-f", resolve(root, "docker-compose.hosted.yml"),
    "--profile", "tools",
    "--profile", "workers",
    "config", "--format", "json"
  ],
  { cwd: root, encoding: "utf8", shell: false }
);
if (result.status !== 0) {
  throw new Error(`Hosted Compose validation failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`);
}

validateHostedConfig(JSON.parse(result.stdout));
console.log("Hosted Compose contract is valid");
