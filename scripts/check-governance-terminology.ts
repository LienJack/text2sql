import { promises as fs } from "node:fs";
import path from "node:path";

type LegacyTerm = {
  label: string;
  pattern: RegExp;
};

type Violation = {
  file: string;
  line: number;
  column: number;
  term: string;
  text: string;
};

const SCRIPT_NAME = "check-governance-terminology";
const INLINE_ALLOW_MARKERS = [
  "governance-legacy-ok",
  "governance-terminology:allow-legacy"
];

const HISTORICAL_CONTEXT_HINTS = [
  "legacy",
  "retired",
  "deprecat",
  "migrat",
  "rollback",
  "compat",
  "遗留",
  "迁移",
  "回滚",
  "兼容"
];

const DEFAULT_SCAN_PATHS = [
  "README.md",
  "docs/standards",
  "apps/backend/src/modules/governance",
  "apps/frontend/src/app/settings",
  "apps/frontend/src/components/settings"
];

const DEFAULT_ALLOWED_PATH_SUBSTRINGS = [
  "/docs/solutions/",
  "/apps/backend/prisma/migrations/"
];

const ALLOWED_FILE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs"
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".omx",
  ".turbo",
  "coverage",
  "data",
  "dist",
  "graphify-out",
  "node_modules",
  "tmp"
]);

const LEGACY_TERMS: LegacyTerm[] = [
  { label: "acl", pattern: /\bacl\b/gi },
  { label: "rule-group", pattern: /\brule[- ]group\b/gi }
];

function toPosix(relativeOrAbsolutePath: string): string {
  return relativeOrAbsolutePath.split(path.sep).join("/");
}

function parseCsvEnv(key: string): string[] {
  const raw = process.env[key];
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function findRepoRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "package.json");
    try {
      const content = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(content) as { name?: string; private?: boolean };
      if (parsed.name === "text2sql-monorepo" && parsed.private === true) {
        return current;
      }
    } catch {
      // Continue searching parent folders.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

async function collectFiles(root: string, inputPath: string): Promise<string[]> {
  const absolutePath = path.resolve(root, inputPath);
  try {
    const stats = await fs.stat(absolutePath);
    if (stats.isFile()) {
      return [absolutePath];
    }
    if (!stats.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const output: string[] = [];
  const queue: string[] = [absolutePath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absoluteEntry = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        queue.push(absoluteEntry);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
        continue;
      }
      output.push(absoluteEntry);
    }
  }
  return output;
}

function shouldAllowPath(relativePathPosix: string, allowPathSubstrings: string[]): boolean {
  const normalized = `/${relativePathPosix}`;
  return allowPathSubstrings.some((value) => normalized.includes(value));
}

function shouldIgnoreLine(line: string): boolean {
  const lowered = line.toLowerCase();
  if (INLINE_ALLOW_MARKERS.some((marker) => lowered.includes(marker))) {
    return true;
  }
  return HISTORICAL_CONTEXT_HINTS.some((hint) => lowered.includes(hint));
}

function scanLineForTerm(line: string, term: LegacyTerm): number[] {
  const columns: number[] = [];
  for (const match of line.matchAll(term.pattern)) {
    if (typeof match.index === "number") {
      columns.push(match.index + 1);
    }
  }
  return columns;
}

function compactLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 180);
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const scanPathOverrides = parseCsvEnv("GOVERNANCE_TERMINOLOGY_SCAN_PATHS");
  const allowPathOverrides = parseCsvEnv("GOVERNANCE_TERMINOLOGY_ALLOW_PATHS");

  const scanPaths = scanPathOverrides.length > 0 ? scanPathOverrides : DEFAULT_SCAN_PATHS;
  const allowPathSubstrings = [...DEFAULT_ALLOWED_PATH_SUBSTRINGS, ...allowPathOverrides].map(
    (value) => `/${toPosix(value).replace(/^\/+/, "")}`
  );

  const files = new Set<string>();
  for (const scanPath of scanPaths) {
    const discovered = await collectFiles(repoRoot, scanPath);
    for (const file of discovered) {
      files.add(file);
    }
  }

  const violations: Violation[] = [];
  const orderedFiles = Array.from(files).sort();
  for (const absoluteFilePath of orderedFiles) {
    const relativePathPosix = toPosix(path.relative(repoRoot, absoluteFilePath));
    if (shouldAllowPath(relativePathPosix, allowPathSubstrings)) {
      continue;
    }

    let content = "";
    try {
      content = await fs.readFile(absoluteFilePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line || shouldIgnoreLine(line)) {
        continue;
      }

      for (const term of LEGACY_TERMS) {
        const columns = scanLineForTerm(line, term);
        for (const column of columns) {
          violations.push({
            file: relativePathPosix,
            line: index + 1,
            column,
            term: term.label,
            text: compactLine(line)
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[${SCRIPT_NAME}] failed: found ${violations.length} legacy governance term occurrence(s).`
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line}:${violation.column} [${violation.term}] ${violation.text}`
      );
    }
    console.error("");
    console.error(
      `Allow a justified historical line with marker: ${INLINE_ALLOW_MARKERS[1]} (or ${INLINE_ALLOW_MARKERS[0]}).`
    );
    console.error(
      "Allow legacy-heavy paths via env GOVERNANCE_TERMINOLOGY_ALLOW_PATHS=path1,path2 when needed."
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[${SCRIPT_NAME}] passed: scanned ${orderedFiles.length} file(s), no active narrative uses legacy terms.`
  );
}

void main();
