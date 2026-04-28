import type { SqlRun } from "@text2sql/shared-types";
import { Text2SqlV2ArtifactBuilder } from "../../src/modules/conversation/artifacts/text2sql-v2-artifact-builder";
import { createText2SqlV2StageLifecycle } from "../../src/modules/conversation/artifacts/text2sql-v2-artifacts";

const createBaseRun = (overrides: Partial<SqlRun> = {}): SqlRun =>
  ({
    runId: "run-v2-artifacts",
    sessionId: "session-v2-artifacts",
    question: "统计订单总数",
    status: "executionResult",
    provider: "volcengine",
    model: "mock-model",
    sql: "SELECT COUNT(*) AS total FROM orders",
    answer: "订单总数为 10",
    rows: [{ total: 10 }],
    columns: ["total"],
    trace: {
      runId: "run-v2-artifacts",
      provider: "volcengine",
      retryCount: 0,
      v2: {
        version: "v2",
        stageOrder: [
          "intake",
          "retrieve",
          "assemble-context",
          "semantic-plan",
          "generate-sql",
          "validate",
          "correct",
          "execute",
          "answer"
        ],
        stages: [
          { stage: "intake", status: "success" },
          { stage: "retrieve", status: "success" },
          { stage: "assemble-context", status: "success" },
          { stage: "semantic-plan", status: "success" },
          { stage: "generate-sql", status: "success" },
          { stage: "validate", status: "success" },
          { stage: "correct", status: "skipped" },
          { stage: "execute", status: "success" },
          { stage: "answer", status: "success" }
        ]
      },
      steps: [
        {
          node: "intake",
          status: "success",
          at: "2026-04-28T00:00:00.000Z"
        },
        {
          node: "generate-sql",
          status: "success",
          at: "2026-04-28T00:00:00.100Z"
        },
        {
          node: "execute-sql",
          status: "success",
          at: "2026-04-28T00:00:00.200Z"
        },
        {
          node: "answer",
          status: "success",
          at: "2026-04-28T00:00:00.300Z"
        }
      ]
    },
    llmRaw: null,
    createdAt: "2026-04-28T00:00:00.400Z",
    ...overrides
  }) as SqlRun;

describe("Text2Sql v2 runtime artifacts", () => {
  it("normalizes run traces into canonical v2 stage artifacts", () => {
    const artifact = new Text2SqlV2ArtifactBuilder().buildRunArtifact(createBaseRun());

    expect(artifact.version).toBe("v2");
    expect(artifact.stageOrder).toEqual([
      "intake",
      "retrieve",
      "assemble-context",
      "semantic-plan",
      "generate-sql",
      "validate",
      "correct",
      "execute",
      "answer"
    ]);
    expect(artifact.stages.find((stage) => stage.stage === "generate-sql")?.status).toBe(
      "success"
    );
    expect(artifact.stages.find((stage) => stage.stage === "answer")?.status).toBe(
      "success"
    );
  });

  it("preserves provider metadata when stage lifecycle emits canonical runtime stages", () => {
    const lifecycle = createText2SqlV2StageLifecycle();
    lifecycle.startStage({
      stage: "generate-sql",
      provider: { provider: "volcengine", model: "mock-model" }
    });
    lifecycle.completeStage({
      stage: "generate-sql",
      status: "success",
      provider: { provider: "volcengine", model: "mock-model" },
      metadata: {
        taskProfile: "sql-generation",
        reasoningTier: "high"
      }
    });

    const runArtifact = lifecycle.toRunArtifact();
    const generateSqlStage = runArtifact.stages.find((stage) => stage.stage === "generate-sql");

    expect(generateSqlStage?.provider).toEqual({
      provider: "volcengine",
      model: "mock-model"
    });
    expect(generateSqlStage?.metadata).toMatchObject({
      taskProfile: "sql-generation",
      reasoningTier: "high"
    });
  });
});
