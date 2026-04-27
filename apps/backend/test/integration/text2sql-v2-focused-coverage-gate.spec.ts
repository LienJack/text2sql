import {
  evaluateFocusedCoverageGate,
  type CloseoutFlowMatrix
} from "../../scripts/collect-text2sql-v2-focused-coverage-gate";

const CRITICAL_FILES = [
  "apps/backend/src/modules/conversation/agent/v2/sql-correction.service.ts",
  "apps/backend/src/modules/conversation/agent/v2/text2sql-v2-runner.service.ts",
  "apps/backend/src/modules/conversation/agent/v2/sql-validation.service.ts",
  "apps/backend/src/modules/conversation/agent/v2/semantic-context-pack.service.ts",
  "apps/backend/src/modules/llm/embedding-router.service.ts",
  "apps/backend/src/modules/conversation/text2sql/stages/run-v2-state-machine.stage.ts"
];

function fileCoverage(params: {
  file: string;
  totalLines?: number;
  coveredLines?: number;
  totalBranches?: number;
  coveredBranches?: number;
}) {
  const totalLines = params.totalLines ?? 10;
  const coveredLines = params.coveredLines ?? totalLines;
  const totalBranches = params.totalBranches ?? 10;
  const coveredBranches = params.coveredBranches ?? totalBranches;

  return {
    path: params.file,
    statementMap: Object.fromEntries(
      Array.from({ length: totalLines }, (_, index) => [
        String(index),
        { start: { line: index + 1 } }
      ])
    ),
    s: Object.fromEntries(
      Array.from({ length: totalLines }, (_, index) => [
        String(index),
        index < coveredLines ? 1 : 0
      ])
    ),
    branchMap: Object.fromEntries(
      Array.from({ length: totalBranches }, (_, index) => [String(index), {}])
    ),
    b: Object.fromEntries(
      Array.from({ length: totalBranches }, (_, index) => [
        String(index),
        [index < coveredBranches ? 1 : 0]
      ])
    )
  };
}

function coverageFor(files: string[], overrides: Record<string, Partial<{
  totalLines: number;
  coveredLines: number;
  totalBranches: number;
  coveredBranches: number;
}>> = {}) {
  return Object.fromEntries(
    files.map((file) => [
      `/repo/${file}`,
      fileCoverage({
        file: `/repo/${file}`,
        ...overrides[file]
      })
    ])
  );
}

function coveredMatrix(): CloseoutFlowMatrix {
  return {
    version: "test",
    nodes: [
      {
        id: "A.context-envelope",
        requirementIds: ["R1"],
        implementationOwners: [CRITICAL_FILES[0]],
        evidenceOwners: ["run.trace.v2"],
        expectedTestFiles: ["apps/backend/test/unit/text2sql-v2-runner.spec.ts"],
        gateRelevance: true,
        behaviorTestStatus: "covered",
        coverageOwnerStatus: "covered"
      },
      {
        id: "M.final-answer-replay-artifacts",
        requirementIds: ["R4"],
        implementationOwners: [CRITICAL_FILES[1]],
        evidenceOwners: ["run.delivery.evidence.v2"],
        expectedTestFiles: ["apps/backend/test/unit/text2sql-stream-event.mapper.spec.ts"],
        gateRelevance: true,
        behaviorTestStatus: "covered",
        coverageOwnerStatus: "covered"
      }
    ],
    evalFixtureFamilies: [
      {
        family: "dense-unavailable",
        evalCases: ["zh-dense-unavailable-008"],
        behaviorTests: ["apps/backend/test/unit/text2sql-v2-embedding-provider.spec.ts"],
        flowNodes: ["A.context-envelope"]
      }
    ],
    criticalFileOwnerMigrations: []
  };
}

describe("text2sql v2 focused coverage gate", () => {
  it("passes when scoped totals, critical files, and traceability are complete", () => {
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(CRITICAL_FILES),
      matrix: coveredMatrix(),
      coveragePath: "/tmp/coverage-final.json",
      matrixPath: "/tmp/matrix.json",
      generatedAt: "2026-04-27T00:00:00.000Z"
    });

    expect(report.scoped.linePct).toBe(100);
    expect(report.scoped.branchPct).toBe(100);
    expect(report.criticalFiles.every((item) => item.gatePass)).toBe(true);
    expect(report.flowMatrix.gatePass).toBe(true);
    expect(report.rollout).toMatchObject({
      gatePass: true,
      recommendedStage: "closeout_ready",
      rollbackSuggested: false,
      reasons: []
    });
  });

  it("fails when a critical file is below its line threshold", () => {
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(CRITICAL_FILES, {
        [CRITICAL_FILES[0]]: { coveredLines: 7, totalLines: 10 }
      }),
      matrix: coveredMatrix()
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.rollout.reasons).toContain(
      `critical:${CRITICAL_FILES[0]}:line_coverage_below_75`
    );
  });

  it("fails when a critical file is missing or has zero coverage", () => {
    const [missingFile, zeroFile, ...remainingFiles] = CRITICAL_FILES;
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor([zeroFile, ...remainingFiles], {
        [zeroFile]: { coveredLines: 0, totalLines: 10 }
      }),
      matrix: coveredMatrix()
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.rollout.reasons).toContain(
      `critical:${missingFile}:critical_file_missing_without_owner_migration`
    );
    expect(report.rollout.reasons).toContain(
      `critical:${zeroFile}:critical_file_zero_line_coverage`
    );
  });

  it("blocks closeout when eval fixtures lack behavior-test traceability", () => {
    const matrix = coveredMatrix();
    matrix.evalFixtureFamilies[0] = {
      ...matrix.evalFixtureFamilies[0],
      behaviorTests: []
    };

    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(CRITICAL_FILES),
      matrix
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.flowMatrix.incompleteEvalFixtureFamilies).toEqual([
      {
        family: "dense-unavailable",
        reasons: ["missing_behavior_test_traceability"]
      }
    ]);
  });

  it("requires explicit owner migration metadata when a critical file is replaced", () => {
    const replacementFile =
      "apps/backend/src/modules/conversation/agent/v2/sql-correction-decision.service.ts";
    const missingOriginal = CRITICAL_FILES.slice(1);
    const matrixWithoutMigration = coveredMatrix();

    const missingMigrationReport = evaluateFocusedCoverageGate({
      coverage: coverageFor([...missingOriginal, replacementFile]),
      matrix: matrixWithoutMigration
    });

    expect(missingMigrationReport.rollout.gatePass).toBe(false);
    expect(missingMigrationReport.rollout.reasons).toContain(
      `critical:${CRITICAL_FILES[0]}:critical_file_missing_without_owner_migration`
    );

    const matrixWithMigration = coveredMatrix();
    matrixWithMigration.criticalFileOwnerMigrations = [
      {
        from: CRITICAL_FILES[0],
        to: replacementFile,
        reason: "sql correction decisions moved behind a narrower owner module",
        threshold: { line: 75 }
      }
    ];

    const migratedReport = evaluateFocusedCoverageGate({
      coverage: coverageFor([...missingOriginal, replacementFile]),
      matrix: matrixWithMigration
    });

    expect(migratedReport.rollout.gatePass).toBe(true);
    expect(migratedReport.criticalFiles[0]).toMatchObject({
      file: CRITICAL_FILES[0],
      effectiveFile: replacementFile,
      migrated: true,
      gatePass: true
    });
  });
});
