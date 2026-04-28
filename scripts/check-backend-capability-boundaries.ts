import { promises as fs } from "node:fs";
import path from "node:path";

const SCRIPT_NAME = "check-backend-capability-boundaries";
const MODULES_ROOT = "apps/backend/src/modules";
const DEFAULT_SCAN_PATHS = [MODULES_ROOT];

const CODE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"];
const ALLOWED_FILE_EXTENSIONS = new Set(CODE_FILE_EXTENSIONS);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  ".next",
  ".omx",
  ".turbo",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "tmp"
]);

type CapabilityDomain = "conversation" | "governance" | "knowledge" | "platform";

type BoundaryAllowRule = {
  sourceDomain: CapabilityDomain;
  targetDomain: CapabilityDomain;
  sourcePathPattern: RegExp;
  targetPathPattern: RegExp;
  reason: string;
};

type ConversationKnowledgeSubpathAllowlistEntry = {
  sourceFile: string;
  targetFile: string;
  reason: string;
};

type ImportReference = {
  specifier: string;
  index: number;
};

type Violation = {
  sourceFile: string;
  sourceDomain: CapabilityDomain;
  targetFile: string;
  targetDomain: CapabilityDomain;
  importSpecifier: string;
  line: number;
  column: number;
  codeLine: string;
};

type CapabilityBoundaryCheckReport = {
  scannedFiles: number;
  violations: Violation[];
  conversationKnowledgeSubpath: {
    currentCount: number;
    baselineCount: number;
    remainingFromBaseline: number;
    overBaselineCount: number;
    exceedsBaseline: boolean;
  };
};

type CapabilityBoundaryCheckInput = {
  repoRoot: string;
  scanPaths?: string[];
  allowRules?: BoundaryAllowRule[];
  conversationKnowledgeSubpathAllowlist?: ConversationKnowledgeSubpathAllowlistEntry[];
  conversationKnowledgeSubpathBaselineCount?: number;
};

const MODULE_DOMAIN_MAP: Record<string, CapabilityDomain> = {
  conversation: "conversation",
  chat: "conversation",
  agent: "conversation",
  delivery: "conversation",
  governance: "governance",
  auth: "governance",
  "rule-group": "governance",
  knowledge: "knowledge",
  rag: "knowledge",
  glossary: "knowledge",
  "semantic-registry": "knowledge",
  memory: "knowledge",
  graph: "knowledge",
  platform: "platform",
  config: "platform",
  data: "platform",
  llm: "platform",
  observability: "platform",
  system: "platform",
  "skill-registry": "platform",
  eval: "platform",
  middleware: "platform"
};

const ALLOWED_DOMAIN_DEPENDENCIES: Record<CapabilityDomain, Set<CapabilityDomain>> = {
  conversation: new Set(["conversation", "governance", "knowledge", "platform"]),
  governance: new Set(["governance", "platform"]),
  knowledge: new Set(["knowledge", "platform"]),
  platform: new Set(["platform"])
};

const BUSINESS_DOMAINS = new Set<CapabilityDomain>([
  "conversation",
  "governance",
  "knowledge"
]);
const KNOWLEDGE_MODULE_SUBPATH_PREFIX = `${MODULES_ROOT}/knowledge/`;
const PLATFORM_DATA_AGGREGATE_MODULE_PATH =
  `${MODULES_ROOT}/platform/data/data.module.ts`;
const PLATFORM_DATA_IMPLEMENTATION_PREFIX = `${MODULES_ROOT}/data/`;
const CONVERSATION_TEXT2SQL_PREFIX = `${MODULES_ROOT}/conversation/text2sql/`;
const LEGACY_CHAT_MODULE_PREFIX = `${MODULES_ROOT}/chat/`;
const DEFAULT_CONVERSATION_KNOWLEDGE_SUBPATH_BASELINE_COUNT = 15;

