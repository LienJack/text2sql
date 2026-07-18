import type {
  AnalysisEvent,
  AnalysisGoalContract,
  AnalysisTaskReadModel
} from "@text2sql/shared-types";
import { describe, expect, it } from "vitest";
import {
  analysisTaskReducer,
  initialAnalysisTaskUiState,
  mergeAnalysisTaskEvents
} from "@/lib/analysis-api-client";

const goal: AnalysisGoalContract = {
  version: "analysis-goal.v1",
  objective: "验证订单取消率",
  decisionUse: "季度评审",
  workspaceId: "workspace-1",
  datasourceIds: ["datasource-1"],
  allowedSourceKinds: ["datasource"],
  deliverables: ["报告"],
  budget: {
    maxDurationMs: 10_000,
    maxTokenCount: 1_000,
    maxQueryCount: 5,
    maxSearchCount: 5,
    maxArtifactBytes: 10_000
  },
  riskLevel: "medium",
  stopConditions: ["budget_exhausted"]
};

const event = (sequence: number, attemptId = "attempt-1"): AnalysisEvent => ({
  protocol: "analysis-task-protocol",
  version: "1.0.0",
  id: `event-${sequence}`,
  taskId: "task-1",
  revisionId: "revision-1",
  attemptId,
  sequence,
  idempotencyKey: `event-${sequence}`,
  type: "work.completed",
  visibility: "user",
  at: `2026-07-17T00:00:0${sequence}.000Z`,
  data: {}
});

const model = (status: AnalysisTaskReadModel["task"]["status"]): AnalysisTaskReadModel => ({
  task: {
    id: "task-1",
    workspaceId: "workspace-1",
    createdByActorId: "user-1",
    status,
    version: 3,
    currentRevisionNumber: 1,
    authorityEpoch: 1,
    goalDigest: "digest",
    terminalAt: status === "completed" ? "2026-07-17T00:01:00.000Z" : null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:01:00.000Z"
  },
  currentRevision: {
    id: "revision-1",
    taskId: "task-1",
    revision: 1,
    status: "active",
    goalContract: goal,
    goalDigest: "digest",
    principalDigest: "principal",
    authPolicyVersion: "v1",
    createdByActorId: "user-1",
    createdAt: "2026-07-17T00:00:00.000Z"
  },
  attempts: [],
  events: [event(1)],
  artifacts: [],
  receipts: [],
  manifests: []
});

describe("analysisTaskReducer", () => {
  it("merges out-of-order and duplicate events by task, attempt and sequence", () => {
    const merged = mergeAnalysisTaskEvents([event(3)], [event(2), event(1), event(2)]);
    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it("rejects a different event claiming the same task sequence", () => {
    expect(() =>
      mergeAnalysisTaskEvents([event(1)], [{ ...event(1, "attempt-2"), id: "conflict" }])
    ).toThrow("sequence conflict");
  });

  it("keeps terminal task status monotonic when a stale poll arrives", () => {
    const completed = analysisTaskReducer(initialAnalysisTaskUiState, {
      type: "hydrate",
      readModel: model("completed")
    });
    const stale = analysisTaskReducer(completed, {
      type: "hydrate",
      readModel: model("running")
    });
    expect(stale.readModel?.task.status).toBe("completed");
    expect(stale.readModel?.task.terminalAt).toBe("2026-07-17T00:01:00.000Z");
  });
});
