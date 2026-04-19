import type { SqlRun } from "@text2sql/shared-types";
import { DeliveryContractMapper } from "../../src/modules/conversation/delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../../src/modules/conversation/delivery/sandbox/sandbox-runtime.service";

const createBaseRun = (override: Partial<SqlRun> = {}): SqlRun => ({
  runId: "run-delivery-unit",
  sessionId: "session-delivery-unit",
  question: "统计订单状态分布",
  status: "executionResult",
  provider: "volcengine",
  model: "mock-model",
  answer: "共 4 种订单状态。",
  sql: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
  rows: [
    {
      status: "paid",
      count: 4
    }
  ],
  columns: ["status", "count"],
  trace: {
    runId: "run-delivery-unit",
    provider: "volcengine",
    retryCount: 0,
    steps: []
  },
  llmRaw: null,
  createdAt: "2026-04-18T00:00:00.000Z",
  ...override
});

describe("DeliveryContractMapper", () => {
  it("maps answer/evidence/artifact from run and replay records", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [
          {
            node: "build-semantic-query",
            status: "success",
            at: "2026-04-18T00:00:00.500Z",
            outputSummary: JSON.stringify({
              semanticVersion: 7,
              lockStatus: "locked",
              degradeReason: null
            })
          }
        ]
      }
    });

    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: "retrieval:fused",
          stage: "retrieval_fused",
          indexVersionId: "idx-v1",
          payload: JSON.stringify({
            status: "degraded",
            skillContext: {
              skills: [
                { skillId: "skill-1", title: "订单统计" },
                { skillId: "skill-2", title: "趋势分析" }
              ],
              context: [{ key: "table", value: "orders" }],
              degrade_reason: "skill_registry_unavailable"
            },
            candidates: [
              {
                chunkId: "chunk-a",
                sourceLane: "lexical",
                domain: "schema"
              }
            ]
          }),
          createdAt: "2026-04-18T00:00:01.000Z"
        },
        {
          replayKey: "rerank:final",
          stage: "rerank_finalized",
          indexVersionId: "idx-v1",
          payload: JSON.stringify({
            status: "degraded",
            degradeReasons: ["secondary_rerank_timeout"],
            selectedContextCount: 1,
            riskTags: ["rag_secondary_timeout"]
          }),
          createdAt: "2026-04-18T00:00:02.000Z"
        }
      ]
    });

    expect(delivery.answer.text).toBe("共 4 种订单状态。");
    expect(delivery.answer.status).toBe("executionResult");
    expect(delivery.evidence?.runId).toBe(run.runId);
    expect(delivery.evidence?.retrievalStatus).toBe("degraded");
    expect(delivery.evidence?.degradeReasons).toEqual(
      expect.arrayContaining(["secondary_rerank_timeout"])
    );
    expect(delivery.evidence?.selectedContext?.count).toBe(1);
    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["rag_secondary_timeout"])
    );
    expect(delivery.evidence?.semanticVersion).toBe(7);
    expect(delivery.evidence?.semanticLockStatus).toBe("locked");
    expect(delivery.evidence?.skillContextSummary).toEqual({
      skillCount: 2,
      contextCount: 1,
      degradeReason: "skill_registry_unavailable"
    });
    expect(delivery.evidence?.retrievalLogs).toHaveLength(2);
    expect(delivery.artifact?.rowCount).toBe(1);
    expect(delivery.artifact?.hasError).toBe(false);
  });

  it("keeps contract complete when artifact is absent", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      sql: undefined,
      rows: undefined,
      columns: undefined,
      answer: "暂无可执行 SQL，已提供解释。",
      error: undefined
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.answer.text).toBe("暂无可执行 SQL，已提供解释。");
    expect(delivery.evidence?.runId).toBe(run.runId);
    expect(delivery.artifact).toBeUndefined();
  });

  it("adds delivery_input_invalid when replay payload is malformed", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun();

    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: "rerank:final",
          stage: "rerank_finalized",
          indexVersionId: "idx-v1",
          payload: "{invalid-json",
          createdAt: "2026-04-18T00:00:03.000Z"
        }
      ]
    });

    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["delivery_input_invalid"])
    );
  });

  it("builds fallback contract with delivery_mapper_failed risk tag", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      answer: undefined,
      error: "内部错误"
    });

    const fallback = mapper.buildFallback(run, "delivery_mapper_failed");

    expect(fallback.answer.text).toBe("内部错误");
    expect(fallback.evidence?.riskTags).toEqual(["delivery_mapper_failed"]);
    expect(fallback.artifact?.hasError).toBe(true);
  });
});
