import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultRequiredFiles = [
  "AGENTS.md",
  "README.md",
  "docs/THUNDERSTRUX_PRD.md",
  "docs/MVP_READINESS_PLAN.md",
  "docs/obsidian/Documentation Index.md",
  "docs/obsidian/Project Handover.md",
  "docs/obsidian/Engineering Delivery Workflow.md",
  "docs/obsidian/Issue and Defect Register.md"
];

// The Obsidian vault is docs/; living notes are docs/obsidian/*.md (History/ holds dated notes).
const vaultDirectory = "docs";
const livingDirectory = "docs/obsidian";
// One Read of a note must return all of it.
const maxLivingNoteBytes = 32 * 1024;

function walkMarkdown(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function walkFiles(directory, name) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path, name);
    return entry.isFile() && (name === undefined || name(entry.name)) ? [path] : [];
  });
}

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const withoutFences = (text) => text.replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, "\n");

function withoutCode(text) {
  return withoutFences(text).replace(/`[^`\n]*`/g, "");
}

function cleanTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  target = target.split(/\s+["']/)[0];
  const [path, ...anchorParts] = target.split("#");
  const anchor = anchorParts.at(-1)?.trim() || undefined;
  target = path.split("?")[0].trim();
  try {
    return { target: decodeURIComponent(target), anchor, invalidEncoding: false };
  } catch {
    return { target, anchor, invalidEncoding: true };
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
    // Inside a table Obsidian escapes the alias pipe as `\|`.
    const cleaned = cleanTarget(match[1].split(/\\?\|/)[0]);
    if (cleaned.target || cleaned.anchor) references.push({ kind: "wiki", ...cleaned });
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

function headings(file) {
  return withoutFences(read(file).replace(/^---\n[\s\S]*?\n---\n/, ""))
    .split("\n")
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim());
}

// Obsidian matches a heading by its text; GitHub-style Markdown anchors use the slug.
const headingText = (value) => value.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const headingSlug = (value) => headingText(value).replace(/[^\w\- ]/g, "").replace(/ /g, "-");

function anchorExists(file, reference) {
  if (!reference.anchor || reference.anchor.startsWith("^") || !file.endsWith(".md")) return true;
  const known = headings(file);
  return reference.kind === "wiki"
    ? known.some((heading) => headingText(heading) === headingText(reference.anchor))
    : known.some((heading) => headingSlug(heading) === reference.anchor.toLowerCase());
}

export function checkDocumentation({
  root = process.cwd(),
  requiredFiles = defaultRequiredFiles,
  sourceFiles,
  vault = vaultDirectory
} = {}) {
  const absoluteRoot = resolve(root);
  const absoluteVault = resolve(absoluteRoot, vault);
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
    const inVault = staysWithin(absoluteVault, file);
    for (const reference of collectReferences(readFileSync(file, "utf8"))) {
      if (reference.invalidEncoding) {
        errors.push(`${relativeSource}: invalid URI encoding in ${reference.kind} target '${reference.target}'`);
        continue;
      }
      let resolved;
      if (!reference.target) {
        resolved = file;
      } else if (reference.kind === "markdown" || reference.target.includes("/") || reference.target.includes("\\")) {
        const candidate = resolve(dirname(file), reference.target);
        if (!staysWithin(absoluteRoot, candidate)) {
          errors.push(`${relativeSource}: ${reference.kind} target escapes repository root '${reference.target}'`);
          continue;
        }
        if (inVault && !staysWithin(absoluteVault, candidate)) {
          errors.push(`${relativeSource}: ${reference.kind} target leaves the Obsidian vault (${vault}/) '${reference.target}'`);
          continue;
        }
        resolved = candidateFile(candidate);
        if (!resolved) {
          errors.push(`${relativeSource}: missing ${reference.kind} target '${reference.target}'`);
          continue;
        }
      } else {
        const matches = byStem.get(reference.target.toLowerCase()) ?? [];
        if (matches.length === 0) {
          errors.push(`${relativeSource}: missing wiki target '${reference.target}'`);
          continue;
        }
        if (matches.length > 1) {
          errors.push(`${relativeSource}: ambiguous wiki target '${reference.target}'`);
          continue;
        }
        resolved = matches[0];
      }
      if (!anchorExists(resolved, reference)) {
        errors.push(`${relativeSource}: missing heading '#${reference.anchor}' in ${reference.kind} target '${reference.target || basename(file)}'`);
      }
    }
  }

  return { checkedFiles: files.length, errors };
}

// Every backticked code span in a note, split into the tokens a reader would grep for.
const codeTokens = (text) =>
  [...text.matchAll(/`([^`\n]+)`/g)].flatMap((match) => match[1].trim().split(/\s+/).map((token) => token.replace(/[,;]$/, "")));

// Coverage accepts a token as written, without its query or trailing slash, and a script without its extension.
const coverageTokens = (tokens) => new Set(tokens.flatMap((token) => [
  token,
  token.split("?")[0].replace(/(.)\/$/, "$1"),
  ...(token.startsWith("scripts/") ? [token.replace(/\.(d\.)?[cm]?[jt]s$|\.sql$/, "")] : [])
]));

const unionBetween = (text, start) => {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`'${start}' not found`);
  return [...text.slice(at).split(/;|\]/)[0].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};
