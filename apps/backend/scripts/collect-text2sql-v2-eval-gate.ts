import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  NoLegacyCompatReport
} from "../../../scripts/check-text2sql-no-legacy-compat";
import { evaluateNoLegacyCompat } from "../../../scripts/check-text2sql-no-legacy-compat";
import {
  evaluateFocusedCoverageGate,
  type CloseoutFlowMatrix,
  type FocusedCoverageGateReport
} from "./collect-text2sql-v2-focused-coverage-gate";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase,
  type Text2SqlV2EvalSummary
} from "../src/modules/conversation/agent/v2/text2sql-v2-evaluation.service";

interface CharacterizationSurface {
  version: string;
  stageOrder: string[];
  stageArtifactCount: number;
  hasSemanticPlan: boolean;
}

interface CharacterizationCase {
  id: string;
  scenario: string;
  expectedStageOrder: string[];
  surfaces: Record<string, CharacterizationSurface>;
}

interface CharacterizationSummary {
  totalCases: number;
  parityPassCount: number;
  parityCoverageRate: number;
  gatePass: boolean;
  reasons: string[];
}

interface GateSnapshot {
  gatePass: boolean;
  reasons: string[];
}

interface FocusedCoverageGateSnapshot extends GateSnapshot {
  coveragePath: string;
  matrixPath: string;
  report?: FocusedCoverageGateReport;
}

interface NoLegacyGateSnapshot extends GateSnapshot {
  scannedCount: number;
}

interface Text2SqlV2CloseoutGateReport {
  generatedAt: string;
  fixturePath: string;
  characterizationFixturePath: string;
  summary: Text2SqlV2EvalSummary;
  characterization: CharacterizationSummary;
  closeoutGates: {
    evalMetrics: GateSnapshot;
    evalTraceability: GateSnapshot;
    characterization: GateSnapshot;
    noLegacyCompat: NoLegacyGateSnapshot;
    focusedCoverage: FocusedCoverageGateSnapshot;
  };
  rollout: {
    gatePass: boolean;
    recommendedStage: "direct_v2_go" | "hold" | "rollback_or_hold";
    rollbackSuggested: boolean;
    reasons: string[];
  };
}

export function summarizeCharacterization(cases: CharacterizationCase[]): CharacterizationSummary {
  const surfaceNames = ["sync", "stream", "replay", "runView", "saveView"];
  if (cases.length === 0) {
    return {
      totalCases: 0,
      parityPassCount: 0,
      parityCoverageRate: 0,
      gatePass: false,
      reasons: ["characterization_fixture_empty"]
    };
  }

  let parityPassCount = 0;
  const failedIds: string[] = [];

  for (const item of cases) {
    const surfaceRecords = surfaceNames.map((name) => item.surfaces[name]);
    const hasMissingSurface = surfaceRecords.some((surface) => !surface);
    if (hasMissingSurface || item.expectedStageOrder.length === 0) {
      failedIds.push(item.id);
      continue;
    }

    const stageOrderMatch = surfaceRecords.every((surface) =>
      JSON.stringify(surface.stageOrder) === JSON.stringify(item.expectedStageOrder)
    );
    const versionMatch = surfaceRecords.every((surface) => surface.version === "v2");
    const artifactCountMatch = surfaceRecords.every(
      (surface) => surface.stageArtifactCount >= item.expectedStageOrder.length
    );
    const semanticPlanParity =
      new Set(surfaceRecords.map((surface) => surface.hasSemanticPlan)).size === 1;

    if (stageOrderMatch && versionMatch && artifactCountMatch && semanticPlanParity) {
      parityPassCount += 1;
    } else {
      failedIds.push(item.id);
    }
  }

  const parityCoverageRate = Number((parityPassCount / cases.length).toFixed(4));
  const reasons =
    failedIds.length > 0
      ? [`characterization_parity_failed:${failedIds.join(",")}`]
      : [];

  return {
    totalCases: cases.length,
    parityPassCount,
    parityCoverageRate,
    gatePass: failedIds.length === 0,
    reasons
  };
}

function traceabilityReasons(summary: Text2SqlV2EvalSummary): string[] {
  return summary.traceability.familyCoverage.flatMap((item) =>
    item.reasons.map((reason) => `family:${item.family}:${reason}`)
  );
}