// Transitional cross-domain wiring allowances that are still pending module reshaping.
const DEFAULT_ALLOW_RULES: BoundaryAllowRule[] = [
  {
    sourceDomain: "platform",
    targetDomain: "conversation",
    sourcePathPattern: /^apps\/backend\/src\/modules\/eval\/eval\.module\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/conversation\/text2sql\/text2sql\.module\.ts$/,
    reason: "Transitional wiring: eval still composes conversation text2sql module."
  },
  {
    sourceDomain: "platform",
    targetDomain: "conversation",
    sourcePathPattern: /^apps\/backend\/src\/modules\/eval\/eval\.service\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/conversation\/text2sql\/text2sql-workflow-runner\.service\.ts$/,
    reason: "Transitional wiring: eval service still uses conversation workflow runner."
  },
  {
    sourceDomain: "knowledge",
    targetDomain: "governance",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/((knowledge\/)?glossary\/glossary|(knowledge\/)?memory\/memory)\.(controller|module)\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/auth\/admin-only\.guard\.ts$/,
    reason: "Transitional wiring: knowledge admin endpoints still reuse governance guard."
  },
  {
    sourceDomain: "platform",
    targetDomain: "knowledge",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/observability\/observability\.module\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/rag\/observability\/rag-ingestion-metrics\.service\.ts$/,
    reason: "Transitional wiring: observability module still composes rag ingestion metrics."
  },
  {
    sourceDomain: "platform",
    targetDomain: "governance",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/system\/health\.controller\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/governance\/datasource\/(datasource|datasource-registry)\.service\.ts$/,
    reason: "Transitional wiring: system health still reads governance datasource health."
  },
  {
    sourceDomain: "platform",
    targetDomain: "knowledge",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/system\/health\.controller\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/rag\/(observability\/rag-ingestion-metrics|quality\/rag-quality)\.service\.ts$/,
    reason: "Transitional wiring: system health still reads rag health signals."
  },
  {
    sourceDomain: "platform",
    targetDomain: "governance",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/system\/system\.module\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/governance\/datasource\/datasource\.module\.ts$/,
    reason: "Transitional wiring: system module still imports governance datasource module."
  },
  {
    sourceDomain: "platform",
    targetDomain: "knowledge",
    sourcePathPattern:
      /^apps\/backend\/src\/modules\/system\/system\.module\.ts$/,
    targetPathPattern:
      /^apps\/backend\/src\/modules\/(knowledge\/)?rag\/rag\.module\.ts$/,
    reason: "Transitional wiring: system module still imports rag module path."
  }
];

const DEFAULT_CONVERSATION_KNOWLEDGE_SUBPATH_ALLOWLIST:
ConversationKnowledgeSubpathAllowlistEntry[] = [
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/agent.module.ts",
    targetFile: "apps/backend/src/modules/knowledge/contracts/knowledge-facade.contract.ts",
    reason: "Temporary bridge: agent module still imports knowledge facade contract directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/agent.module.ts",
    targetFile: "apps/backend/src/modules/knowledge/knowledge.module.ts",
    reason: "Temporary bridge: agent module still imports knowledge module directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/nodes/generate-sql.node.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason: "Temporary bridge: generate-sql node still imports RAG retrieval payload types directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/nodes/retrieve-knowledge.node.ts",
    targetFile: "apps/backend/src/modules/knowledge/contracts/knowledge-rag.contract.ts",
    reason: "Temporary bridge: retrieve-knowledge node still imports knowledge RAG contract directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/nodes/retrieve-knowledge.node.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason: "Temporary bridge: retrieve-knowledge node still imports RAG retrieval payload types directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/planner/planner-version-lock.service.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason: "Temporary bridge: planner-version-lock still imports RAG retrieval payload types directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/sql/sql-generation.service.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason: "Temporary bridge: sql-generation still imports RAG retrieval payload types directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/agent/sql/sql-prompt.builder.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason: "Temporary bridge: sql prompt builder still imports RAG retrieval payload types directly."
  },
  {
    sourceFile:
      "apps/backend/src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service.ts",
    targetFile: "apps/backend/src/modules/knowledge/contracts/knowledge-facade.contract.ts",
    reason: "Temporary bridge: chat delivery enrichment still imports knowledge facade contract directly."
  },
  {
    sourceFile:
      "apps/backend/src/modules/conversation/chat/application/shared/chat-post-run-hooks.service.ts",
    targetFile: "apps/backend/src/modules/knowledge/contracts/knowledge-facade.contract.ts",
    reason: "Temporary bridge: post-run hooks still imports knowledge facade contract directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/text2sql/text2sql.module.ts",
    targetFile: "apps/backend/src/modules/knowledge/knowledge.module.ts",
    reason: "Temporary bridge: text2sql module still imports knowledge module directly."
  },
  {
    sourceFile: "apps/backend/src/modules/conversation/chat/chat.module.ts",
    targetFile: "apps/backend/src/modules/knowledge/knowledge.module.ts",
    reason: "Temporary bridge: chat module still imports knowledge module directly."
  },
  {
    sourceFile:
      "apps/backend/src/modules/conversation/agent/nodes/resolve-saved-prior-sql.node.ts",
    targetFile: "apps/backend/src/modules/knowledge/rag/retrieval/rag-retrieval.types.ts",
    reason:
      "Temporary bridge: saved-prior-sql node still imports retrieval bundle types directly."
  },
  {
    sourceFile:
      "apps/backend/src/modules/conversation/chat/application/save-view-from-run.usecase.ts",
    targetFile: "apps/backend/src/modules/knowledge/contracts/knowledge-memory.contract.ts",
    reason:
      "Temporary bridge: save-view usecase still injects knowledge memory contract directly."
  }
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

function parseIntegerEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseConversationKnowledgeAllowlistEnv(key: string): {
  entries: ConversationKnowledgeSubpathAllowlistEntry[];
  invalidEntries: string[];
} {
  const rawEntries = parseCsvEnv(key);
  const entries: ConversationKnowledgeSubpathAllowlistEntry[] = [];
  const invalidEntries: string[] = [];
  for (const entry of rawEntries) {
    const [sourceFileRaw, targetFileRaw] = entry.split("=>");
    const sourceFile = sourceFileRaw?.trim();
    const targetFile = targetFileRaw?.trim();
    if (!sourceFile || !targetFile) {
      invalidEntries.push(entry);
      continue;
    }
    entries.push({
      sourceFile: toPosix(sourceFile),
      targetFile: toPosix(targetFile),
      reason: `Temporary allowlist from ${key}`
    });
  }
  return { entries, invalidEntries };
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
      // continue
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

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function indexToLineColumn(lineStarts: number[], index: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;

    if (index < start) {
      high = mid - 1;
      continue;
    }
    if (index >= nextStart) {
      low = mid + 1;
      continue;
    }
    return {
      line: mid + 1,
      column: index - start + 1
    };
  }
  return { line: 1, column: 1 };
}

function compactLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 180);
}

function toImportPairKey(sourceFile: string, targetFile: string): string {
  return `${sourceFile}=>${targetFile}`;
}

