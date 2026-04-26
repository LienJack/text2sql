import type { SqlRun } from "@text2sql/shared-types";
import { Text2SqlV2StateMachine } from "../../src/modules/conversation/agent/v2/text2sql-v2-state-machine";

const createBaseRun = (override: Partial<SqlRun> = {}): SqlRun => ({
  runId: "run-v2-runtime",
  sessionId: "session-v2-runtime",
  question: "统计订单总数",
  status: "executionResult",
  provider: "volcengine",
  model: "mock-model",
  sql: "select count(*) as total from orders",
  answer: "订单总数为 10",
  rows: [{ total: 10 }],
  columns: ["total"],
  trace: {
    runId: "run-v2-runtime",
    provider: "volcengine",
    retryCount: 0,
    steps: [
      {
        node: "clarify",
        status: "success",
        at: "2026-04-26T00:00:00.000Z"
      },
      {
        node: "retrieve-knowledge",
        status: "success",
        at: "2026-04-26T00:00:00.100Z"
      },
      {
        node: "build-intent-plan",
        status: "success",
        at: "2026-04-26T00:00:00.200Z"
      },
      {
        node: "build-semantic-query",
        status: "success",
        at: "2026-04-26T00:00:00.300Z"
      },
      {
        node: "build-physical-plan",
        status: "success",
        at: "2026-04-26T00:00:00.400Z"
      },
      {
        node: "generate-sql",
        status: "success",
        at: "2026-04-26T00:00:00.500Z"
      },
      {
        node: "safety-check",
        status: "success",
        at: "2026-04-26T00:00:00.600Z"
      },
      {
        node: "execute-sql",
        status: "success",
        at: "2026-04-26T00:00:00.700Z"
      },
      {
        node: "format-answer",
        status: "success",
        at: "2026-04-26T00:00:00.800Z"
      }
    ]
  },
  llmRaw: null,
  createdAt: "2026-04-26T00:00:01.000Z",
  ...override
});

describe("text2sql v2 runtime artifacts", () => {
  it("maps successful trace nodes into v2 stages", () => {
    const artifact = new Text2SqlV2StateMachine().buildRunArtifact(createBaseRun());

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
    expect(artifact.stages.find((stage) => stage.stage === "generate-sql")?.status).toBe("success");
    expect(artifact.stages.find((stage) => stage.stage === "generate-sql")?.provider).toEqual({
      provider: "volcengine",
      model: "mock-model"
    });
    expect(artifact.stages.find((stage) => stage.stage === "correct")?.status).toBe("skipped");
    expect(artifact.stages.find((stage) => stage.stage === "answer")?.status).toBe("success");
  });

  it("marks correction stage success when relationship-correction runs", () => {
    const run = createBaseRun({
      trace: {
        ...createBaseRun().trace,
        retryCount: 1,
        steps: [
          ...createBaseRun().trace.steps,
          {
            node: "relationship-correction",
            status: "success",
            at: "2026-04-26T00:00:00.650Z",
            detail: "执行错误可修正，触发 correction 迭代"
          }
        ]
      }
    });

    const artifact = new Text2SqlV2StateMachine().buildRunArtifact(run);
    expect(artifact.stages.find((stage) => stage.stage === "correct")?.status).toBe("success");
  });

  it("captures correction failure as correctable validation-category failure", () => {
    const run = createBaseRun({
      status: "failed",
      error: "unknown column foo",
      trace: {
        ...createBaseRun().trace,
        retryCount: 2,
        steps: [
          ...createBaseRun().trace.steps,
          {
            node: "relationship-correction",
            status: "failed",
            at: "2026-04-26T00:00:00.650Z",
            errorSummary: "unknown column foo"
          }
        ]
      }
    });

    const artifact = new Text2SqlV2StateMachine().buildRunArtifact(run);
    const correctionStage = artifact.stages.find((stage) => stage.stage === "correct");

    expect(correctionStage?.status).toBe("failed");
    expect(correctionStage?.failure?.category).toBe("validation");
    expect(correctionStage?.failure?.correctable).toBe(true);
    expect(correctionStage?.failure?.terminal).toBe(true);
  });

  it("marks clarification terminal runs without answer stage fallback", () => {
    const run = createBaseRun({
      status: "clarification",
      trace: {
        ...createBaseRun().trace,
        steps: [
          {
            node: "clarify",
            status: "success",
            at: "2026-04-26T00:00:00.000Z"
          }
        ]
      }
    });

    const artifact = new Text2SqlV2StateMachine().buildRunArtifact(run);
    expect(artifact.stages.find((stage) => stage.stage === "intake")?.status).toBe("clarification");
    expect(artifact.stages.find((stage) => stage.stage === "answer")?.status).toBe("clarification");
  });
});
