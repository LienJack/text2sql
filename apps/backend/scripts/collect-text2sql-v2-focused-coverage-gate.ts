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

interface RuntimeArtifactProducerRow {
  category: string;
  producerOwners: string[];
  evidenceOwners: string[];
  expectedTestFiles: string[];
  behaviorTestStatus: "covered" | "partial" | "missing" | "planned";
  coverageOwnerStatus: "covered" | "partial" | "missing" | "planned";
}

interface StreamLifecycleCoverageRow {
  stage: string;
  lifecycles: string[];
  owners: string[];
  expectedTestFiles: string[];
  behaviorTestStatus: "covered" | "partial" | "missing" | "planned";
  coverageOwnerStatus: "covered" | "partial" | "missing" | "planned";
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
  runtimeArtifactProducerRows?: RuntimeArtifactProducerRow[];
  streamLifecycleRows?: StreamLifecycleCoverageRow[];
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
    runtimeArtifactProducerRowCount: number;
    incompleteRuntimeArtifactProducerRows: Array<{ category: string; reasons: string[] }>;
    streamLifecycleRowCount: number;
    incompleteStreamLifecycleRows: Array<{ stage: string; reasons: string[] }>;
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
  fallbackFile?: string;
  label: string;
  pattern: RegExp;
}

const SCOPED_THRESHOLDS = {
  line: 80,
  branch: 70
};

const REQUIRED_RUNTIME_ARTIFACT_CATEGORIES = [
  "context_snippets",
  "schema_supplement",
  "prompt_input",
  "provider_output_summary",
  "validation_diagnostics",
  "correction_grounding",
  "execution_preview"
] as const;

const REQUIRED_STREAM_LIFECYCLE_STAGES = [
  "intake",
  "retrieve",
  "assemble-context",
  "semantic-plan",
  "generate-sql",
  "validate",
  "correct",
  "execute",
  "answer"
] as const;

const LAYERED_RUNTIME_STAGE_OWNER =
  "apps/backend/src/modules/conversation/runtime/stages/run-v2-langgraph.stage.ts";
const LAYERED_LANGGRAPH_GRAPH_OWNER =
  "apps/backend/src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph.graph.ts";
const LEGACY_LANGGRAPH_GRAPH_OWNER =
  "apps/backend/src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph.graph.ts";
const LAYERED_LANGGRAPH_RUNNER_OWNER =
  "apps/backend/src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph-runner.service.ts";
const LEGACY_LANGGRAPH_RUNNER_OWNER =
  "apps/backend/src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph-runner.service.ts";
const LAYERED_LANGGRAPH_RESULT_MAPPER_OWNER =
  "apps/backend/src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph-result.mapper.ts";
const LAYERED_INTAKE_NODE_OWNER =
  "apps/backend/src/modules/conversation/nodes/intake.node.ts";
const LAYERED_SQL_CORRECTION_OWNER =
  "apps/backend/src/modules/conversation/adapters/sql-correction.service.ts";
const LAYERED_SQL_VALIDATION_OWNER =
  "apps/backend/src/modules/conversation/adapters/sql-validation.service.ts";
const LAYERED_SEMANTIC_CONTEXT_PACK_OWNER =
  "apps/backend/src/modules/conversation/adapters/semantic-context-pack.service.ts";

const CRITICAL_FILE_THRESHOLDS: CriticalFileThreshold[] = [
  {
    file: LAYERED_SQL_CORRECTION_OWNER,
    line: 75
  },
  {
    file: LAYERED_LANGGRAPH_RUNNER_OWNER,
    line: 80
  },
  {
    file: LAYERED_SQL_VALIDATION_OWNER,
    line: 75
  },
  {
    file: LAYERED_SEMANTIC_CONTEXT_PACK_OWNER,
    line: 75
  },
  {
    file: "apps/backend/src/modules/llm/embedding-router.service.ts",
    line: 75
  },
  {
    file: LAYERED_RUNTIME_STAGE_OWNER,
    line: 80
  },
  {
    file: LAYERED_LANGGRAPH_GRAPH_OWNER,
    line: 80
  },
  {
    file: LAYERED_LANGGRAPH_RESULT_MAPPER_OWNER,
    line: 80
  },
  {
    file: LAYERED_INTAKE_NODE_OWNER,
    line: 75
  }
];