const routeOf = (root, file, folder) =>
  `/${relative(join(root, folder), dirname(file)).split(/[\\/]/).filter((part) => part && !/^\(.*\)$/.test(part)).join("/")}`;
const codeFiles = (root) => [
  ...["app", "components", "lib", "prisma", "scripts"].flatMap((folder) => walkFiles(join(root, folder), (name) => /\.[cm]?[jt]sx?$/.test(name))),
  ...readdirSync(root).filter((name) => /\.(ts|mjs)$/.test(name)).map((name) => join(root, name))
];

// What the code defines that its owning note must name in backticks. `notes: null` means any living note.
export const defaultCoverage = [
  { what: "API route", notes: ["API Reference", "Route Security Inventory"],
    items: (root) => walkFiles(join(root, "app/api"), (name) => name === "route.ts").map((file) => `/api${routeOf(root, file, "app/api")}`.replace(/\/$/, "")) },
  { what: "page route", notes: ["Frontend and Backend Flow"],
    items: (root) => walkFiles(join(root, "app"), (name) => name === "page.tsx").map((file) => routeOf(root, file, "app")) },
  { what: "lib/ or components/ entry", notes: ["Thunderstrux Codebase Map"],
    items: (root) => ["lib", "components"].flatMap((folder) => readdirSync(join(root, folder)).map((name) => `${folder}/${name}`)) },
  { what: "Prisma model or enum", notes: ["Database and Multi Tenancy"],
    items: (root) => [...read(join(root, "prisma/schema.prisma")).matchAll(/^(?:model|enum)\s+(\w+)/gm)].map((match) => match[1]) },
  { what: "environment variable", notes: ["Environment Variables"],
    items: (root) => [...new Set(codeFiles(root).flatMap((file) =>
      [...read(file).matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)].map((match) => match[1] ?? match[2])))] },
  { what: "operational alert", notes: ["Production Operations"],
    items: (root) => unionBetween(read(join(root, "lib/ops/alerts.ts")), "export type OperationalAlertName") },
  { what: "permission or staff role", notes: ["Authentication and Dashboard Access"],
    items: (root) => {
      const source = read(join(root, "lib/permissions/index.ts"));
      return [...unionBetween(source, "export const organisationPermissions"), ...unionBetween(source, "export type OrganisationStaffRole")];
    } },
  { what: "rate-limit policy", notes: ["Route Security Inventory"],
    items: (root) => unionBetween(read(join(root, "lib/security/rate-limit.ts")), "export type RateLimitPolicy") },
  { what: "audit action", notes: ["Audit Coverage"],
    items: (root) => [...new Set(["app", "lib"].flatMap((folder) => walkFiles(join(root, folder), (name) => /\.tsx?$/.test(name)))
      .flatMap((file) => [...read(file).matchAll(/action: "([a-z_]+\.[a-z_.]+)"/g)].map((match) => match[1])))] },
  { what: "email template", notes: ["Email Delivery Implementation"],
    items: (root) => unionBetween(read(join(root, "lib/email/templates.ts")), "export const notificationTemplateSchema") },
  { what: "package script", notes: null,
    items: (root) => Object.keys(JSON.parse(read(join(root, "package.json"))).scripts ?? {}) },
  { what: "script file", notes: null,
    items: (root) => [...new Set(readdirSync(join(root, "scripts")).filter((name) => !name.endsWith(".d.mts"))
      .map((name) => `scripts/${name.replace(/\.[cm]?[jt]s$|\.sql$/, "")}`))] }
];

