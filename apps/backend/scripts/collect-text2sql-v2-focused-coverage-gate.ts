import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CoverageCounts = Record<string, number | number[]>;

interface IstanbulLocation {
  start?: { line?: number };
}

interface IstanbulFileCoverage {
  path?: string;
  statementMap?: Record<string, IstanbulLocation>;
  s?: CoverageCounts;
  branchMap?: Record<string, unknown>;
  b?: CoverageCounts;
}

type IstanbulCoverageMap = Record<string, IstanbulFileCoverage>;

interface CoverageSummary {
  linePct: number;
  branchPct: number;
  coveredLines: number;
  totalLines: number;
  coveredBranches: number;
  totalBranches: number;
}

interface CriticalFileThreshold {
  file: string;
  line: number;
}

interface FlowMatrixNode {
  id: string;
  requirementIds: string[];
  implementationOwners: string[];
  evidenceOwners: string[];
  expectedTestFiles: string[];
  gateRelevance: boolean;
  behaviorTestStatus: "covered" | "partial" | "missing" | "planned";
  coverageOwnerStatus: "covered" | "partial" | "missing" | "planned";
  canonicalRuntimeOwners?: string[];
  canonicalOwnerStatus?: "covered" | "partial" | "missing" | "planned";
  contractAssertionMode?: "behavior_contract" | "legacy_runtime_detail";
}

interface StrictCompletionRow {
  id: string;
  implementationOwners: string[];
  evidenceOwners: string[];
  expectedTestFiles: string[];
  behaviorTestStatus: "covered" | "partial" | "missing" | "planned";
  coverageOwnerStatus: "covered" | "partial" | "missing" | "planned";
  contractAssertionMode?: "behavior_contract" | "legacy_runtime_detail";
}

interface EvalFixtureFamily {
  family: string;
  evalCases: string[];
  behaviorTests: string[];
  flowNodes: string[];
}

interface CriticalFileOwnerMigration {
  from: string;
  to: string;
  reason: string;
  threshold?: { line?: number };
}

interface RuntimeCoverageRow {
  id: string;
  owners: string[];
  expectedTestFiles: string[];
  coverageOwnerStatus: "covered" | "partial" | "missing" | "planned";
  critical: boolean;
  blocker?: string;
}

interface RuntimePathPlan {
  currentActivePath: string[];
  targetActivePath: string[];
  criticalOwners: string[];
  blockerPolicy: string;
  delegationPolicy?: string;
  delegationOwners?: string[];
  delegationForbiddenPatterns?: string[];
}

export interface CloseoutFlowMatrix {
  version: string;
  nodes: FlowMatrixNode[];
  strictCompletionRows?: StrictCompletionRow[];
  evalFixtureFamilies: EvalFixtureFamily[];
  criticalFileOwnerMigrations?: CriticalFileOwnerMigration[];
  runtimeCoverageRows?: RuntimeCoverageRow[];
  runtimePaths?: RuntimePathPlan;
}

interface CriticalFileResult {
  file: string;
  effectiveFile: string;
  linePct: number;
  threshold: number;
  gatePass: boolean;
  migrated: boolean;
  reasons: string[];
}

export interface FocusedCoverageGateReport {
  generatedAt: string;
  coveragePath: string;
  matrixPath: string;
  scoped: CoverageSummary & { gatePass: boolean; files: string[]; reasons: string[] };
  criticalFiles: CriticalFileResult[];
  delegationZero: DelegationZeroGateReport;
  flowMatrix: {
    version: string;
    nodeCount: number;
    completeNodeCount: number;
    incompleteNodes: Array<{ id: string; reasons: string[] }>;
    evalFixtureFamilyCount: number;
    incompleteEvalFixtureFamilies: Array<{ family: string; reasons: string[] }>;
    strictCompletionRowCount: number;
    incompleteStrictCompletionRows: Array<{ id: string; reasons: string[] }>;
    runtimeCoverageRowCount: number;
    incompleteRuntimeCoverageRows: Array<{ id: string; reasons: string[] }>;
    runtimePathReasons: string[];
    gatePass: boolean;
  };
  rollout: {
    gatePass: boolean;
    recommendedStage: "closeout_ready" | "hold";
    rollbackSuggested: boolean;
    reasons: string[];
  };
}

