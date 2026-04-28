import {
  evaluateFocusedCoverageGate,
  type CloseoutFlowMatrix
} from "../../scripts/collect-text2sql-v2-focused-coverage-gate";

const LEGACY_CRITICAL_FILES = [
  "apps/backend/src/modules/conversation/adapters/text2sql-v2/sql-correction.service.ts",
  "apps/backend/src/modules/conversation/runtime/text2sql-v2/langgraph/text2sql-v2-langgraph-runner.service.ts",
  "apps/backend/src/modules/conversation/adapters/text2sql-v2/sql-validation.service.ts",
  "apps/backend/src/modules/conversation/adapters/text2sql-v2/semantic-context-pack.service.ts",
  "apps/backend/src/modules/llm/embedding-router.service.ts",
  "apps/backend/src/modules/conversation/runtime/text2sql-v2/stages/run-v2-langgraph.stage.ts"
] as const;

const LANGGRAPH_CRITICAL_FILES = [
  "apps/backend/src/modules/conversation/runtime/text2sql-v2/langgraph/text2sql-v2-langgraph.graph.ts",
  "apps/backend/src/modules/conversation/runtime/text2sql-v2/langgraph/text2sql-v2-langgraph-result.mapper.ts",
  "apps/backend/src/modules/conversation/nodes/text2sql-v2/intake.node.ts"
] as const;

const LAYERED_LANGGRAPH_RUNNER_OWNER = LEGACY_CRITICAL_FILES[1];
const LAYERED_LANGGRAPH_STAGE_OWNER = LEGACY_CRITICAL_FILES[5];
const PRE_LAYERED_LANGGRAPH_RUNNER_OWNER =
  "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-runner.service.ts";
const PRE_LAYERED_LANGGRAPH_STAGE_OWNER =
  "apps/backend/src/modules/conversation/text2sql/stages/run-v2-langgraph.stage.ts";
const PRE_LAYERED_LANGGRAPH_GRAPH_OWNER =
  "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph.ts";
const PRE_LAYERED_LANGGRAPH_RESULT_MAPPER_OWNER =
  "apps/backend/src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-result.mapper.ts";
const PRE_LAYERED_INTAKE_NODE_OWNER =
  "apps/backend/src/modules/conversation/agent/v2/langgraph/nodes/intake.node.ts";
const LEGACY_RUNNER_OWNER =
  "apps/backend/src/modules/conversation/agent/v2/text2sql-v2-runner.service.ts";
const LEGACY_STAGE_OWNER =
  "apps/backend/src/modules/conversation/text2sql/stages/run-v2-state-machine.stage.ts";

const ALL_COVERAGE_FILES = [
  ...LEGACY_CRITICAL_FILES,
  ...LANGGRAPH_CRITICAL_FILES,
  PRE_LAYERED_LANGGRAPH_RUNNER_OWNER,
  PRE_LAYERED_LANGGRAPH_STAGE_OWNER,
  PRE_LAYERED_LANGGRAPH_GRAPH_OWNER,
  PRE_LAYERED_LANGGRAPH_RESULT_MAPPER_OWNER,
  PRE_LAYERED_INTAKE_NODE_OWNER
] as const;

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

