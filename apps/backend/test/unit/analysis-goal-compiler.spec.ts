import { AnalysisGoalCompilerService } from "../../src/modules/conversation/analysis/orchestration/analysis-goal-compiler.service";
import { buildGoalContract } from "../support/analysis-ledger-test-harness";

describe("AnalysisGoalCompilerService", () => {
  it("compiles the complete deterministic analysis work graph", () => {
    const compiler = new AnalysisGoalCompilerService();
    const revision = {
      id: "revision-1",
      taskId: "task-1",
      revision: 1,
      status: "active" as const,
      goalContract: buildGoalContract("workspace-1"),
      goalDigest: "goal-1",
      principalDigest: "principal-1",
      authPolicyVersion: "auth-1",
      createdByActorId: "analyst-1",
      createdAt: "2026-07-17T00:00:00.000Z"
    };
    const first = compiler.compile({ taskId: "task-1", revision });
    const repeated = compiler.compile({ taskId: "task-1", revision });

    expect(first.graphDigest).toBe(repeated.graphDigest);
    expect(first.multiWorkerMode).toBe("off");
    expect(first.obligations.filter((item) => item.mandatory)).toHaveLength(8);
    expect(first.workItems.find((item) => item.kind === "text2sql")).toMatchObject({
      workerId: "text2sql.v1",
      supported: true,
      mandatory: true
    });
    expect(first.workItems.find((item) => item.kind === "research")).toMatchObject({
      workerId: "research.v1",
      supported: true,
      reasonCodes: []
    });
    expect(first.supportedKinds).toEqual(
      expect.arrayContaining([
        "text2sql",
        "research",
        "evidence_alignment",
        "calculation",
        "critique",
        "report"
      ])
    );
    expect(first.deferredKinds).toEqual([]);
  });
});