export interface DelegationZeroViolation {
  file: string;
  label: string;
  pattern: string;
}

export interface DelegationZeroGateReport {
  gatePass: boolean;
  scannedFiles: string[];
  violations: DelegationZeroViolation[];
  reasons: string[];
}

interface DelegationZeroScanRule {
  file: string;
  label: string;
  pattern: RegExp;
}

const SCOPED_THRESHOLDS = {
  line: 80,
  branch: 70
};

const CRITICAL_FILE_THRESHOLDS: CriticalFileThreshold[] = [
  {
    file: "apps/backend/src/modules/conversation/agent/v2/sql-correction.service.ts",
    line: 75
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-runner.service.ts",
    line: 80
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/sql-validation.service.ts",
    line: 75
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/semantic-context-pack.service.ts",
    line: 75
  },
  {
    file: "apps/backend/src/modules/llm/embedding-router.service.ts",
    line: 75
  },
  {
    file: "apps/backend/src/modules/conversation/text2sql/stages/run-v2-langgraph.stage.ts",
    line: 80
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph.ts",
    line: 80
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-result.mapper.ts",
    line: 80
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/nodes/intake.node.ts",
    line: 75
  }
];

const DELEGATION_ZERO_SCAN_RULES: DelegationZeroScanRule[] = [
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph.ts",
    label: "legacy runtime delegation",
    pattern: /\brunLegacyRuntime\b/
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph.ts",
    label: "legacy runner instance",
    pattern: /\blegacyRunner\b/
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-runner.service.ts",
    label: "legacy v2 runner import",
    pattern: /\bText2SqlV2RunnerService\b/
  },
  {
    file: "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-runner.service.ts",
    label: "legacy runtime callback",
    pattern: /\brunLegacyRuntime\b/
  }
];

function toPosixPath(pathname: string): string {
  return pathname.replace(/\\/g, "/");
}

function pct(covered: number, total: number): number {
  if (total === 0) {
    return 100;
  }
  return Number(((covered / total) * 100).toFixed(2));
}

function summarizeFile(fileCoverage: IstanbulFileCoverage): CoverageSummary {
  const lineCoverage = new Map<number, boolean>();
  const statementMap = fileCoverage.statementMap ?? {};
  const statements = fileCoverage.s ?? {};

  for (const [statementId, location] of Object.entries(statementMap)) {
    const line = location.start?.line;
    if (typeof line !== "number") {
      continue;
    }
    const hitCount = statements[statementId];
    const covered = typeof hitCount === "number" ? hitCount > 0 : false;
    lineCoverage.set(line, (lineCoverage.get(line) ?? false) || covered);
  }

  let coveredBranches = 0;
  let totalBranches = 0;
  for (const branchHits of Object.values(fileCoverage.b ?? {})) {
    const hits = Array.isArray(branchHits) ? branchHits : [branchHits];
    for (const hit of hits) {
      totalBranches += 1;
      if (typeof hit === "number" && hit > 0) {
        coveredBranches += 1;
      }
    }
  }

  const totalLines = lineCoverage.size;
  const coveredLines = [...lineCoverage.values()].filter(Boolean).length;

  return {
    linePct: pct(coveredLines, totalLines),
    branchPct: pct(coveredBranches, totalBranches),
    coveredLines,
    totalLines,
    coveredBranches,
    totalBranches
  };
}

function mergeSummaries(summaries: CoverageSummary[]): CoverageSummary {
  const totalLines = summaries.reduce((sum, item) => sum + item.totalLines, 0);
  const coveredLines = summaries.reduce((sum, item) => sum + item.coveredLines, 0);
  const totalBranches = summaries.reduce((sum, item) => sum + item.totalBranches, 0);
  const coveredBranches = summaries.reduce((sum, item) => sum + item.coveredBranches, 0);

  return {
    linePct: pct(coveredLines, totalLines),
    branchPct: pct(coveredBranches, totalBranches),
    coveredLines,
    totalLines,
    coveredBranches,
    totalBranches
  };
}

