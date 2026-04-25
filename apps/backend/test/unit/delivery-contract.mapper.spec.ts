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

  it("maps clarification decision evidence from trace fields", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      status: "clarification",
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
        clarificationDecision: {
          decision: "clarify",
          triggerPath: "hybrid",
          confidenceLevel: "low",
          missingCriticalSlots: ["metric", "time"],
          conflictDetected: true,
          reasonCodes: ["rule_low_confidence", "context_conflict_detected"],
          question: "请补充要统计的指标口径（例如订单数、退款金额、转化率）。",
          reason: "关键槽位缺失：指标口径、时间范围"
        }
      } as SqlRun["trace"],
      clarification: {
        question: "请补充要统计的指标口径（例如订单数、退款金额、转化率）。",
        reason: "关键槽位缺失：指标口径、时间范围"
      }
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.clarificationDecision).toEqual({
      decision: "clarify",
      triggerPath: "hybrid",
      confidenceLevel: "low",
      missingCriticalSlots: ["metric", "time"],
      conflictDetected: true,
      reasonCodes: ["rule_low_confidence", "context_conflict_detected"],
      question: "请补充要统计的指标口径（例如订单数、退款金额、转化率）。",
      reason: "关键槽位缺失：指标口径、时间范围"
    });
  });

  it("reads snake_case clarification decision from clarify step summary", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      status: "clarification",
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [
          {
            node: "clarify",
            status: "success",
            at: "2026-04-18T00:00:00.500Z",
            detail: "关键槽位缺失：时间范围",
            outputSummary: JSON.stringify({
              clarification_question: "请补充时间范围（例如近30天、本季度或具体起止日期）。",
              clarification_decision: {
                decision: "clarify",
                trigger_source: "rule",
                confidence_level: "low",
                missing_critical_slots: ["time"],
                conflict_detected: "false",
                reason_codes: ["missing_time_slot"]
              }
            })
          }
        ]
      } as SqlRun["trace"],
      clarification: {
        question: "请补充时间范围（例如近30天、本季度或具体起止日期）。",
        reason: "关键槽位缺失：时间范围"
      }
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.clarificationDecision).toEqual({
      decision: "clarify",
      triggerPath: "rule",
      confidenceLevel: "low",
      missingCriticalSlots: ["time"],
      conflictDetected: false,
      reasonCodes: ["missing_time_slot"],
      question: "请补充时间范围（例如近30天、本季度或具体起止日期）。",
      reason: "关键槽位缺失：时间范围"
    });
  });

  it("maps SQL coverage evidence from generate-sql step summary", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [
          {
            node: "generate-sql",
            status: "success",
            at: "2026-04-18T00:00:00.500Z",
            outputSummary: JSON.stringify({
              coverage: {
                gateStatus: "passed",
                missingObjects: [],
                triggerSource: "selected_context"
              }
            })
          }
        ]
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    const evidenceWithCoverage = delivery.evidence as
      | (NonNullable<typeof delivery.evidence> & {
          sqlCoverage?: {
            gateStatus: string;
            missingObjects: string[];
            triggerSource: string;
          };
        })
      | undefined;
    expect(evidenceWithCoverage?.sqlCoverage).toEqual({
      gateStatus: "passed",
      missingObjects: [],
      triggerSource: "selected_context"
    });
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

  it("falls back to semantic step summary for revision and binding evidence", () => {
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
              semanticVersion: 13,
              lockStatus: "locked",
              modelingRevision: 21,
              contextPackStatus: "ready",
              semanticBindingSummary: {
                modelBindingCount: 4,
                relationshipBindingCount: 2,
                metricBindingCount: 3,
                calculatedFieldBindingCount: 1
              }
            })
          }
        ]
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.modelingRevision).toBe(21);
    expect(delivery.evidence?.semanticVersion).toBe(13);
    expect(delivery.evidence?.semanticLockStatus).toBe("locked");
    expect(delivery.evidence?.contextPackStatus).toBe("ready");
    expect(delivery.evidence?.semanticInstructionSummary).toEqual({
      modelBindingCount: 4,
      relationshipBindingCount: 2,
      metricBindingCount: 3,
      calculatedFieldBindingCount: 1
    });
  });

  it("keeps trace modelingRevision when step summary has a different revision", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        modelingRevision: 9,
        steps: [
          {
            node: "build-semantic-query",
            status: "success",
            at: "2026-04-18T00:00:00.500Z",
            outputSummary: JSON.stringify({
              semanticVersion: 13,
              lockStatus: "locked",
              modelingRevision: 18
            })
          }
        ]
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.modelingRevision).toBe(9);
  });

  it("parses snake_case replay payloads for modeling revision and semantic summaries", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: []
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: "retrieval:fused",
          stage: "retrieval_fused",
          indexVersionId: "idx-v1",
          payload: JSON.stringify({
            status: "ready",
            skill_context: {
              skills: [{ id: "skill-1" }],
              context: [{ term: "orders" }],
              degradeReason: "compat_skill_context"
            },
            candidates: [
              {
                chunk_id: "chunk-camel-compat",
                source_lane: "graph",
                domain: "semantic_term"
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
            status: "ready",
            context_pack: {
              status: "ready",
              semantic_version: "15",
              semantic_lock_status: "locked",
              modeling_revision: "42",
              instruction_summary: {
                model_binding_count: 3,
                relationship_binding_count: 2,
                metric_binding_count: 1,
                calculated_field_binding_count: 4
              },
              degrade_reasons: ["compat_context_pack"]
            }
          }),
          createdAt: "2026-04-18T00:00:02.000Z"
        }
      ]
    });

    expect(delivery.evidence?.modelingRevision).toBe(42);
    expect(delivery.evidence?.semanticSpineVersion).toBe(15);
    expect(delivery.evidence?.semanticLockStatus).toBe("locked");
    expect(delivery.evidence?.semanticInstructionSummary).toEqual({
      modelBindingCount: 3,
      relationshipBindingCount: 2,
      metricBindingCount: 1,
      calculatedFieldBindingCount: 4
    });
    expect(delivery.evidence?.skillContextSummary).toEqual({
      skillCount: 1,
      contextCount: 1,
      degradeReason: "compat_skill_context"
    });
    expect(delivery.evidence?.selectedContext?.snippets).toEqual(
      expect.arrayContaining([
        expect.stringContaining("chunk:chunk-camel-compat")
      ])
    );
  });

  it("reads active_revision + context_pack_status compatibility fields from replay payloads", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: []
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: "rerank:final",
          stage: "rerank_finalized",
          indexVersionId: "idx-v2",
          payload: JSON.stringify({
            status: "degraded",
            context_pack: {
              context_pack_status: "degraded",
              active_revision: "27",
              semantic_lock_status: "fallback",
              instruction_summary: {
                model_binding_count: "2",
                relationship_binding_count: "1",
                metric_binding_count: "3",
                calculated_field_binding_count: "0"
              }
            }
          }),
          createdAt: "2026-04-18T00:00:02.000Z"
        }
      ]
    });

    expect(delivery.evidence?.modelingRevision).toBe(27);
    expect(delivery.evidence?.contextPackStatus).toBe("degraded");
    expect(delivery.evidence?.semanticLockStatus).toBe("fallback");
    expect(delivery.evidence?.semanticInstructionSummary).toEqual({
      modelBindingCount: 2,
      relationshipBindingCount: 1,
      metricBindingCount: 3,
      calculatedFieldBindingCount: 0
    });
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
    expect(delivery.evidence?.clarificationDecision).toBeUndefined();
    expect(
      (
        delivery.evidence as
          | (NonNullable<typeof delivery.evidence> & {
              sqlCoverage?: unknown;
            })
          | undefined
      )?.sqlCoverage
    ).toBeUndefined();
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
