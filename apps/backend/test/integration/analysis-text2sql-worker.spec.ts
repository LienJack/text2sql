import { Text2SqlAnalysisWorker } from "../../src/modules/conversation/analysis/workers/text2sql-analysis.worker";
import type { AnalysisWorkerInvocation } from "../../src/modules/conversation/analysis/workers/worker-contract.types";

describe("Text2SqlAnalysisWorker", () => {
  it("promotes only a run with passed execution, result and validation receipts", async () => {
    const sessions = {
      createSession: jest.fn().mockResolvedValue({ id: "analysis-session-1" })
    };
    const workflow = {
      runSync: jest.fn().mockResolvedValue({
        runId: "run-1",
        sessionId: "analysis-session-1",
        question: "收入下降原因",
        status: "executionResult",
        sql: "select 1",
        rows: [{ value: 1 }],
        columns: ["value"],
        trace: {
          v2: {
            accuracy: {
              version: "text2sql-accuracy-evidence.v1",
              gateReceipts: [{ status: "passed", receiptId: "gate-1" }],
              executionReceipt: { status: "passed", receiptId: "execution-1" },
              resultReceipt: { status: "passed", receiptId: "result-1" },
              validationReceipt: { status: "passed", receiptId: "validation-1" }
            }
          }
        }
      })
    };
    const worker = new Text2SqlAnalysisWorker(sessions as never, workflow as never);
    const proposal = await worker.execute(buildInvocation());

    expect(sessions.createSession).toHaveBeenCalledWith(
      "sqlite_main",
      undefined,
      expect.objectContaining({ origin: "analysis", analysisTaskId: "task-1" })
    );
    expect(proposal.candidates[0]).toMatchObject({
      artifactType: "analysis.sql_evidence",
      receiptStatus: "passed"
    });
    expect(proposal.candidates[0]?.receiptRefs).toEqual([
      "gate-1",
      "execution-1",
      "result-1",
      "validation-1"
    ]);
  });

  it("keeps failed Result Oracle output as diagnostic", async () => {
    const worker = new Text2SqlAnalysisWorker(
      { createSession: jest.fn().mockResolvedValue({ id: "session-1" }) } as never,
      {
        runSync: jest.fn().mockResolvedValue({
          runId: "run-2",
          sessionId: "session-1",
          question: "query",
          status: "executionResult",
          trace: {
            v2: {
              accuracy: {
                version: "text2sql-accuracy-evidence.v1",
                executionReceipt: { status: "passed", receiptId: "execution" },
                resultReceipt: { status: "failed", receiptId: "result" }
              }
            }
          }
        })
      } as never
    );
    const proposal = await worker.execute(buildInvocation());
    expect(proposal.candidates[0]).toMatchObject({
      artifactType: "analysis.sql_diagnostic",
      receiptStatus: "failed"
    });
  });
});

function buildInvocation(): AnalysisWorkerInvocation {
  return {
    invocationId: "invocation-1",
    taskId: "task-1",
    revisionId: "revision-1",
    attemptId: "attempt-1",
    workItemId: "sql:1",
    workKind: "text2sql",
    authorityEpoch: 1,
    actor: {
      id: "analyst-1",
      role: "user",
      principal: {
        authenticationMethod: "oidc_bearer",
        trustLevel: "verified",
        subject: "analyst-1",
        actorId: "analyst-1",
        requestedWorkspaceId: "workspace-1",
        roleSet: ["workspace_member"],
        authPolicyVersion: "auth-v1",
        digest: "principal-v1"
      }
    },
    datasourceId: "sqlite_main",
    instruction: "query",
    capabilityGrant: ["datasource.read", "artifact.propose"],
    capabilityGrantDigest: "grant",
    budgetReservation: {
      maxDurationMs: 1_000,
      maxTokenCount: 100,
      maxQueryCount: 1,
      maxSearchCount: 1,
      maxArtifactBytes: 100_000
    },
    inputArtifactRefs: [],
    inputDigest: "input",
    expectedOutputSchema: "analysis-sql-evidence.v1"
  };
}
