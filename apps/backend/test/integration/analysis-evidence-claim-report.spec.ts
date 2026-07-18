import { AppConfigService } from "../../src/modules/config/app-config.service";
import { AnalysisTaskService } from "../../src/modules/conversation/analysis/application/analysis-task.service";
import { AlignmentObligationService } from "../../src/modules/conversation/analysis/evidence/alignment-obligation.service";
import { AnalysisReportProjectorService } from "../../src/modules/conversation/analysis/evidence/analysis-report-projector.service";
import { ClaimCommitService } from "../../src/modules/conversation/analysis/evidence/claim-commit.service";
import { ConflictSetService } from "../../src/modules/conversation/analysis/evidence/conflict-set.service";
import { DeterministicCalculationService } from "../../src/modules/conversation/analysis/evidence/deterministic-calculation.service";
import { EvidenceNormalizerService } from "../../src/modules/conversation/analysis/evidence/evidence-normalizer.service";
import { AnalysisCommitGuardService } from "../../src/modules/conversation/analysis/orchestration/analysis-commit-guard.service";
import { CalculationAnalysisWorker } from "../../src/modules/conversation/analysis/workers/calculation-analysis.worker";
import { EvidenceAlignmentWorker } from "../../src/modules/conversation/analysis/workers/evidence-alignment.worker";
import { ReportAnalysisWorker } from "../../src/modules/conversation/analysis/workers/report-analysis.worker";
import type {
  AnalysisCapability,
  AnalysisWorker,
  AnalysisWorkerInvocation
} from "../../src/modules/conversation/analysis/workers/worker-contract.types";
import { AnalysisWorkerRegistryService } from "../../src/modules/conversation/analysis/workers/worker-registry.service";
import { PostgresArtifactPayloadStoreService } from "../../src/modules/platform/artifacts/postgres-artifact-payload-store.service";
import { AnalysisArtifactRepository } from "../../src/modules/platform/data/persistence/analysis-artifact.repository";
import {
  sha256Digest,
  stableJson
} from "../../src/modules/platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("Evidence to supported report integration", () => {
  let harness: AnalysisLedgerTestHarness;

  const actor = {
    id: "analyst-1",
    role: "user" as const,
    principal: {
      authenticationMethod: "oidc_bearer" as const,
      trustLevel: "verified" as const,
      subject: "analyst-1",
      actorId: "analyst-1",
      roleSet: ["workspace_member" as const],
      authPolicyVersion: "auth-v1",
      digest: "principal-v1"
    }
  };

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("normalizes, aligns, recomputes and replays a claim-grounded report", async () => {
    const tasks = new AnalysisTaskRepository(harness.prisma);
    const taskService = new AnalysisTaskService(
      tasks,
      { assertWorkspaceRead: jest.fn().mockResolvedValue(undefined) } as never
    );
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "evidence-claim-report"
    });
    const attempt = await tasks.createAttempt({
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      idempotencyKey: "evidence-claim-report-attempt"
    });
    const queued = await tasks.transitionTask({
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      expectedAuthorityEpoch: created.task.authorityEpoch,
      nextStatus: "queued",
      eventType: "command.accepted",
      idempotencyKey: "evidence-claim-report-start"
    });
    const running = await tasks.transitionTask({
      taskId: created.task.id,
      expectedTaskVersion: queued.task.version,
      expectedAuthorityEpoch: queued.task.authorityEpoch,
      nextStatus: "running",
      eventType: "orchestrator.started",
      idempotencyKey: "evidence-claim-report-running"
    });
    const artifacts = new AnalysisArtifactRepository(
      harness.prisma,
      new PostgresArtifactPayloadStoreService(harness.config, harness.prisma),
      harness.config
    );

    const sqlArtifact = await artifacts.commitArtifact({
      artifactId: "sql-source",
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      artifactType: "analysis.sql_evidence",
      schemaVersion: "analysis-sql-evidence.v1",
      classification: "workspace",
      visibility: "user",
      completeness: "complete",
      payload: {
        runId: "run-q2-revenue",
        columns: ["current_value", "baseline_value"],
        rowsPreview: [{ current_value: "80", baseline_value: "100" }],
        rowCount: 1,
        accuracy: {
          executionStatus: "passed",
          resultStatus: "passed",
          validationStatus: "passed",
          receiptRefs: ["execution-receipt", "result-receipt", "validation-receipt"]
        },
        evidenceMetadata: alignedMetadata({
          units: { current_value: "USD", baseline_value: "USD" }
        })
      }
    });
    const researchArtifact = await artifacts.commitArtifact({
      artifactId: "research-source",
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      artifactType: "analysis.research_evidence",
      schemaVersion: "analysis-research-evidence.v1",
      classification: "public",
      visibility: "user",
      completeness: "complete",
      payload: {
        coverage: { status: "complete" },
        brief: {
          policyDigest: "policy-digest",
          connectorConfigDigest: "connector-digest"
        },
        sourceSnapshots: [
          {
            snapshotId: "snapshot-1",
            locator: "https://example.com/q2-context",
            contentDigest: "research-content-digest",
            completeness: "complete",
            evidenceMetadata: alignedMetadata({ units: { demand_index: "index" } }),
            observations: [
              {
                metric: "demand_index",
                value: "92",
                dimensions: { company: "acme" },
                observedAt: "2026-06-30T00:00:00.000Z",
                unit: "index",
                grain: "quarter"
              }
            ],
            injectionIndicators: []
          }
        ]
      }
    });

    const workers: AnalysisWorker[] = [
      new EvidenceAlignmentWorker(
        artifacts,
        new EvidenceNormalizerService(),
        new AlignmentObligationService(),
        new ConflictSetService()
      ),
      new CalculationAnalysisWorker(
        artifacts,
        new DeterministicCalculationService(),
        new ClaimCommitService()
      ),
      new ReportAnalysisWorker(artifacts, new AnalysisReportProjectorService())
    ];
    const registry = new AnalysisWorkerRegistryService(workers);
    const commitGuard = new AnalysisCommitGuardService(
      taskService,
      artifacts,
      registry
    );

    await executeAndCommit({
      worker: workers[0],
      taskService,
      artifacts,
      commitGuard,
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      workItemId: "align:evidence",
      workKind: "evidence_alignment",
      capabilities: ["artifact.read", "artifact.propose"],
      allowedOutputSchemas: [
        "analysis-evidence.v1",
        "analysis-evidence-alignment.v1",
        "analysis-conflict-set.v1"
      ],
      expectedOutputSchema: "analysis-evidence-alignment.v1"
    });
    await executeAndCommit({
      worker: workers[1],
      taskService,
      artifacts,
      commitGuard,
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      workItemId: "calculate:deterministic",
      workKind: "calculation",
      capabilities: ["artifact.read", "artifact.propose", "calculation.execute"],
      allowedOutputSchemas: ["analysis-calculation.v1", "analysis-claim.v1"],
      expectedOutputSchema: "analysis-calculation.v1"
    });
    await executeAndCommit({
      worker: workers[2],
      taskService,
      artifacts,
      commitGuard,
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      workItemId: "report:supported",
      workKind: "report",
      capabilities: ["artifact.read", "artifact.propose"],
      allowedOutputSchemas: ["analysis-report.v1"],
      expectedOutputSchema: "analysis-report.v1"
    });

    const model = await tasks.getReadModel(created.task.id);
    expect(model.artifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining([
        "analysis.evidence",
        "analysis.evidence_alignment",
        "analysis.calculation",
        "analysis.claim",
        "analysis.report"
      ])
    );
    const reportMetadata = model.artifacts.find(
      (artifact) => artifact.artifactType === "analysis.report"
    );
    expect(reportMetadata).toBeDefined();
    const firstReplay = await artifacts.readCommittedPayload(
      created.task.id,
      reportMetadata!.id
    );
    const repeatedReplay = await artifacts.readCommittedPayload(
      created.task.id,
      reportMetadata!.id
    );
    expect(firstReplay.payloadDigest).toBe(repeatedReplay.payloadDigest);
    expect(firstReplay.payload).toMatchObject({
      version: "analysis-report.v1",
      claims: [
        {
          version: "analysis-claim.v1",
          strength: "strong",
          value: "-20.00",
          unit: "%"
        }
      ]
    });
    expect(firstReplay.payload.projectionDigest).toEqual(expect.any(String));
    expect(sqlArtifact.payloadDigest).toEqual(expect.any(String));
    expect(researchArtifact.payloadDigest).toEqual(expect.any(String));

    const links = (await harness.prisma
      .requireClient()
      .analysisArtifactLink.findMany({
        where: { taskId: created.task.id }
      })) as Array<{ sourceArtifactId: string; targetArtifactId: string }>;
    expect(links.length).toBeGreaterThanOrEqual(8);
    expect(
      links.some(
        (link) =>
          link.sourceArtifactId === reportMetadata!.id &&
          model.artifacts.some(
            (artifact) =>
              artifact.id === link.targetArtifactId &&
              artifact.artifactType === "analysis.claim"
          )
      )
    ).toBe(true);
  });
});