function coverageFor(
  files: readonly string[],
  overrides: Record<
    string,
    Partial<{
      totalLines: number;
      coveredLines: number;
      totalBranches: number;
      coveredBranches: number;
    }>
  > = {}
) {
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
        implementationOwners: [LEGACY_CRITICAL_FILES[0]],
        evidenceOwners: ["run.trace.v2"],
        expectedTestFiles: ["apps/backend/test/unit/text2sql-v2-runner.spec.ts"],
        gateRelevance: true,
        behaviorTestStatus: "covered",
        coverageOwnerStatus: "covered",
        canonicalRuntimeOwners: [
          LAYERED_LANGGRAPH_STAGE_OWNER,
          LAYERED_LANGGRAPH_RUNNER_OWNER
        ],
        canonicalOwnerStatus: "planned",
        contractAssertionMode: "behavior_contract"
      },
      {
        id: "M.final-answer-replay-artifacts",
        requirementIds: ["R4"],
        implementationOwners: [LEGACY_CRITICAL_FILES[1]],
        evidenceOwners: ["run.delivery.evidence.v2"],
        expectedTestFiles: ["apps/backend/test/unit/text2sql-stream-event.mapper.spec.ts"],
        gateRelevance: true,
        behaviorTestStatus: "covered",
        coverageOwnerStatus: "covered",
        canonicalRuntimeOwners: [LANGGRAPH_CRITICAL_FILES[1]],
        canonicalOwnerStatus: "planned",
        contractAssertionMode: "behavior_contract"
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
    criticalFileOwnerMigrations: [
      {
        from: PRE_LAYERED_LANGGRAPH_RUNNER_OWNER,
        to: LAYERED_LANGGRAPH_RUNNER_OWNER,
        reason:
          "Layered runtime migration moves the canonical LangGraph runner owner under conversation/runtime",
        threshold: { line: 80 }
      },
      {
        from: PRE_LAYERED_LANGGRAPH_STAGE_OWNER,
        to: LAYERED_LANGGRAPH_STAGE_OWNER,
        reason:
          "Layered runtime migration moves the canonical workflow seam stage under conversation/runtime",
        threshold: { line: 80 }
      },
      {
        from: PRE_LAYERED_LANGGRAPH_GRAPH_OWNER,
        to: LANGGRAPH_CRITICAL_FILES[0],
        reason:
          "Layered runtime migration moves the canonical graph owner under conversation/runtime",
        threshold: { line: 80 }
      },
      {
        from: PRE_LAYERED_LANGGRAPH_RESULT_MAPPER_OWNER,
        to: LANGGRAPH_CRITICAL_FILES[1],
        reason:
          "Layered runtime migration moves result mapping ownership under conversation/runtime",
        threshold: { line: 80 }
      },
      {
        from: PRE_LAYERED_INTAKE_NODE_OWNER,
        to: LANGGRAPH_CRITICAL_FILES[2],
        reason:
          "Layered runtime migration moves canonical node ownership under conversation/nodes",
        threshold: { line: 75 }
      },
      {
        from: LEGACY_RUNNER_OWNER,
        to: LAYERED_LANGGRAPH_RUNNER_OWNER,
        reason:
          "Legacy long-form v2 runner ownership is superseded by the layered LangGraph runtime seam",
        threshold: { line: 80 }
      },
      {
        from: LEGACY_STAGE_OWNER,
        to: LAYERED_LANGGRAPH_STAGE_OWNER,
        reason:
          "Legacy state-machine stage ownership is superseded by the layered LangGraph stage seam",
        threshold: { line: 80 }
      }
    ],
    runtimeCoverageRows: [
      {
        id: "langgraph-runtime.seam",
        owners: [LAYERED_LANGGRAPH_STAGE_OWNER, LAYERED_LANGGRAPH_RUNNER_OWNER],
        expectedTestFiles: [
          "apps/backend/test/unit/text2sql-workflow-runner.spec.ts",
          "apps/backend/test/unit/text2sql-v2-langgraph-runtime.spec.ts"
        ],
        coverageOwnerStatus: "planned",
        critical: true,
        blocker:
          "Active workflow seam cannot close out until the LangGraph stage and runner land."
      },
      {
        id: "langgraph-runtime.topology",
        owners: [...LANGGRAPH_CRITICAL_FILES],
        expectedTestFiles: [
          "apps/backend/test/unit/text2sql-v2-langgraph-runtime.spec.ts"
        ],
        coverageOwnerStatus: "planned",
        critical: true,
        blocker:
          "Canonical graph topology and mapper coverage must exist before the runtime cutover can pass."
      }
    ],
    runtimePaths: {
      currentActivePath: [
        "apps/backend/src/modules/conversation/text2sql/text2sql-workflow-runner.service.ts",
        PRE_LAYERED_LANGGRAPH_STAGE_OWNER,
        PRE_LAYERED_LANGGRAPH_RUNNER_OWNER
      ],
      targetActivePath: [
        "apps/backend/src/modules/conversation/text2sql/text2sql-workflow-runner.service.ts",
        LAYERED_LANGGRAPH_STAGE_OWNER,
        LAYERED_LANGGRAPH_RUNNER_OWNER
      ],
      criticalOwners: [
        LAYERED_LANGGRAPH_STAGE_OWNER,
        LAYERED_LANGGRAPH_RUNNER_OWNER,
        ...LANGGRAPH_CRITICAL_FILES
      ],
      delegationPolicy: "phase_a_delegation_zero",
      delegationOwners: [LANGGRAPH_CRITICAL_FILES[0], LAYERED_LANGGRAPH_RUNNER_OWNER],
      delegationForbiddenPatterns: [
        "runLegacyRuntime",
        "legacyRunner",
        "Text2SqlV2RunnerService"
      ],
      blockerPolicy:
        "Closeout must stay blocked if a canonical LangGraph owner is missing or only legacy runtime-detail assertions remain."
    }
  };
}