function buildConversationKnowledgeAllowlistSet(
  allowlist: ConversationKnowledgeSubpathAllowlistEntry[]
): Set<string> {
  const keys = allowlist.map((entry) =>
    toImportPairKey(toPosix(entry.sourceFile), toPosix(entry.targetFile))
  );
  return new Set(keys);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function extractImportReferences(content: string): ImportReference[] {
  const references: ImportReference[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      const index = typeof match.index === "number" ? match.index : 0;
      const key = `${index}:${specifier}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      references.push({ specifier, index });
    }
  }

  return references;
}

async function resolveExistingCodePath(basePath: string): Promise<string | undefined> {
  const candidates: string[] = [];
  const explicitExtension = path.extname(basePath).toLowerCase();
  const hasKnownCodeExtension = CODE_FILE_EXTENSIONS.includes(explicitExtension);

  if (hasKnownCodeExtension) {
    candidates.push(basePath);
  } else {
    for (const extension of CODE_FILE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of CODE_FILE_EXTENSIONS) {
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  return undefined;
}

async function resolveImportToModuleFile(input: {
  repoRoot: string;
  sourceAbsolutePath: string;
  specifier: string;
}): Promise<string | undefined> {
  const specifier = input.specifier.trim();
  if (!specifier) {
    return undefined;
  }

  let unresolvedBase: string | undefined;
  if (specifier.startsWith(".")) {
    unresolvedBase = path.resolve(path.dirname(input.sourceAbsolutePath), specifier);
  } else if (specifier.startsWith("apps/backend/src/modules/")) {
    unresolvedBase = path.resolve(input.repoRoot, specifier);
  } else if (specifier.startsWith("src/modules/")) {
    unresolvedBase = path.resolve(input.repoRoot, "apps/backend", specifier);
  } else if (specifier.startsWith("modules/")) {
    unresolvedBase = path.resolve(input.repoRoot, "apps/backend/src", specifier);
  } else {
    return undefined;
  }

  const resolved = await resolveExistingCodePath(unresolvedBase);
  if (!resolved) {
    return undefined;
  }

  const relative = toPosix(path.relative(input.repoRoot, resolved));
  if (!relative.startsWith(`${MODULES_ROOT}/`)) {
    return undefined;
  }
  return resolved;
}

function resolveDomain(repoRoot: string, absolutePath: string): {
  domain: CapabilityDomain;
  relativePath: string;
} | null {
  const relativePath = toPosix(path.relative(repoRoot, absolutePath));
  if (!relativePath.startsWith(`${MODULES_ROOT}/`)) {
    return null;
  }
  const pathAfterModules = relativePath.slice(`${MODULES_ROOT}/`.length);
  const rootSegment = pathAfterModules.split("/")[0];
  const rootSegmentWithoutExtension = rootSegment.replace(/\.[^.]+$/, "");
  const domain = MODULE_DOMAIN_MAP[rootSegment] ?? MODULE_DOMAIN_MAP[rootSegmentWithoutExtension];
  if (!domain) {
    return null;
  }
  return { domain, relativePath };
}

function isAllowedByRule(input: {
  sourceDomain: CapabilityDomain;
  targetDomain: CapabilityDomain;
  sourceRelativePath: string;
  targetRelativePath: string;
  allowRules: BoundaryAllowRule[];
}): boolean {
  return input.allowRules.some((rule) => {
    if (rule.sourceDomain !== input.sourceDomain || rule.targetDomain !== input.targetDomain) {
      return false;
    }
    return (
      rule.sourcePathPattern.test(input.sourceRelativePath) &&
      rule.targetPathPattern.test(input.targetRelativePath)
    );
  });
}

function isForbiddenBusinessDomainDependency(input: {
  sourceDomain: CapabilityDomain;
  targetRelativePath: string;
}): boolean {
  if (!BUSINESS_DOMAINS.has(input.sourceDomain)) {
    return false;
  }
  if (input.targetRelativePath === PLATFORM_DATA_AGGREGATE_MODULE_PATH) {
    return true;
  }
  return input.targetRelativePath.startsWith(PLATFORM_DATA_IMPLEMENTATION_PREFIX);
}

function isForbiddenText2SqlLegacyChatDependency(input: {
  sourceRelativePath: string;
  targetRelativePath: string;
}): boolean {
  if (!input.sourceRelativePath.startsWith(CONVERSATION_TEXT2SQL_PREFIX)) {
    return false;
  }
  return input.targetRelativePath.startsWith(LEGACY_CHAT_MODULE_PREFIX);
}

export async function runCapabilityBoundaryCheck(
  input: CapabilityBoundaryCheckInput
): Promise<CapabilityBoundaryCheckReport> {
  const scanPaths = input.scanPaths && input.scanPaths.length > 0
    ? input.scanPaths
    : DEFAULT_SCAN_PATHS;
  const allowRules = input.allowRules ?? DEFAULT_ALLOW_RULES;
  const conversationKnowledgeSubpathAllowlist =
    input.conversationKnowledgeSubpathAllowlist ?? DEFAULT_CONVERSATION_KNOWLEDGE_SUBPATH_ALLOWLIST;
  const conversationKnowledgeSubpathAllowlistSet = buildConversationKnowledgeAllowlistSet(
    conversationKnowledgeSubpathAllowlist
  );
  const conversationKnowledgeSubpathBaselineCount = normalizeNonNegativeInteger(
    input.conversationKnowledgeSubpathBaselineCount,
    DEFAULT_CONVERSATION_KNOWLEDGE_SUBPATH_BASELINE_COUNT
  );

  const files = new Set<string>();
  for (const scanPath of scanPaths) {
    const discovered = await collectFiles(input.repoRoot, scanPath);
    for (const file of discovered) {
      files.add(file);
    }
  }

  const orderedFiles = Array.from(files).sort();
  const violations: Violation[] = [];
  let conversationKnowledgeSubpathCurrentCount = 0;

  for (const sourceAbsolutePath of orderedFiles) {
    const sourceDomain = resolveDomain(input.repoRoot, sourceAbsolutePath);
    if (!sourceDomain) {
      continue;
    }

    let content = "";
    try {
      content = await fs.readFile(sourceAbsolutePath, "utf8");
    } catch {
      continue;
    }

    const lineStarts = createLineStarts(content);
    const lines = content.split(/\r?\n/);
    const importReferences = extractImportReferences(content);
    for (const reference of importReferences) {
      const targetAbsolutePath = await resolveImportToModuleFile({
        repoRoot: input.repoRoot,
        sourceAbsolutePath,
        specifier: reference.specifier
      });
      if (!targetAbsolutePath) {
        continue;
      }

      const targetDomain = resolveDomain(input.repoRoot, targetAbsolutePath);
      if (!targetDomain) {
        continue;
      }

      if (
        sourceDomain.domain === "conversation" &&
        targetDomain.domain === "knowledge" &&
        targetDomain.relativePath.startsWith(KNOWLEDGE_MODULE_SUBPATH_PREFIX)
      ) {
        conversationKnowledgeSubpathCurrentCount += 1;
        const allowlistKey = toImportPairKey(sourceDomain.relativePath, targetDomain.relativePath);
        if (conversationKnowledgeSubpathAllowlistSet.has(allowlistKey)) {
          continue;
        }

        const { line, column } = indexToLineColumn(lineStarts, reference.index);
        const lineText = lines[line - 1] ?? "";
        violations.push({
          sourceFile: sourceDomain.relativePath,
          sourceDomain: sourceDomain.domain,
          targetFile: targetDomain.relativePath,
          targetDomain: targetDomain.domain,
          importSpecifier: reference.specifier,
          line,
          column,
          codeLine: compactLine(lineText)
        });
        continue;
      }

      if (
        isForbiddenText2SqlLegacyChatDependency({
          sourceRelativePath: sourceDomain.relativePath,
          targetRelativePath: targetDomain.relativePath
        })
      ) {
        const { line, column } = indexToLineColumn(lineStarts, reference.index);
        const lineText = lines[line - 1] ?? "";
        violations.push({
          sourceFile: sourceDomain.relativePath,
          sourceDomain: sourceDomain.domain,
          targetFile: targetDomain.relativePath,
          targetDomain: targetDomain.domain,
          importSpecifier: reference.specifier,
          line,
          column,
          codeLine: compactLine(lineText)
        });
        continue;
      }

      if (
        isForbiddenBusinessDomainDependency({
          sourceDomain: sourceDomain.domain,
          targetRelativePath: targetDomain.relativePath
        })
      ) {
        if (
          isAllowedByRule({
            sourceDomain: sourceDomain.domain,
            targetDomain: targetDomain.domain,
            sourceRelativePath: sourceDomain.relativePath,
            targetRelativePath: targetDomain.relativePath,
            allowRules
          })
        ) {
          continue;
        }

        const { line, column } = indexToLineColumn(lineStarts, reference.index);
        const lineText = lines[line - 1] ?? "";
        violations.push({
          sourceFile: sourceDomain.relativePath,
          sourceDomain: sourceDomain.domain,
          targetFile: targetDomain.relativePath,
          targetDomain: targetDomain.domain,
          importSpecifier: reference.specifier,
          line,
          column,
          codeLine: compactLine(lineText)
        });
        continue;
      }

      const allowedTargets = ALLOWED_DOMAIN_DEPENDENCIES[sourceDomain.domain];
      if (allowedTargets.has(targetDomain.domain)) {
        continue;
      }
      if (
        isAllowedByRule({
          sourceDomain: sourceDomain.domain,
          targetDomain: targetDomain.domain,
          sourceRelativePath: sourceDomain.relativePath,
          targetRelativePath: targetDomain.relativePath,
          allowRules
        })
      ) {
        continue;
      }

      const { line, column } = indexToLineColumn(lineStarts, reference.index);
      const lineText = lines[line - 1] ?? "";
      violations.push({
        sourceFile: sourceDomain.relativePath,
        sourceDomain: sourceDomain.domain,
        targetFile: targetDomain.relativePath,
        targetDomain: targetDomain.domain,
        importSpecifier: reference.specifier,
        line,
        column,
        codeLine: compactLine(lineText)
      });
    }
  }

  const conversationKnowledgeSubpathExceedsBaseline =
    conversationKnowledgeSubpathCurrentCount > conversationKnowledgeSubpathBaselineCount;
  const conversationKnowledgeSubpathOverBaselineCount = Math.max(
    0,
    conversationKnowledgeSubpathCurrentCount - conversationKnowledgeSubpathBaselineCount
  );

  return {
    scannedFiles: orderedFiles.length,
    violations: violations.sort((a, b) =>
      a.sourceFile === b.sourceFile ? a.line - b.line : a.sourceFile.localeCompare(b.sourceFile)
    ),
    conversationKnowledgeSubpath: {
      currentCount: conversationKnowledgeSubpathCurrentCount,
      baselineCount: conversationKnowledgeSubpathBaselineCount,
      remainingFromBaseline: Math.max(
        0,
        conversationKnowledgeSubpathBaselineCount - conversationKnowledgeSubpathCurrentCount
      ),
      overBaselineCount: conversationKnowledgeSubpathOverBaselineCount,
      exceedsBaseline: conversationKnowledgeSubpathExceedsBaseline
    }
  };
}

function printViolations(violations: Violation[]): void {
  for (const violation of violations) {
    console.error(
      `- ${violation.sourceFile}:${violation.line}:${violation.column} ` +
      `[${violation.sourceDomain} -> ${violation.targetDomain}] ` +
      `import "${violation.importSpecifier}" -> ${violation.targetFile}`
    );
    if (violation.codeLine) {
      console.error(`  ${violation.codeLine}`);
    }
  }
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const scanPathOverrides = parseCsvEnv("BACKEND_CAPABILITY_BOUNDARY_SCAN_PATHS");
  const conversationKnowledgeBaselineOverride = parseIntegerEnv(
    "BACKEND_CAPABILITY_BOUNDARY_CONVERSATION_KNOWLEDGE_BASELINE"
  );
  const conversationKnowledgeAllowlistEnv = parseConversationKnowledgeAllowlistEnv(
    "BACKEND_CAPABILITY_BOUNDARY_CONVERSATION_KNOWLEDGE_ALLOWLIST"
  );
  if (conversationKnowledgeAllowlistEnv.invalidEntries.length > 0) {
    console.error(
      `[${SCRIPT_NAME}] failed: invalid BACKEND_CAPABILITY_BOUNDARY_CONVERSATION_KNOWLEDGE_ALLOWLIST entries: ` +
      `${conversationKnowledgeAllowlistEnv.invalidEntries.join(", ")}`
    );
    console.error(
      "Expected CSV format: source/path.ts=>target/path.ts[,source/path.ts=>target/path.ts]"
    );
    process.exitCode = 1;
    return;
  }

  const report = await runCapabilityBoundaryCheck({
    repoRoot,
    scanPaths: scanPathOverrides.length > 0 ? scanPathOverrides : undefined,
    conversationKnowledgeSubpathBaselineCount: conversationKnowledgeBaselineOverride,
    conversationKnowledgeSubpathAllowlist: [
      ...DEFAULT_CONVERSATION_KNOWLEDGE_SUBPATH_ALLOWLIST,
      ...conversationKnowledgeAllowlistEnv.entries
    ]
  });

  const conversationKnowledgeSubpathSummary =
    `[${SCRIPT_NAME}] conversation->knowledge/* direct imports: ` +
    `current=${report.conversationKnowledgeSubpath.currentCount}, ` +
    `baseline=${report.conversationKnowledgeSubpath.baselineCount}, ` +
    `over-baseline=${report.conversationKnowledgeSubpath.overBaselineCount}.`;

  if (
    report.violations.length > 0 ||
    report.conversationKnowledgeSubpath.exceedsBaseline
  ) {
    console.error(
      `[${SCRIPT_NAME}] failed: found ${report.violations.length} capability boundary violation(s).`
    );
    console.error(conversationKnowledgeSubpathSummary);
    printViolations(report.violations);
    if (report.conversationKnowledgeSubpath.exceedsBaseline) {
      console.error(
        "- conversation -> knowledge/* direct imports exceed baseline; reduce legacy bridges " +
        "or lower allowlist usage before merging."
      );
    }
    console.error("");
    console.error("Allowed dependencies:");
    console.error("- conversation -> conversation|governance|knowledge|platform");
    console.error("- governance -> governance|platform");
    console.error("- knowledge -> knowledge|platform");
    console.error("- platform -> platform");
    process.exitCode = 1;
    return;
  }

  console.log(conversationKnowledgeSubpathSummary);
  console.log(
    `[${SCRIPT_NAME}] passed: scanned ${report.scannedFiles} file(s), no capability boundary violations found.`
  );
}

if (require.main === module) {
  void main();
}