async function executeAndCommit(input: {
  worker: AnalysisWorker;
  taskService: AnalysisTaskService;
  artifacts: AnalysisArtifactRepository;
  commitGuard: AnalysisCommitGuardService;
  taskId: string;
  revisionId: string;
  attemptId: string;
  authorityEpoch: number;
  workItemId: string;
  workKind: AnalysisWorkerInvocation["workKind"];
  capabilities: AnalysisCapability[];
  expectedOutputSchema: string;
  allowedOutputSchemas: string[];
}): Promise<void> {
  const model = await input.taskService.get(actorForInvocation, input.taskId);
  const inputArtifactRefs = model.artifacts.map((artifact) => ({
    id: artifact.id,
    digest: artifact.payloadDigest
  }));
  const invocationId = `invocation:${input.workItemId}`;
  const invocation: AnalysisWorkerInvocation = {
    invocationId,
    taskId: input.taskId,
    revisionId: input.revisionId,
    attemptId: input.attemptId,
    workItemId: input.workItemId,
    workKind: input.workKind,
    authorityEpoch: input.authorityEpoch,
    actor: actorForInvocation,
    instruction: `执行 ${input.workItemId}`,
    capabilityGrant: input.capabilities,
    capabilityGrantDigest: sha256Digest(
      stableJson({
        invocationId,
        capabilities: [...input.capabilities].sort()
      })
    ),
    budgetReservation: {
      maxDurationMs: 10_000,
      maxTokenCount: 1_000,
      maxQueryCount: 1,
      maxSearchCount: 1,
      maxArtifactBytes: 128 * 1024
    },
    inputArtifactRefs,
    inputDigest: sha256Digest(stableJson(inputArtifactRefs)),
    expectedOutputSchema: input.expectedOutputSchema,
    allowedOutputSchemas: input.allowedOutputSchemas
  };
  const proposal = await input.worker.execute(invocation);
  expect(proposal.unresolvedGaps).toEqual([]);
  await input.commitGuard.commit({
    actor: actorForInvocation,
    invocation,
    proposal
  });
}

const actorForInvocation = {
  id: "analyst-1",
  role: "user" as const,
  principal: {
    authenticationMethod: "oidc_bearer" as const,
    trustLevel: "verified" as const,
    subject: "analyst-1",
    actorId: "analyst-1",
    roleSet: ["workspace_member" as const],
    authPolicyVersion: "auth-v1",
    digest: "principal-v1"
  }
};

function alignedMetadata(input: { units: Record<string, string> }) {
  return {
    entities: ["company:acme"],
    entityAliases: {},
    effectiveFrom: "2026-04-01T00:00:00.000Z",
    effectiveTo: "2026-06-30T23:59:59.000Z",
    observedAt: "2026-06-30T00:00:00.000Z",
    timezone: "UTC",
    grain: "quarter",
    units: input.units,
    missingIntervals: []
  };
}
