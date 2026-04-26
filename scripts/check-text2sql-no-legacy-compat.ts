import { promises as fs } from "node:fs";
import path from "node:path";

type ForbiddenPattern = {
  label: string;
  pattern: RegExp;
};

type Violation = {
  file: string;
  line: number;
  column: number;
  label: string;
  text: string;
};

const SCRIPT_NAME = "check-text2sql-no-legacy-compat";
const INLINE_ALLOW_MARKER = "text2sql-no-legacy-compat:allow";

const DEFAULT_SCAN_FILES = [
  "apps/backend/src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service.ts",
  "apps/backend/src/modules/conversation/delivery/delivery-contract.mapper.ts",
  "apps/backend/src/modules/conversation/chat/application/run-view.usecase.ts",
  "apps/backend/src/modules/conversation/chat/application/save-view-from-run.usecase.ts",
  "apps/backend/src/modules/rag/audit/rag-audit-replay.service.ts"
];

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { label: "prompt_template alias", pattern: /\bprompt_template(_evidence)?\b/g },
  { label: "effective_context_summary alias", pattern: /\beffective_context_summary\b/g },
  { label: "context_conflict_hint alias", pattern: /\bcontext_conflict_hint\b/g },
  {
    label: "langgraph stage map",
    pattern: /\bTEXT2SQL_LANGGRAPH_NODE_(STAGE|REASONING_STAGE|TITLE)_MAP\b/g
  }
];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
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
      // Continue scanning parent directories.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function compactLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 180);
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const scanFiles = DEFAULT_SCAN_FILES.map((item) => path.resolve(repoRoot, item));
  const violations: Violation[] = [];
  let scannedCount = 0;

  for (const absolutePath of scanFiles) {
    let content = "";
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    scannedCount += 1;
    const relativePath = toPosix(path.relative(repoRoot, absolutePath));
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line || line.includes(INLINE_ALLOW_MARKER)) {
        continue;
      }
      for (const forbidden of FORBIDDEN_PATTERNS) {
        const matches = [...line.matchAll(forbidden.pattern)];
        for (const match of matches) {
          if (typeof match.index !== "number") {
            continue;
          }
          violations.push({
            file: relativePath,
            line: index + 1,
            column: match.index + 1,
            label: forbidden.label,
            text: compactLine(line)
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[${SCRIPT_NAME}] failed: found ${violations.length} forbidden compatibility symbol(s).`
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line}:${violation.column} [${violation.label}] ${violation.text}`
      );
    }
    console.error("");
    console.error(
      `If an occurrence is intentionally historical, annotate with "${INLINE_ALLOW_MARKER}".`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[${SCRIPT_NAME}] passed: scanned ${scannedCount} file(s), no forbidden symbols detected.`
  );
}

void main();
