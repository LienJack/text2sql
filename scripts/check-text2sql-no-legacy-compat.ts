import { promises as fs } from "node:fs";
import path from "node:path";

export type ForbiddenPattern = {
  label: string;
  pattern: RegExp;
};

export type Violation = {
  file: string;
  line: number;
  column: number;
  label: string;
  text: string;
};

export interface NoLegacyCompatReport {
  scriptName: string;
  repoRoot: string;
  scannedCount: number;
  scanFiles: string[];
  violations: Violation[];
  gatePass: boolean;
}

const SCRIPT_NAME = "check-text2sql-no-legacy-compat";
const INLINE_ALLOW_MARKER = "text2sql-no-legacy-compat:allow";

export const DEFAULT_SCAN_FILES = [
  "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph.ts",
  "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-runner.service.ts",
  "apps/backend/src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service.ts",
  "apps/backend/src/modules/conversation/delivery/delivery-contract.mapper.ts",
  "apps/backend/src/modules/conversation/chat/application/run-view.usecase.ts",
  "apps/backend/src/modules/conversation/chat/application/save-view-from-run.usecase.ts",
  "apps/backend/src/modules/rag/audit/rag-audit-replay.service.ts",
  "apps/backend/src/modules/data/persistence/chat.repository.ts",
  "apps/backend/src/modules/conversation/text2sql/stages/text2sql-stage-catalog.ts"
];

export const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { label: "prompt_template alias", pattern: /\bprompt_template(_evidence)?\b/g },
  { label: "effective_context_summary alias", pattern: /\beffective_context_summary\b/g },
  { label: "context_conflict_hint alias", pattern: /\bcontext_conflict_hint\b/g },
  {
    label: "langgraph stage map",
    pattern: /\bTEXT2SQL_LANGGRAPH_NODE_(STAGE|REASONING_STAGE|TITLE)_MAP\b/g
  },
  {
    label: "langgraph legacy delegation",
    pattern: /\brunLegacyRuntime\b|\blegacyRunner\b|\bText2SqlV2RunnerService\b/g
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

function normalizeScanPaths(repoRoot: string, scanFiles: string[]): string[] {
  return scanFiles.map((item) =>
    path.isAbsolute(item) ? item : path.resolve(repoRoot, item)
  );
}

export async function evaluateNoLegacyCompat(options?: {
  repoRoot?: string;
  scanFiles?: string[];
}): Promise<NoLegacyCompatReport> {
  const repoRoot = options?.repoRoot
    ? path.resolve(options.repoRoot)
    : await findRepoRoot(process.cwd());
  const configuredScanFiles = options?.scanFiles ?? DEFAULT_SCAN_FILES;
  const scanFiles = normalizeScanPaths(repoRoot, configuredScanFiles);
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

  return {
    scriptName: SCRIPT_NAME,
    repoRoot,
    scannedCount,
    scanFiles: configuredScanFiles,
    violations,
    gatePass: violations.length === 0
  };
}

async function main(): Promise<void> {
  const report = await evaluateNoLegacyCompat();

  if (!report.gatePass) {
    console.error(
      `[${report.scriptName}] failed: found ${report.violations.length} forbidden compatibility symbol(s).`
    );
    for (const violation of report.violations) {
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
    `[${report.scriptName}] passed: scanned ${report.scannedCount} file(s), no forbidden symbols detected.`
  );
}

if (require.main === module) {
  void main();
}
