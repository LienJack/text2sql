import { AppConfigService } from "../../src/modules/config/app-config.service";
import { AnalysisCommitGuardService } from "../../src/modules/conversation/analysis/orchestration/analysis-commit-guard.service";
import { AnalysisGoalCompilerService } from "../../src/modules/conversation/analysis/orchestration/analysis-goal-compiler.service";
import { AnalysisOrchestratorService } from "../../src/modules/conversation/analysis/orchestration/analysis-orchestrator.service";
import { AnalysisTaskService } from "../../src/modules/conversation/analysis/application/analysis-task.service";
import { GovernanceAnalysisAccessFacade } from "../../src/modules/governance/access/governance-analysis-access.facade";
import { AnalysisArtifactRepository } from "../../src/modules/platform/data/persistence/analysis-artifact.repository";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import { PostgresArtifactPayloadStoreService } from "../../src/modules/platform/artifacts/postgres-artifact-payload-store.service";
import { AnalysisWorkerRegistryService } from "../../src/modules/conversation/analysis/workers/worker-registry.service";
import type {
  AnalysisWorker,
  AnalysisWorkerCandidate,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "../../src/modules/conversation/analysis/workers/worker-contract.types";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("AnalysisOrchestratorService", () => {
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

  it("commits WorkGraph, supported SQL evidence and critique with lineage", async () => {
    const tasks = new AnalysisTaskRepository(harness.prisma);
    const taskService = new AnalysisTaskService(
      tasks,
      {
        assertWorkspaceRead: jest.fn().mockResolvedValue(undefined)
      } as unknown as GovernanceAnalysisAccessFacade
    );
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "orchestrator-flow"
    });
    const attempt = await tasks.createAttempt({
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      idempotencyKey: "attempt-1"
    });
    await tasks.transitionTask({
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      expectedAuthorityEpoch: created.task.authorityEpoch,
      nextStatus: "queued",
      eventType: "command.accepted",
      idempotencyKey: "test-start-command"
    });
    const payloadStore = new PostgresArtifactPayloadStoreService(
      harness.config,
      harness.prisma
    );
    const artifacts = new AnalysisArtifactRepository(
      harness.prisma,
      payloadStore,
      harness.config
    );
    const workers = [
      new FixtureSqlWorker(),
      new FixtureResearchWorker(),
      new FixtureAlignmentWorker(),
      new FixtureCalculationWorker(),
      new FixtureCritiqueWorker(),
      new FixtureReportWorker()
    ];
    const registry = new AnalysisWorkerRegistryService(workers);
    const commitGuard = new AnalysisCommitGuardService(
      taskService,
      artifacts,
      registry
    );
    const orchestrator = new AnalysisOrchestratorService(
      taskService,
      tasks,
      artifacts,
      new AnalysisGoalCompilerService(),
      registry,
      commitGuard,
      { analysisMultiWorkerMode: "off" } as AppConfigService
    );

    const sql = await orchestrator.runNext(actor, created.task.id);
    const research = await orchestrator.runNext(actor, created.task.id);
    const alignment = await orchestrator.runNext(actor, created.task.id);
    const calculation = await orchestrator.runNext(actor, created.task.id);
    const critique = await orchestrator.runNext(actor, created.task.id);
    const report = await orchestrator.runNext(actor, created.task.id);
    const exhausted = await orchestrator.runNext(actor, created.task.id);
    const model = await tasks.getReadModel(created.task.id);

    expect(sql.executed?.workItemId).toContain("sql:");
    expect(research.executed?.workItemId).toBe("research:external");
    expect(alignment.executed?.workItemId).toBe("align:evidence");
    expect(calculation.executed?.workItemId).toBe("calculate:deterministic");
    expect(critique.executed?.workItemId).toBe("critique:counter-evidence");
    expect(report.executed?.workItemId).toBe("report:supported");
    expect(exhausted.executed).toBeNull();
    expect(model.task.status).toBe("running");
    expect(model.artifacts.map((artifact) => artifact.artifactType)).toEqual(
      expect.arrayContaining([
        "analysis.work_graph",
        "analysis.sql_evidence",
        "analysis.research_evidence",
        "analysis.evidence_alignment",
        "analysis.calculation",
        "analysis.claim",
        "analysis.critique",
        "analysis.report"
      ])
    );
    expect(model.artifacts.every((artifact) => artifact.attemptId === attempt.id)).toBe(
      true
    );
    expect(
      model.events.filter((event) => event.type === "work.completed")
    ).toHaveLength(6);
  });
});