function buildNoLegacyGateSnapshot(report: NoLegacyCompatReport): NoLegacyGateSnapshot {
  const reasons = report.violations.map(
    (item) => `${item.file}:${item.line}:${item.column}:${item.label}`
  );
  return {
    gatePass: report.gatePass,
    reasons,
    scannedCount: report.scannedCount
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function collectFocusedCoverageGate(params: {
  coveragePath: string;
  matrixPath: string;
}): FocusedCoverageGateSnapshot {
  const missingReasons: string[] = [];
  if (!existsSync(params.coveragePath)) {
    missingReasons.push("coverage_json_missing");
  }
  if (!existsSync(params.matrixPath)) {
    missingReasons.push("flow_matrix_missing");
  }
  if (missingReasons.length > 0) {
    return {
      gatePass: false,
      reasons: missingReasons,
      coveragePath: params.coveragePath,
      matrixPath: params.matrixPath
    };
  }

  const report = evaluateFocusedCoverageGate({
    coverage: readJson<Record<string, unknown>>(params.coveragePath) as never,
    matrix: readJson<CloseoutFlowMatrix>(params.matrixPath),
    coveragePath: params.coveragePath,
    matrixPath: params.matrixPath
  });
  return {
    gatePass: report.rollout.gatePass,
    reasons: report.rollout.reasons,
    coveragePath: params.coveragePath,
    matrixPath: params.matrixPath,
    report
  };
}

export function buildCloseoutRollout(params: {
  summary: Text2SqlV2EvalSummary;
  characterization: CharacterizationSummary;
  noLegacy: NoLegacyGateSnapshot;
  focusedCoverage: FocusedCoverageGateSnapshot;
}): {
  gatePass: boolean;
  recommendedStage: "direct_v2_go" | "hold" | "rollback_or_hold";
  rollbackSuggested: boolean;
  reasons: string[];
  closeoutGates: Text2SqlV2CloseoutGateReport["closeoutGates"];
} {
  const evalMetrics: GateSnapshot = {
    gatePass: params.summary.rollout.gatePass,
    reasons: params.summary.rollout.reasons
  };
  const evalTraceability: GateSnapshot = {
    gatePass: params.summary.traceability.gatePass,
    reasons: traceabilityReasons(params.summary)
  };
  const characterizationGate: GateSnapshot = {
    gatePass: params.characterization.gatePass,
    reasons: params.characterization.reasons
  };

  const reasons = [
    ...evalMetrics.reasons.map((item) => `eval:${item}`),
    ...evalTraceability.reasons.map((item) => `traceability:${item}`),
    ...characterizationGate.reasons.map((item) => `characterization:${item}`),
    ...params.noLegacy.reasons.map((item) => `no_legacy:${item}`),
    ...params.focusedCoverage.reasons.map((item) => `focused_coverage:${item}`)
  ];

  const gatePass =
    evalMetrics.gatePass &&
    evalTraceability.gatePass &&
    characterizationGate.gatePass &&
    params.noLegacy.gatePass &&
    params.focusedCoverage.gatePass;

  const rollbackSuggested =
    params.summary.rollout.rollbackSuggested ||
    reasons.some((item) => item.startsWith("focused_coverage:critical:"));

  return {
    gatePass,
    recommendedStage: gatePass
      ? "direct_v2_go"
      : rollbackSuggested
        ? "rollback_or_hold"
        : "hold",
    rollbackSuggested,
    reasons,
    closeoutGates: {
      evalMetrics,
      evalTraceability,
      characterization: characterizationGate,
      noLegacyCompat: params.noLegacy,
      focusedCoverage: params.focusedCoverage
    }
  };
}

export async function collectText2SqlV2EvalGate(params: {
  fixturePath: string;
  characterizationFixturePath: string;
  focusedCoveragePath: string;
  focusedMatrixPath: string;
}): Promise<Text2SqlV2CloseoutGateReport> {
  const cases = readJson<Text2SqlV2EvalCase[]>(params.fixturePath);
  const characterizationCases = readJson<CharacterizationCase[]>(
    params.characterizationFixturePath
  );

  const service = new Text2SqlV2EvaluationService();
  const summary = service.summarize(cases);
  const characterization = summarizeCharacterization(characterizationCases);
  const noLegacyReport = await evaluateNoLegacyCompat();
  const noLegacy = buildNoLegacyGateSnapshot(noLegacyReport);
  const focusedCoverage = collectFocusedCoverageGate({
    coveragePath: params.focusedCoveragePath,
    matrixPath: params.focusedMatrixPath
  });

  const closeout = buildCloseoutRollout({
    summary,
    characterization,
    noLegacy,
    focusedCoverage
  });

  return {
    generatedAt: new Date().toISOString(),
    fixturePath: params.fixturePath,
    characterizationFixturePath: params.characterizationFixturePath,
    summary,
    characterization,
    closeoutGates: closeout.closeoutGates,
    rollout: {
      gatePass: closeout.gatePass,
      recommendedStage: closeout.recommendedStage,
      rollbackSuggested: closeout.rollbackSuggested,
      reasons: closeout.reasons
    }
  };
}

function parseArgs(argv: string[]): {
  fixturePath: string;
  characterizationFixturePath: string;
  focusedCoveragePath: string;
  focusedMatrixPath: string;
  failOnGate: boolean;
} {
  const fixturePath = argv.find((item) => item.startsWith("--eval-fixture="))?.split("=")[1];
  const characterizationFixturePath = argv
    .find((item) => item.startsWith("--characterization-fixture="))
    ?.split("=")[1];
  const focusedCoveragePath = argv
    .find((item) => item.startsWith("--coverage-json="))
    ?.split("=")[1];
  const focusedMatrixPath = argv.find((item) => item.startsWith("--matrix="))?.split("=")[1];
  const failOnGate = argv.includes("--fail-on-gate") || argv.includes("--strict");

  return {
    fixturePath:
      fixturePath ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-eval-cases.json"),
    characterizationFixturePath:
      characterizationFixturePath ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-characterization-cases.json"),
    focusedCoveragePath:
      focusedCoveragePath ??
      resolve(__dirname, "../coverage/coverage-final.json"),
    focusedMatrixPath:
      focusedMatrixPath ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-closeout-flow-matrix.json"),
    failOnGate
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await collectText2SqlV2EvalGate({
    fixturePath: args.fixturePath,
    characterizationFixturePath: args.characterizationFixturePath,
    focusedCoveragePath: args.focusedCoveragePath,
    focusedMatrixPath: args.focusedMatrixPath
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.failOnGate && !report.rollout.gatePass) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
