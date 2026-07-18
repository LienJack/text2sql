import { AnalysisCommitGuardService } from "../../src/modules/conversation/analysis/orchestration/analysis-commit-guard.service";
import { AnalysisWorkerRegistryService } from "../../src/modules/conversation/analysis/workers/worker-registry.service";
import type {
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "../../src/modules/conversation/analysis/workers/worker-contract.types";
import { sha256Digest, stableJson } from "../../src/modules/platform/data/persistence/analysis-ledger.util";

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

describe("AnalysisCommitGuardService", () => {

  it("rejects SQL evidence when mandatory result receipts did not pass", async () => {
    const invocation = buildInvocation();
    const taskService = {
      get: jest.fn().mockResolvedValue(buildReadModel()),
      principalDigest: jest.fn().mockReturnValue("principal-v1")
    };
    const artifacts = { commitArtifact: jest.fn() };
    const guard = new AnalysisCommitGuardService(
      taskService as never,
      artifacts as never,
      new AnalysisWorkerRegistryService([])
    );
    const proposal = buildProposal(invocation, {
      artifactType: "analysis.sql_evidence",
      receiptStatus: "failed"
    });

    await expect(guard.commit({ actor, invocation, proposal })).rejects.toMatchObject({
      code: "ANALYSIS_EVIDENCE_RECEIPT_REQUIRED"
    });
    expect(artifacts.commitArtifact).not.toHaveBeenCalled();
  });

  it("rejects proposal cost beyond the reserved budget", async () => {
    const invocation = buildInvocation();
    const guard = new AnalysisCommitGuardService(
      {
        get: jest.fn().mockResolvedValue(buildReadModel()),
        principalDigest: jest.fn().mockReturnValue("principal-v1")
      } as never,
      { commitArtifact: jest.fn() } as never,
      new AnalysisWorkerRegistryService([])
    );
    const proposal = buildProposal(invocation, {
      artifactType: "analysis.sql_diagnostic",
      receiptStatus: "failed"
    });
    proposal.cost.queryCount = 2;
    await expect(guard.commit({ actor, invocation, proposal })).rejects.toMatchObject({
      code: "ANALYSIS_WORKER_BUDGET_EXCEEDED"
    });
  });
});

function buildInvocation(): AnalysisWorkerInvocation {
  const invocationId = "invocation-1";
  const capabilities = ["datasource.read" as const, "artifact.propose" as const];
  return {
    invocationId,
    taskId: "task-1",
    revisionId: "revision-1",
    attemptId: "attempt-1",
    workItemId: "sql:1",
    workKind: "text2sql",
    authorityEpoch: 1,
    actor,
    datasourceId: "sqlite_main",
    instruction: "query",
    capabilityGrant: capabilities,
    capabilityGrantDigest: sha256Digest(
      stableJson({ invocationId, capabilities: [...capabilities].sort() })
    ),
    budgetReservation: {
      maxDurationMs: 1_000,
      maxTokenCount: 100,
      maxQueryCount: 1,
      maxSearchCount: 1,
      maxArtifactBytes: 10_000
    },
    inputArtifactRefs: [],
    inputDigest: sha256Digest(stableJson([])),
    expectedOutputSchema: "analysis-sql-evidence.v1"
  };
}

function buildProposal(
  invocation: AnalysisWorkerInvocation,
  candidate: { artifactType: string; receiptStatus: "passed" | "failed" }
): AnalysisWorkerProposal {
  return {
    proposalId: "proposal-1",
    invocationId: invocation.invocationId,
    workerId: "text2sql.v1",
    workerVersion: "1",
    taskId: invocation.taskId,
    revisionId: invocation.revisionId,
    attemptId: invocation.attemptId,
    authorityEpoch: invocation.authorityEpoch,
    inputDigest: invocation.inputDigest,
    requestedCapabilities: invocation.capabilityGrant,
    candidates: [
      {
        candidateId: "candidate-1",
        artifactType: candidate.artifactType,
        schemaVersion: "analysis-sql-evidence.v1",
        completeness: "insufficient",
        payload: {},
        receiptStatus: candidate.receiptStatus,
        receiptRefs: [],
        reasonCodes: []
      }
    ],
    cost: {
      durationMs: 1,
      tokenCount: 0,
      queryCount: 1,
      searchCount: 0,
      artifactBytes: 10
    },
    unresolvedGaps: []
  };
}

function buildReadModel() {
  return {
    task: { authorityEpoch: 1 },
    currentRevision: { id: "revision-1" },
    attempts: [
      { id: "attempt-1", revisionId: "revision-1", authorityEpoch: 1 }
    ],
    artifacts: []
  };
}
