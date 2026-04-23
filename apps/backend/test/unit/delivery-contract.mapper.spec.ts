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
            riskTags: ["rag_secondary_timeout"],
            contextPack: {
              status: "degraded",
              semanticVersion: 7,
              semanticLockStatus: "locked",
              instructionSummary: {
                modelBindingCount: 2,
                relationshipBindingCount: 1,
                metricBindingCount: 3,
                calculatedFieldBindingCount: 1
              },
              degradeReasons: ["semantic_spine_snapshot_not_found"]
            }
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
    expect(delivery.evidence?.semanticSpineVersion).toBe(7);
    expect(delivery.evidence?.semanticLockStatus).toBe("locked");
    expect(delivery.evidence?.contextPackStatus).toBe("degraded");
    expect(delivery.evidence?.semanticInstructionSummary).toEqual({
      modelBindingCount: 2,
      relationshipBindingCount: 1,
      metricBindingCount: 3,
      calculatedFieldBindingCount: 1
    });
    expect(delivery.evidence?.skillContextSummary).toEqual({
      skillCount: 2,
      contextCount: 1,
      degradeReason: "skill_registry_unavailable"
    });
    expect(delivery.evidence?.retrievalLogs).toHaveLength(2);
    expect(delivery.artifact?.rowCount).toBe(1);
    expect(delivery.artifact?.hasError).toBe(false);
  });

  it("echoes sanitized effective context summary and conflict hint from trace", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
        effectiveContextSummary: {
          sourcePriority: "user_explicit_over_system",
          userEnvelope: {
            metricDefinitionProvided: true,
            timeRangeProvided: true,
            entityMappingCount: 2,
            includeTableCount: 1,
            excludeTableCount: 1,
            businessConstraintCount: 1
          },
          retrievalContext: {
            status: "degraded",
            selectedContextCount: 1
          }
        },
        conflictHint: {
          hasConflict: true,
          preferredSource: "user_explicit",
          reasonCodes: ["user_envelope_include_exclude_overlap"]
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.effectiveContextSummary).toEqual({
      sourcePriority: "user_explicit_over_system",
      userEnvelope: {
        metricDefinitionProvided: true,
        timeRangeProvided: true,
        entityMappingCount: 2,
        includeTableCount: 1,
        excludeTableCount: 1,
        businessConstraintCount: 1
      },
      retrievalContext: {
        status: "degraded",
        selectedContextCount: 1
      }
    });
    expect(delivery.evidence?.conflictHint).toEqual({
      hasConflict: true,
      preferredSource: "user_explicit",
      reasonCodes: ["user_envelope_include_exclude_overlap"]
    });
    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["context_conflict_detected"])
    );
  });

  it("maps modelingRevision from trace into delivery evidence", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        modelingRevision: 12,
        steps: []
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.modelingRevision).toBe(12);
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
