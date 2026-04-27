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

export interface CloseoutFlowMatrix {
  version: string;
  nodes: FlowMatrixNode[];
  evalFixtureFamilies: EvalFixtureFamily[];
  criticalFileOwnerMigrations?: CriticalFileOwnerMigration[];
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
  flowMatrix: {
    version: string;
    nodeCount: number;
    completeNodeCount: number;
    incompleteNodes: Array<{ id: string; reasons: string[] }>;
    evalFixtureFamilyCount: number;
    incompleteEvalFixtureFamilies: Array<{ family: string; reasons: string[] }>;
    gatePass: boolean;
  };
  rollout: {
    gatePass: boolean;
    recommendedStage: "closeout_ready" | "hold";
    rollbackSuggested: boolean;
    reasons: string[];
  };
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
    file: "apps/backend/src/modules/conversation/agent/v2/text2sql-v2-runner.service.ts",
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
    file: "apps/backend/src/modules/conversation/text2sql/stages/run-v2-state-machine.stage.ts",
    line: 80
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
  const directEntry = findCoverageEntry(coverage, threshold.file);
  if (directEntry) {
    return {
      file: threshold.file,
      entry: directEntry,
      migrated: false,
      lineThreshold: threshold.line
    };
  }

  const migration = matrix.criticalFileOwnerMigrations?.find(
    (item) => item.from === threshold.file
  );
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

  return {
    version: matrix.version,
    nodeCount: matrix.nodes.length,
    completeNodeCount: matrix.nodes.length - incompleteNodes.length,
    incompleteNodes,
    evalFixtureFamilyCount: matrix.evalFixtureFamilies.length,
    incompleteEvalFixtureFamilies,
    gatePass: incompleteNodes.length === 0 && incompleteEvalFixtureFamilies.length === 0
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
  const flowMatrix = evaluateFlowMatrix(params.matrix);
  const matrixReasons = [
    ...flowMatrix.incompleteNodes.map(
      (item) => `flow_node:${item.id}:${item.reasons.join("|")}`
    ),
    ...flowMatrix.incompleteEvalFixtureFamilies.map(
      (item) => `eval_family:${item.family}:${item.reasons.join("|")}`
    )
  ];

  const reasons = [...scopedReasons, ...criticalReasons, ...matrixReasons];
  const gatePass =
    scopedReasons.length === 0 &&
    criticalFiles.every((item) => item.gatePass) &&
    flowMatrix.gatePass;

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