const DELEGATION_ZERO_SCAN_RULES: DelegationZeroScanRule[] = [
  {
    file: LAYERED_LANGGRAPH_GRAPH_OWNER,
    fallbackFile: LEGACY_LANGGRAPH_GRAPH_OWNER,
    label: "legacy runtime delegation",
    pattern: /\brunLegacyRuntime\b/
  },
  {
    file: LAYERED_LANGGRAPH_GRAPH_OWNER,
    fallbackFile: LEGACY_LANGGRAPH_GRAPH_OWNER,
    label: "legacy runner instance",
    pattern: /\blegacyRunner\b/
  },
  {
    file: LAYERED_LANGGRAPH_RUNNER_OWNER,
    fallbackFile: LEGACY_LANGGRAPH_RUNNER_OWNER,
    label: "legacy v2 runner import",
    pattern: /\bText2SqlV2RunnerService\b/
  },
  {
    file: LAYERED_LANGGRAPH_RUNNER_OWNER,
    fallbackFile: LEGACY_LANGGRAPH_RUNNER_OWNER,
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

function findForwardMigration(
  matrix: CloseoutFlowMatrix,
  file: string
): CriticalFileOwnerMigration | undefined {
  return matrix.criticalFileOwnerMigrations?.find((item) => item.from === file);
}

function findReverseMigration(
  matrix: CloseoutFlowMatrix,
  file: string
): CriticalFileOwnerMigration | undefined {
  return matrix.criticalFileOwnerMigrations?.find((item) => item.to === file);
}

function resolveCriticalFile(
  coverage: IstanbulCoverageMap,
  matrix: CloseoutFlowMatrix,
  threshold: CriticalFileThreshold
): { file: string; entry?: IstanbulFileCoverage; migrated: boolean; reason?: string; lineThreshold: number } {
  const forwardMigration = findForwardMigration(matrix, threshold.file);
  if (forwardMigration) {
    const migratedEntry = findCoverageEntry(coverage, forwardMigration.to);
    if (migratedEntry) {
      return {
        file: forwardMigration.to,
        entry: migratedEntry,
        migrated: true,
        reason: forwardMigration.reason,
        lineThreshold: forwardMigration.threshold?.line ?? threshold.line
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

  const reverseMigration = findReverseMigration(matrix, threshold.file);
  if (reverseMigration) {
    const fallbackEntry = findCoverageEntry(coverage, reverseMigration.from);
    if (fallbackEntry) {
      return {
        file: reverseMigration.from,
        entry: fallbackEntry,
        migrated: true,
        reason: reverseMigration.reason,
        lineThreshold: reverseMigration.threshold?.line ?? threshold.line
      };
    }
  }

  if (!forwardMigration && !reverseMigration) {
    return {
      file: threshold.file,
      migrated: false,
      reason: "critical_file_missing_without_owner_migration",
      lineThreshold: threshold.line
    };
  }

  if (forwardMigration) {
    return {
      file: forwardMigration.to,
      entry: findCoverageEntry(coverage, forwardMigration.to),
      migrated: true,
      reason: forwardMigration.reason,
      lineThreshold: forwardMigration.threshold?.line ?? threshold.line
    };
  }

  return {
    file: reverseMigration?.from ?? threshold.file,
    entry: reverseMigration
      ? findCoverageEntry(coverage, reverseMigration.from)
      : undefined,
    migrated: Boolean(reverseMigration),
    reason: reverseMigration?.reason,
    lineThreshold: reverseMigration?.threshold?.line ?? threshold.line
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
  const scannedFiles = new Set<string>();
  const violations: DelegationZeroViolation[] = [];

  for (const rule of DELEGATION_ZERO_SCAN_RULES) {
    const candidateFiles = [rule.file, rule.fallbackFile].filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
    const selectedFile = candidateFiles.find((file) =>
      existsSync(resolve(repoRoot, file))
    );

    if (!selectedFile) {
      violations.push({
        file: rule.file,
        label: `${rule.label}:missing_file`,
        pattern: rule.pattern.source
      });
      continue;
    }
    scannedFiles.add(selectedFile);
    const content = readFileSync(resolve(repoRoot, selectedFile), "utf-8");
    if (rule.pattern.test(content)) {
      violations.push({
        file: selectedFile,
        label: rule.label,
        pattern: rule.pattern.source
      });
    }
  }

  return {
    gatePass: violations.length === 0,
    scannedFiles: unique([...scannedFiles]),
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

  const artifactProducerRows = matrix.runtimeArtifactProducerRows ?? [];
  const incompleteRuntimeArtifactProducerRows = REQUIRED_RUNTIME_ARTIFACT_CATEGORIES.flatMap(
    (category) => {
      const row = artifactProducerRows.find((item) => item.category === category);
      const reasons: string[] = [];
      if (!row) {
        reasons.push("missing_artifact_producer_row");
        return [{ category, reasons }];
      }
      if (row.producerOwners.length === 0) {
        reasons.push("missing_artifact_producer_owners");
      }
      if (row.evidenceOwners.length === 0) {
        reasons.push("missing_artifact_evidence_owners");
      }
      if (row.expectedTestFiles.length === 0) {
        reasons.push("missing_artifact_behavior_tests");
      }
      if (row.behaviorTestStatus !== "covered") {
        reasons.push(`behavior_test_status_${row.behaviorTestStatus}`);
      }
      if (row.coverageOwnerStatus !== "covered") {
        reasons.push(`coverage_owner_status_${row.coverageOwnerStatus}`);
      }
      return reasons.length > 0 ? [{ category, reasons }] : [];
    }
  );

  const streamLifecycleRows = matrix.streamLifecycleRows ?? [];
  const incompleteStreamLifecycleRows = REQUIRED_STREAM_LIFECYCLE_STAGES.flatMap(
    (stage) => {
      const row = streamLifecycleRows.find((item) => item.stage === stage);
      const reasons: string[] = [];
      if (!row) {
        reasons.push("missing_stream_lifecycle_row");
        return [{ stage, reasons }];
      }
      if (!row.lifecycles.includes("running")) {
        reasons.push("missing_running_lifecycle");
      }
      if (
        !row.lifecycles.includes("completed") &&
        !row.lifecycles.includes("skipped") &&
        !row.lifecycles.includes("failed") &&
        !row.lifecycles.includes("clarification")
      ) {
        reasons.push("missing_terminal_lifecycle");
      }
      if (row.owners.length === 0) {
        reasons.push("missing_stream_lifecycle_owners");
      }
      if (row.expectedTestFiles.length === 0) {
        reasons.push("missing_stream_lifecycle_tests");
      }
      if (row.behaviorTestStatus !== "covered") {
        reasons.push(`behavior_test_status_${row.behaviorTestStatus}`);
      }
      if (row.coverageOwnerStatus !== "covered") {
        reasons.push(`coverage_owner_status_${row.coverageOwnerStatus}`);
      }
      return reasons.length > 0 ? [{ stage, reasons }] : [];
    }
  );

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
    runtimeArtifactProducerRowCount: artifactProducerRows.length,
    incompleteRuntimeArtifactProducerRows,
    streamLifecycleRowCount: streamLifecycleRows.length,
    incompleteStreamLifecycleRows,
    runtimePathReasons,
    gatePass:
      incompleteNodes.length === 0 &&
      incompleteEvalFixtureFamilies.length === 0 &&
      incompleteStrictCompletionRows.length === 0 &&
      incompleteRuntimeCoverageRows.length === 0 &&
      incompleteRuntimeArtifactProducerRows.length === 0 &&
      incompleteStreamLifecycleRows.length === 0 &&
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
    ...(matrix.runtimeArtifactProducerRows ?? []).flatMap((row) =>
      row.producerOwners.map(effectiveOwner)
    ),
    ...(matrix.streamLifecycleRows ?? []).flatMap((row) =>
      row.owners.map(effectiveOwner)
    ),
    ...(matrix.criticalFileOwnerMigrations ?? []).map((item) => item.to)
  ]);
}

function resolveScopedCoverageEntry(
  coverage: IstanbulCoverageMap,
  matrix: CloseoutFlowMatrix,
  file: string
): IstanbulFileCoverage | undefined {
  const directEntry = findCoverageEntry(coverage, file);
  if (directEntry) {
    return directEntry;
  }
  const reverseMigration = findReverseMigration(matrix, file);
  if (reverseMigration) {
    return findCoverageEntry(coverage, reverseMigration.from);
  }
  return undefined;
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
    const entry = resolveScopedCoverageEntry(params.coverage, params.matrix, file);
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
    ...flowMatrix.incompleteRuntimeArtifactProducerRows.map(
      (item) => `artifact_producer:${item.category}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.incompleteStreamLifecycleRows.map(
      (item) => `stream_lifecycle:${item.stage}:${item.reasons.join("|")}`
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
