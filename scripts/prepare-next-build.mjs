import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (
  process.env.NODE_ENV === "production" &&
  process.env.THUNDERSTRUX_RUNTIME_CONTAINER === "true"
) {
  throw new Error(
    "Do not run pnpm build inside a running container. Rebuild using docker compose."
  );
}

const projectRoot = process.cwd();
const tsconfigPath = join(projectRoot, "tsconfig.json");

const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
const blockedIncludes = new Set([
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts"
]);
const requiredIncludes = [
  "next-env.d.ts",
  "**/*.ts",
  "**/*.tsx",
  ".next-build/types/**/*.ts"
];

tsconfig.include = [
  ...new Set([
    ...include.filter((item) => !blockedIncludes.has(item)),
    ...requiredIncludes
  ])
];

writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