class FixtureSqlWorker implements AnalysisWorker {
  readonly workerId = "text2sql.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["text2sql" as const];
  readonly capabilities = ["datasource.read" as const, "artifact.propose" as const];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.sql_evidence",
      schemaVersion: "analysis-sql-evidence.v1"
    });
  }
}

class FixtureCritiqueWorker implements AnalysisWorker {
  readonly workerId = "critique.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["critique" as const];
  readonly capabilities = [
    "artifact.read" as const,
    "artifact.propose" as const,
    "claim.challenge" as const
  ];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.critique",
      schemaVersion: "analysis-critique.v1"
    });
  }
}

class FixtureResearchWorker implements AnalysisWorker {
  readonly workerId = "research.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["research" as const];
  readonly capabilities = [
    "web.search" as const,
    "web.fetch" as const,
    "artifact.propose" as const
  ];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.research_evidence",
      schemaVersion: "analysis-research-evidence.v1"
    });
  }
}

class FixtureAlignmentWorker implements AnalysisWorker {
  readonly workerId = "evidence-alignment.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["evidence_alignment" as const];
  readonly capabilities = ["artifact.read" as const, "artifact.propose" as const];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.evidence_alignment",
      schemaVersion: "analysis-evidence-alignment.v1",
      payload: {
        version: "analysis-evidence-alignment.v1",
        evidenceRefs: ["fixture-evidence"],
        checks: [],
        closed: true,
        requiresHumanDecision: false,
        unresolvedDimensions: []
      }
    });
  }
}

class FixtureCalculationWorker implements AnalysisWorker {
  readonly workerId = "calculation.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["calculation" as const];
  readonly capabilities = [
    "artifact.read" as const,
    "artifact.propose" as const,
    "calculation.execute" as const
  ];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.calculation",
      schemaVersion: "analysis-calculation.v1",
      payload: {
        version: "analysis-calculation.v1",
        recomputable: true,
        output: { value: "1.00" }
      },
      additionalCandidates: [
        {
          candidateId: `claim:${invocation.workItemId}`,
          artifactType: "analysis.claim",
          schemaVersion: "analysis-claim.v1",
          completeness: "complete" as const,
          payload: {
            version: "analysis-claim.v1",
            strength: "strong",
            supportingEvidenceRefs: ["fixture-evidence"],
            calculationRefs: ["fixture-calculation"]
          },
          receiptStatus: "passed" as const,
          receiptRefs: ["fixture-receipt"],
          reasonCodes: ["fixture_passed"]
        }
      ]
    });
  }
}

class FixtureReportWorker implements AnalysisWorker {
  readonly workerId = "report.v1";
  readonly workerVersion = "fixture";
  readonly workKinds = ["report" as const];
  readonly capabilities = ["artifact.read" as const, "artifact.propose" as const];

  async execute(invocation: AnalysisWorkerInvocation) {
    return fixtureProposal(invocation, {
      workerId: this.workerId,
      artifactType: "analysis.report",
      schemaVersion: "analysis-report.v1",
      payload: { version: "analysis-report.v1", claims: [] }
    });
  }
}

function fixtureProposal(
  invocation: AnalysisWorkerInvocation,
  input: {
    workerId: string;
    artifactType: string;
    schemaVersion: string;
    payload?: Record<string, unknown>;
    additionalCandidates?: AnalysisWorkerCandidate[];
  }
): AnalysisWorkerProposal {
  return {
    proposalId: `proposal:${invocation.invocationId}`,
    invocationId: invocation.invocationId,
    workerId: input.workerId,
    workerVersion: "fixture",
    taskId: invocation.taskId,
    revisionId: invocation.revisionId,
    attemptId: invocation.attemptId,
    authorityEpoch: invocation.authorityEpoch,
    inputDigest: invocation.inputDigest,
    requestedCapabilities: invocation.capabilityGrant,
    candidates: [
      {
        candidateId: `candidate:${invocation.workItemId}`,
        artifactType: input.artifactType,
        schemaVersion: input.schemaVersion,
        completeness: "complete" as const,
        payload: input.payload ?? { workItemId: invocation.workItemId },
        receiptStatus: "passed" as const,
        receiptRefs: ["fixture-receipt"],
        reasonCodes: ["fixture_passed"]
      },
      ...(input.additionalCandidates ?? [])
    ],
    cost: {
      durationMs: 1,
      tokenCount: 0,
      queryCount: input.artifactType === "analysis.sql_evidence" ? 1 : 0,
      searchCount: 0,
      artifactBytes: 100
    },
    unresolvedGaps: []
  };
}
