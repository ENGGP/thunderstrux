import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRequiredFiles = [
  "AGENTS.md",
  "README.md",
  "docs/THUNDERSTRUX_PRD.md",
  "docs/MVP_READINESS_PLAN.md",
  "docs/obsidian/Documentation Index.md",
  "docs/obsidian/Project Handover.md",
  "docs/obsidian/Engineering Delivery Workflow.md",
  "docs/obsidian/Non-Blocking Issue Register.md"
];

function walkMarkdown(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function withoutCode(text) {
  return text
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, "\n")
    .replace(/`[^`\n]*`/g, "");
}

function cleanTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  target = target.split(/\s+["']/)[0];
  target = target.split("#")[0].split("?")[0].trim();
  try {
    return { target: decodeURIComponent(target), invalidEncoding: false };
  } catch {
    return { target, invalidEncoding: true };
  }
}

function isExternal(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

export function collectReferences(text) {
  const content = withoutCode(text);
  const references = [];
  const wikiPattern = /!?\[\[([^\]]+)\]\]/g;
  const markdownPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = wikiPattern.exec(content))) {
    const cleaned = cleanTarget(match[1].split("|")[0]);
    if (cleaned.target) references.push({ kind: "wiki", ...cleaned });
  }
  while ((match = markdownPattern.exec(content))) {
    const cleaned = cleanTarget(match[1]);
    if (!isExternal(cleaned.target)) references.push({ kind: "markdown", ...cleaned });
  }
  return references;
}

function candidateFile(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;
  if (!extname(path) && existsSync(`${path}.md`)) return `${path}.md`;
  return null;
}

function staysWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && path !== ".." && !isAbsolute(path));
}

export function checkDocumentation({
  root = process.cwd(),
  requiredFiles = defaultRequiredFiles,
  sourceFiles
} = {}) {
  const absoluteRoot = resolve(root);
  const files = sourceFiles?.map((file) => resolve(absoluteRoot, file)) ?? [
    resolve(absoluteRoot, "AGENTS.md"),
    resolve(absoluteRoot, "README.md"),
    ...walkMarkdown(resolve(absoluteRoot, "docs"))
  ].filter(existsSync);
  const markdownFiles = walkMarkdown(resolve(absoluteRoot, "docs"));
  const byStem = new Map();

  for (const file of markdownFiles) {
    const stem = basename(file, ".md").toLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }

  const errors = [];
  for (const required of requiredFiles) {
    if (!existsSync(resolve(absoluteRoot, required))) {
      errors.push(`Required documentation file is missing: ${required}`);
    }
  }

  for (const file of files) {
    const relativeSource = normalize(file.slice(absoluteRoot.length + 1));
    for (const reference of collectReferences(readFileSync(file, "utf8"))) {
      if (reference.invalidEncoding) {
        errors.push(`${relativeSource}: invalid URI encoding in ${reference.kind} target '${reference.target}'`);
        continue;
      }
      if (reference.kind === "markdown" || reference.target.includes("/") || reference.target.includes("\\")) {
        const candidate = resolve(dirname(file), reference.target);
        if (!staysWithin(absoluteRoot, candidate)) {
          errors.push(`${relativeSource}: ${reference.kind} target escapes repository root '${reference.target}'`);
          continue;
        }
        const resolved = candidateFile(candidate);
        if (!resolved) errors.push(`${relativeSource}: missing ${reference.kind} target '${reference.target}'`);
        continue;
      }

      const matches = byStem.get(reference.target.toLowerCase()) ?? [];
      if (matches.length === 0) {
        errors.push(`${relativeSource}: missing wiki target '${reference.target}'`);
      } else if (matches.length > 1) {
        errors.push(`${relativeSource}: ambiguous wiki target '${reference.target}'`);
      }
    }
  }

  return { checkedFiles: files.length, errors };
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  const result = checkDocumentation();
  if (result.errors.length) {
    console.error(`Documentation check failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Documentation check passed (${result.checkedFiles} files).`);
  }
}