function findCoverageEntry(
  coverage: IstanbulCoverageMap,
  repoRelativeFile: string
): IstanbulFileCoverage | undefined {
  const normalizedTarget = toPosixPath(repoRelativeFile);
  for (const [coverageKey, entry] of Object.entries(coverage)) {
    const candidates = [coverageKey, entry.path ?? ""].map(toPosixPath);
    if (candidates.some((candidate) => candidate.endsWith(normalizedTarget))) {
      return entry;
    }
  }
  return undefined;
}

function unique(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function resolveCriticalFile(
  coverage: IstanbulCoverageMap,
  matrix: CloseoutFlowMatrix,
  threshold: CriticalFileThreshold
): { file: string; entry?: IstanbulFileCoverage; migrated: boolean; reason?: string; lineThreshold: number } {
  const migration = matrix.criticalFileOwnerMigrations?.find(
    (item) => item.from === threshold.file
  );
  if (migration) {
    const migratedEntry = findCoverageEntry(coverage, migration.to);
    if (migratedEntry) {
      return {
        file: migration.to,
        entry: migratedEntry,
        migrated: true,
        reason: migration.reason,
        lineThreshold: migration.threshold?.line ?? threshold.line
      };
    }
  }

  const directEntry = findCoverageEntry(coverage, threshold.file);
  if (directEntry) {
    return {
      file: threshold.file,
      entry: directEntry,
      migrated: false,
      lineThreshold: threshold.line
    };
  }

  if (!migration) {
    return {
      file: threshold.file,
      migrated: false,
      reason: "critical_file_missing_without_owner_migration",
      lineThreshold: threshold.line
    };
  }

  return {
    file: migration.to,
    entry: findCoverageEntry(coverage, migration.to),
    migrated: true,
    reason: migration.reason,
    lineThreshold: migration.threshold?.line ?? threshold.line
  };
}

function evaluateCriticalFiles(
  coverage: IstanbulCoverageMap,
  matrix: CloseoutFlowMatrix
): CriticalFileResult[] {
  return CRITICAL_FILE_THRESHOLDS.map((threshold) => {
    const resolved = resolveCriticalFile(coverage, matrix, threshold);
    const reasons: string[] = [];

    if (!resolved.entry) {
      reasons.push(resolved.reason ?? "critical_file_missing_from_coverage");
      return {
        file: threshold.file,
        effectiveFile: resolved.file,
        linePct: 0,
        threshold: resolved.lineThreshold,
        gatePass: false,
        migrated: resolved.migrated,
        reasons
      };
    }

    const summary = summarizeFile(resolved.entry);
    if (summary.linePct === 0) {
      reasons.push("critical_file_zero_line_coverage");
    }
    if (summary.linePct < resolved.lineThreshold) {
      reasons.push(`line_coverage_below_${resolved.lineThreshold}`);
    }
    if (resolved.migrated && !resolved.reason) {
      reasons.push("owner_migration_missing_reason");
    }

    return {
      file: threshold.file,
      effectiveFile: resolved.file,
      linePct: summary.linePct,
      threshold: resolved.lineThreshold,
      gatePass: reasons.length === 0,
      migrated: resolved.migrated,
      reasons
    };
  });
}

function evaluateDelegationZero(repoRoot: string): DelegationZeroGateReport {
  const scannedFiles = unique(DELEGATION_ZERO_SCAN_RULES.map((rule) => rule.file));
  const violations: DelegationZeroViolation[] = [];

  for (const rule of DELEGATION_ZERO_SCAN_RULES) {
    const absolutePath = resolve(repoRoot, rule.file);
    if (!existsSync(absolutePath)) {
      violations.push({
        file: rule.file,
        label: `${rule.label}:missing_file`,
        pattern: rule.pattern.source
      });
      continue;
    }
    const content = readFileSync(absolutePath, "utf-8");
    if (rule.pattern.test(content)) {
      violations.push({
        file: rule.file,
        label: rule.label,
        pattern: rule.pattern.source
      });
    }
  }

  return {
    gatePass: violations.length === 0,
    scannedFiles,
    violations,
    reasons: violations.map(
      (item) => `${item.file}:${item.label}:${item.pattern}`
    )
  };
}

function evaluateFlowMatrix(matrix: CloseoutFlowMatrix): FocusedCoverageGateReport["flowMatrix"] {
  const incompleteNodes = matrix.nodes.flatMap((node) => {
    const reasons: string[] = [];
    if (node.requirementIds.length === 0) {
      reasons.push("missing_requirement_ids");
    }
    if (node.implementationOwners.length === 0) {
      reasons.push("missing_implementation_owners");
    }
    if (node.evidenceOwners.length === 0) {
      reasons.push("missing_evidence_owners");
    }
    if (node.expectedTestFiles.length === 0) {
      reasons.push("missing_expected_behavior_tests");
    }
    if (node.behaviorTestStatus !== "covered") {
      reasons.push(`behavior_test_status_${node.behaviorTestStatus}`);
    }
    if (node.coverageOwnerStatus !== "covered") {
      reasons.push(`coverage_owner_status_${node.coverageOwnerStatus}`);
    }
    if (!node.canonicalRuntimeOwners || node.canonicalRuntimeOwners.length === 0) {
      reasons.push("missing_canonical_runtime_owners");
    }
    if (!node.canonicalOwnerStatus) {
      reasons.push("missing_canonical_owner_status");
    } else if (node.canonicalOwnerStatus === "missing") {
      reasons.push("canonical_owner_status_missing");
    }
    if (node.contractAssertionMode !== "behavior_contract") {
      reasons.push(
        `contract_assertion_mode_${node.contractAssertionMode ?? "missing"}`
      );
    }
    return reasons.length > 0 ? [{ id: node.id, reasons }] : [];
  });

  const incompleteEvalFixtureFamilies = matrix.evalFixtureFamilies.flatMap((family) => {
    const reasons: string[] = [];
    if (family.evalCases.length === 0) {
      reasons.push("missing_eval_cases");
    }
    if (family.behaviorTests.length === 0) {
      reasons.push("missing_behavior_test_traceability");
    }
    if (family.flowNodes.length === 0) {
      reasons.push("missing_flow_node_traceability");
    }
    return reasons.length > 0 ? [{ family: family.family, reasons }] : [];
  });

  const incompleteStrictCompletionRows = (matrix.strictCompletionRows ?? []).flatMap(
    (row) => {
      const reasons: string[] = [];
      if (row.implementationOwners.length === 0) {
        reasons.push("missing_implementation_owners");
      }
      if (row.evidenceOwners.length === 0) {
        reasons.push("missing_evidence_owners");
      }
      if (row.expectedTestFiles.length === 0) {
        reasons.push("missing_expected_behavior_tests");
      }
      if (row.behaviorTestStatus !== "covered") {
        reasons.push(`behavior_test_status_${row.behaviorTestStatus}`);
      }
      if (row.coverageOwnerStatus !== "covered") {
        reasons.push(`coverage_owner_status_${row.coverageOwnerStatus}`);
      }
      if (row.contractAssertionMode !== "behavior_contract") {
        reasons.push(
          `contract_assertion_mode_${row.contractAssertionMode ?? "missing"}`
        );
      }
      return reasons.length > 0 ? [{ id: row.id, reasons }] : [];
    }
  );

  const incompleteRuntimeCoverageRows = (matrix.runtimeCoverageRows ?? []).flatMap((row) => {
    const reasons: string[] = [];
    if (row.owners.length === 0) {
      reasons.push("missing_runtime_owners");
    }
    if (row.expectedTestFiles.length === 0) {
      reasons.push("missing_runtime_expected_tests");
    }
    if (row.coverageOwnerStatus === "missing") {
      reasons.push("runtime_coverage_owner_status_missing");
    }
    if (row.critical && typeof row.blocker !== "string") {
      reasons.push("missing_runtime_blocker");
    }
    return reasons.length > 0 ? [{ id: row.id, reasons }] : [];
  });

  const runtimePathReasons: string[] = [];
  if (!matrix.runtimePaths) {
    runtimePathReasons.push("missing_runtime_paths");
  } else {
    if ((matrix.runtimePaths.currentActivePath ?? []).length === 0) {
      runtimePathReasons.push("missing_runtime_current_active_path");
    }
    if ((matrix.runtimePaths.targetActivePath ?? []).length === 0) {
      runtimePathReasons.push("missing_runtime_target_active_path");
    }
    if ((matrix.runtimePaths.criticalOwners ?? []).length === 0) {
      runtimePathReasons.push("missing_runtime_critical_owners");
    }
    if (
      typeof matrix.runtimePaths.blockerPolicy !== "string" ||
      matrix.runtimePaths.blockerPolicy.trim().length === 0
    ) {
      runtimePathReasons.push("missing_runtime_blocker_policy");
    }
    if (
      typeof matrix.runtimePaths.delegationPolicy !== "string" ||
      matrix.runtimePaths.delegationPolicy.trim().length === 0
    ) {
      runtimePathReasons.push("missing_runtime_delegation_policy");
    }
    if ((matrix.runtimePaths.delegationOwners ?? []).length === 0) {
      runtimePathReasons.push("missing_runtime_delegation_owners");
    }
    if ((matrix.runtimePaths.delegationForbiddenPatterns ?? []).length === 0) {
      runtimePathReasons.push("missing_runtime_delegation_patterns");
    }
  }

  return {
    version: matrix.version,
    nodeCount: matrix.nodes.length,
    completeNodeCount: matrix.nodes.length - incompleteNodes.length,
    incompleteNodes,
    evalFixtureFamilyCount: matrix.evalFixtureFamilies.length,
    incompleteEvalFixtureFamilies,
    strictCompletionRowCount: matrix.strictCompletionRows?.length ?? 0,
    incompleteStrictCompletionRows,
    runtimeCoverageRowCount: matrix.runtimeCoverageRows?.length ?? 0,
    incompleteRuntimeCoverageRows,
    runtimePathReasons,
    gatePass:
      incompleteNodes.length === 0 &&
      incompleteEvalFixtureFamilies.length === 0 &&
      incompleteStrictCompletionRows.length === 0 &&
      incompleteRuntimeCoverageRows.length === 0 &&
      runtimePathReasons.length === 0
  };
}

function scopedFilesFromMatrix(matrix: CloseoutFlowMatrix): string[] {
  const ownerMigrations = new Map(
    (matrix.criticalFileOwnerMigrations ?? []).map((item) => [item.from, item.to])
  );
  const effectiveOwner = (file: string): string => ownerMigrations.get(file) ?? file;

  return unique([
    ...CRITICAL_FILE_THRESHOLDS.map((item) => effectiveOwner(item.file)),
    ...matrix.nodes
      .filter((node) => node.gateRelevance)
      .flatMap((node) => node.implementationOwners.map(effectiveOwner)),
    ...(matrix.criticalFileOwnerMigrations ?? []).map((item) => item.to)
  ]);
}

export function evaluateFocusedCoverageGate(params: {
  coverage: IstanbulCoverageMap;
  matrix: CloseoutFlowMatrix;
  coveragePath?: string;
  matrixPath?: string;
  generatedAt?: string;
  repoRoot?: string;
  delegationZeroOverride?: DelegationZeroGateReport;
}): FocusedCoverageGateReport {
  const scopedFiles = scopedFilesFromMatrix(params.matrix);
  const scopedReasons: string[] = [];
  const scopedSummaries: CoverageSummary[] = [];

  for (const file of scopedFiles) {
    const entry = findCoverageEntry(params.coverage, file);
    if (!entry) {
      scopedReasons.push(`missing_scoped_coverage:${file}`);
      continue;
    }
    scopedSummaries.push(summarizeFile(entry));
  }

  const scopedSummary = mergeSummaries(scopedSummaries);
  if (scopedSummary.linePct < SCOPED_THRESHOLDS.line) {
    scopedReasons.push(`scoped_line_coverage_below_${SCOPED_THRESHOLDS.line}`);
  }
  if (scopedSummary.branchPct < SCOPED_THRESHOLDS.branch) {
    scopedReasons.push(`scoped_branch_coverage_below_${SCOPED_THRESHOLDS.branch}`);
  }

  const criticalFiles = evaluateCriticalFiles(params.coverage, params.matrix);
  const criticalReasons = criticalFiles.flatMap((item) =>
    item.reasons.map((reason) => `critical:${item.file}:${reason}`)
  );
  const delegationZero =
    params.delegationZeroOverride ??
    evaluateDelegationZero(params.repoRoot ?? resolve(__dirname, "../../.."));
  const flowMatrix = evaluateFlowMatrix(params.matrix);
  const matrixReasons = [
    ...flowMatrix.incompleteNodes.map(
      (item) => `flow_node:${item.id}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.incompleteEvalFixtureFamilies.map(
      (item) => `eval_family:${item.family}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.incompleteStrictCompletionRows.map(
      (item) => `strict_row:${item.id}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.incompleteRuntimeCoverageRows.map(
      (item) => `runtime_row:${item.id}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.runtimePathReasons.map((reason) => `runtime_path:${reason}`)
  ];

  const reasons = [
    ...scopedReasons,
    ...criticalReasons,
    ...matrixReasons,
    ...delegationZero.reasons.map((item) => `delegation_zero:${item}`)
  ];
  const gatePass =
    scopedReasons.length === 0 &&
    criticalFiles.every((item) => item.gatePass) &&
    flowMatrix.gatePass &&
    delegationZero.gatePass;

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    coveragePath: params.coveragePath ?? "",
    matrixPath: params.matrixPath ?? "",
    scoped: {
      ...scopedSummary,
      gatePass: scopedReasons.length === 0,
      files: scopedFiles,
      reasons: scopedReasons
    },
    criticalFiles,
    delegationZero,
    flowMatrix,
    rollout: {
      gatePass,
      recommendedStage: gatePass ? "closeout_ready" : "hold",
      rollbackSuggested: false,
      reasons
    }
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function parseArgs(argv: string[]): {
  coveragePath: string;
  matrixPath: string;
  failOnGate: boolean;
} {
  const coveragePath = argv.find((item) => item.startsWith("--coverage-json="))?.split("=")[1];
  const matrixPath = argv.find((item) => item.startsWith("--matrix="))?.split("=")[1];
  const failOnGate = argv.includes("--fail-on-gate") || argv.includes("--strict");

  return {
    coveragePath:
      coveragePath ??
      resolve(__dirname, "../coverage/coverage-final.json"),
    matrixPath:
      matrixPath ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-closeout-flow-matrix.json"),
    failOnGate
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.coveragePath)) {
    process.stderr.write(
      `[text2sql-v2-focused-coverage-gate] coverage JSON not found: ${args.coveragePath}\n` +
        "Run backend Jest with --coverage before collecting this gate.\n"
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(args.matrixPath)) {
    process.stderr.write(
      `[text2sql-v2-focused-coverage-gate] flow matrix not found: ${args.matrixPath}\n`
    );
    process.exitCode = 1;
    return;
  }

  const report = evaluateFocusedCoverageGate({
    coverage: readJson<IstanbulCoverageMap>(args.coveragePath),
    matrix: readJson<CloseoutFlowMatrix>(args.matrixPath),
    coveragePath: args.coveragePath,
    matrixPath: args.matrixPath
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.failOnGate && !report.rollout.gatePass) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
