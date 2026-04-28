import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  ".next-build/types/**/*.ts",
  ".next-build/dev/types/**/*.ts"
];

tsconfig.include = [
  ...new Set([
    ...include.filter((item) => !blockedIncludes.has(item)),
    ...requiredIncludes
  ])
];

writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