const repositoryPath = /^(app|lib|components|scripts|tests|prisma|docker|config|deploy|\.github|\.design-sync)\/\S+$|^(docker-compose[\w.-]*\.yml|\.env[\w.-]*\.example|package\.json|proxy\.ts|auth\.ts|next\.config\.ts|tsconfig\.json|renovate\.json)$/;
const testFileName = /^[\w.-]+\.(test|spec)\.(ts|tsx|mjs)$/;

export function checkVault({ root = process.cwd(), living = livingDirectory, coverage = defaultCoverage } = {}) {
  const absoluteRoot = resolve(root);
  const absoluteLiving = resolve(absoluteRoot, living);
  const notes = walkMarkdown(absoluteLiving).filter((file) => dirname(file) === absoluteLiving);
  const testNames = new Set(walkFiles(resolve(absoluteRoot, "tests")).map((file) => basename(file)));
  const tokensByStem = new Map(notes.map((file) => [basename(file, ".md"), codeTokens(read(file))]));
  const coverageByStem = new Map([...tokensByStem].map(([stem, tokens]) => [stem, coverageTokens(tokens)]));
  const errors = [];

  for (const file of notes) {
    const name = normalize(relative(absoluteRoot, file));
    const text = read(file);
    if (Buffer.byteLength(text) > maxLivingNoteBytes) {
      errors.push(`${name}: ${Buffer.byteLength(text)} bytes is over the ${maxLivingNoteBytes}-byte living-note limit; split it`);
    }
    const sources = text.match(/^---\n[\s\S]*?^sources:\s*\[(.*)\]/m)?.[1] ?? "";
    for (const source of sources.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean)) {
      if (!existsSync(resolve(absoluteRoot, source))) errors.push(`${name}: frontmatter source does not exist '${source}'`);
    }
    for (const token of new Set(tokensByStem.get(basename(file, ".md")))) {
      if (/[*<{…]/.test(token)) continue;
      const path = token.split(/[:#]/)[0];
      if (repositoryPath.test(path) && !existsSync(resolve(absoluteRoot, path))) errors.push(`${name}: code path does not exist '${path}'`);
      if (testFileName.test(token) && !testNames.has(token)) errors.push(`${name}: test file does not exist '${token}'`);
    }
  }

  for (const rule of coverage) {
    let items;
    try {
      items = rule.items(absoluteRoot);
    } catch (error) {
      errors.push(`coverage of ${rule.what}: cannot read its source (${error.message})`);
      continue;
    }
    const owners = rule.notes
      ? rule.notes.map((note) => [note, [...coverageByStem].filter(([stem]) => stem === note || stem.startsWith(`${note} `))])
      : [["any living note", [...coverageByStem]]];
    for (const [note, matches] of owners) {
      for (const item of items) {
        if (!matches.some(([, tokens]) => tokens.has(item))) errors.push(`${note}: undocumented ${rule.what} \`${item}\``);
      }
    }
  }

  return { checkedNotes: notes.length, errors };
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  const links = checkDocumentation();
  const vault = checkVault();
  const errors = [...links.errors, ...vault.errors];
  if (errors.length) {
    console.error(`Documentation check failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Documentation check passed (${links.checkedFiles} files, ${vault.checkedNotes} living notes).`);
  }
}