describe("text2sql v2 focused coverage gate", () => {
  it("passes when scoped totals, critical files, and traceability are complete", () => {
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(ALL_COVERAGE_FILES),
      matrix: coveredMatrix(),
      coveragePath: "/tmp/coverage-final.json",
      matrixPath: "/tmp/matrix.json",
      generatedAt: "2026-04-27T00:00:00.000Z"
    });

    expect(report.scoped.linePct).toBe(100);
    expect(report.scoped.branchPct).toBe(100);
    expect(report.criticalFiles.every((item) => item.gatePass)).toBe(true);
    expect(report.delegationZero.gatePass).toBe(true);
    expect(report.flowMatrix.gatePass).toBe(true);
    expect(report.flowMatrix.incompleteRuntimeCoverageRows).toEqual([]);
    expect(report.rollout).toMatchObject({
      gatePass: true,
      recommendedStage: "closeout_ready",
      rollbackSuggested: false,
      reasons: []
    });
  });

  it("fails when a critical file is below its line threshold", () => {
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(ALL_COVERAGE_FILES, {
        [LEGACY_CRITICAL_FILES[0]]: { coveredLines: 7, totalLines: 10 }
      }),
      matrix: coveredMatrix()
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.rollout.reasons).toContain(
      `critical:${LEGACY_CRITICAL_FILES[0]}:line_coverage_below_75`
    );
  });

  it("fails when phase-A delegation=0 static scan reports legacy runtime wiring", () => {
    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(ALL_COVERAGE_FILES),
      matrix: coveredMatrix(),
      delegationZeroOverride: {
        gatePass: false,
        scannedFiles: [LAYERED_LANGGRAPH_RUNNER_OWNER],
        violations: [
          {
            file: LAYERED_LANGGRAPH_RUNNER_OWNER,
            label: "legacy v2 runner import",
            pattern: "Text2SqlV2RunnerService"
          }
        ],
        reasons: [
          `${LAYERED_LANGGRAPH_RUNNER_OWNER}:legacy v2 runner import:Text2SqlV2RunnerService`
        ]
      }
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.rollout.reasons).toContain(
      `delegation_zero:${LAYERED_LANGGRAPH_RUNNER_OWNER}:legacy v2 runner import:Text2SqlV2RunnerService`
    );
  });

  it("fails when a critical file is missing or has zero coverage", () => {
    const [missingFile, zeroFile, ...remainingFiles] = ALL_COVERAGE_FILES;
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
      coverage: coverageFor(ALL_COVERAGE_FILES),
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

  it("fails when a canonical workflow node loses its planned LangGraph owner mapping", () => {
    const matrix = coveredMatrix();
    matrix.nodes[0] = {
      ...matrix.nodes[0],
      canonicalRuntimeOwners: []
    };

    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(ALL_COVERAGE_FILES),
      matrix
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.flowMatrix.incompleteNodes).toEqual([
      {
        id: "A.context-envelope",
        reasons: ["missing_canonical_runtime_owners"]
      }
    ]);
  });

  it("fails when strict-completion rows are missing behavior traceability", () => {
    const matrix = coveredMatrix();
    matrix.strictCompletionRows = [
      {
        id: "SC.metadata-grounding",
        implementationOwners: [
          "apps/backend/src/modules/conversation/agent/v2/langgraph/nodes/answer.node.ts"
        ],
        evidenceOwners: ["run.delivery.evidence.metadataAnswer"],
        expectedTestFiles: [],
        behaviorTestStatus: "partial",
        coverageOwnerStatus: "covered",
        contractAssertionMode: "behavior_contract"
      }
    ];

    const report = evaluateFocusedCoverageGate({
      coverage: coverageFor(ALL_COVERAGE_FILES),
      matrix
    });

    expect(report.rollout.gatePass).toBe(false);
    expect(report.flowMatrix.incompleteStrictCompletionRows).toEqual([
      {
        id: "SC.metadata-grounding",
        reasons: ["missing_expected_behavior_tests", "behavior_test_status_partial"]
      }
    ]);
    expect(report.rollout.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "strict_row:SC.metadata-grounding:missing_expected_behavior_tests|behavior_test_status_partial"
        )
      ])
    );
  });

  it("requires explicit owner migration metadata when a critical file is replaced", () => {
    const replacementFile =
      "apps/backend/src/modules/conversation/agent/v2/sql-correction-decision.service.ts";
    const missingOriginal = ALL_COVERAGE_FILES.slice(1);
    const matrixWithoutMigration = coveredMatrix();
    matrixWithoutMigration.criticalFileOwnerMigrations = [];

    const missingMigrationReport = evaluateFocusedCoverageGate({
      coverage: coverageFor([...missingOriginal, replacementFile]),
      matrix: matrixWithoutMigration
    });

    expect(missingMigrationReport.rollout.gatePass).toBe(false);
    expect(missingMigrationReport.rollout.reasons).toContain(
      `critical:${ALL_COVERAGE_FILES[0]}:critical_file_missing_without_owner_migration`
    );

    const matrixWithMigration = coveredMatrix();
    matrixWithMigration.criticalFileOwnerMigrations = [
      {
        from: ALL_COVERAGE_FILES[0],
        to: replacementFile,
        reason: "sql correction decisions moved behind a narrower owner module",
        threshold: { line: 75 }
      },
      ...(matrixWithMigration.criticalFileOwnerMigrations ?? [])
    ];

    const migratedReport = evaluateFocusedCoverageGate({
      coverage: coverageFor([...missingOriginal, replacementFile]),
      matrix: matrixWithMigration
    });

    expect(migratedReport.rollout.gatePass).toBe(true);
    expect(migratedReport.criticalFiles[0]).toMatchObject({
      file: ALL_COVERAGE_FILES[0],
      effectiveFile: replacementFile,
      migrated: true,
      gatePass: true
    });
  });
});
