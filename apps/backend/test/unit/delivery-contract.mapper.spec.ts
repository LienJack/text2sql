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

  it("mirrors context-pack and metadata-answer summaries from trace.v2", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      sql: undefined,
      rows: undefined,
      columns: undefined,
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
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
            {
              stage: "intake",
              status: "success",
              metadata: {
                route: "metadata"
              }
            },
            { stage: "retrieve", status: "success" },
            { stage: "assemble-context", status: "success" },
            { stage: "semantic-plan", status: "success" },
            { stage: "generate-sql", status: "skipped" },
            { stage: "validate", status: "skipped" },
            { stage: "correct", status: "skipped" },
            { stage: "execute", status: "skipped" },
            { stage: "answer", status: "success" }
          ],
          contextPack: {
            status: "degraded",
            selectedEvidenceIds: ["schema-orders", "metric-gmv"],
            selectedTables: ["orders"],
            selectedColumns: ["orders.id", "orders.amount"],
            selectedContextSummary: {
              count: 2,
              evidenceIds: ["schema-orders", "metric-gmv"]
            },
            pruning: {
              applied: true,
              decisions: [
                {
                  removedCount: 1
                }
              ]
            },
            permissionFiltering: {
              status: "applied",
              deniedEvidenceCount: 1
            },
            laneStates: [
              {
                lane: "dense",
                state: "unavailable"
              }
            ],
            degradation: {
              status: "degraded",
              reasons: ["dense_unavailable:provider_missing"]
            }
          },
          semanticPlan: {
            route: "answer",
            standaloneQuestion: "数据库有哪些表",
            selectedTables: ["orders"],
            selectedColumns: ["orders.id", "orders.amount"],
            confidence: 0.87,
            evidenceRefs: ["schema-orders", "metric-gmv"],
            filters: ["route_kind:metadata"]
          }
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.contextPackSummary).toEqual({
      status: "degraded",
      selectedEvidenceCount: 2,
      selectedTableCount: 1,
      selectedColumnCount: 2,
      pruningApplied: true,
      prunedEvidenceCount: 1,
      degradedLaneCount: 1,
      permissionFilteringApplied: true,
      permissionDeniedEvidenceCount: 1,
      degradationReasons: ["dense_unavailable:provider_missing"]
    });
    expect(delivery.evidence?.metadataAnswer).toEqual({
      groundedByContextPack: true,
      routeKind: "metadata",
      evidenceQuality: "degraded",
      selectedEvidenceCount: 2,
      permissionFilteringApplied: true,
      pruningApplied: true,
      degradationReasons: ["dense_unavailable:provider_missing"]
    });
  });

  it("mirrors correction grounding from trace.v2 sqlGeneration artifact", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 1,
        steps: [],
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
            { stage: "correct", status: "success" },
            { stage: "execute", status: "success" },
            { stage: "answer", status: "success" }
          ],
          sqlGeneration: {
            sql: "SELECT orders.id FROM orders",
            usedTables: ["orders"],
            usedColumns: ["orders.id"],
            evidenceRefs: ["chunk-orders-1"],
            correctionGrounding: {
              failedSqlRef: "sql.sha256.abc123abc123abcd",
              retryReason: "missing column orders.missing_city",
              failureCode: "SQL_MISSING_COLUMN",
              failureCategory: "validation",
              source: "validation",
              attemptCount: 1,
              maxAttempts: 2,
              evidenceRefs: ["chunk-orders-1"],
              semanticPlanSnapshotId: "semantic-plan-1",
              semanticPlanRoute: "answer",
              semanticPlanRouteKind: "text_to_sql",
              selectedTableCount: 1,
              selectedColumnCount: 1,
              contextPackStatus: "ready",
              contextPackEvidenceCount: 1
            }
          }
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.correctionGrounding).toMatchObject({
      failedSqlRef: "sql.sha256.abc123abc123abcd",
      retryReason: "missing column orders.missing_city",
      attemptCount: 1,
      maxAttempts: 2,
      failureCode: "SQL_MISSING_COLUMN"
    });
  });

  it("accepts chartbi artifact override and preserves unified answer semantics", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      answer: "订单状态以 paid 为主。"
    });

    const delivery = mapper.map({
      run,
      replayRecords: [],
      artifactOverride: {
        sql: run.sql,
        columns: run.columns,
        rowCount: 1,
        rowsPreview: run.rows?.slice(0, 1),
        hasError: false,
        summary: {
          text: "订单状态以 paid 为主。"
        },
        table: {
          columns: run.columns,
          rowCount: 1,
          rowsPreview: run.rows?.slice(0, 1),
          previewRowCount: 1
        },
        chart: {
          type: "pie",
          mappings: {
            label: "status",
            value: "count"
          }
        },
        display: "pie",
        validation: {
          status: "valid",
          reasonCodes: ["chartbi_baseline_selected"]
        }
      },
      additionalRiskTags: ["chartbi_artifact_failed"]
    });

    expect(delivery.answer.text).toBe(run.answer);
    expect(delivery.artifact?.summary?.text).toBe("订单状态以 paid 为主。");
    expect(delivery.artifact?.chart?.type).toBe("pie");
    expect(delivery.artifact?.display).toBe("pie");
    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["chartbi_artifact_failed"])
    );
  });

  it("keeps safe artifact semantics for clarification runs", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      status: "clarification",
      answer: "请补充时间范围。",
      rows: undefined,
      columns: undefined,
      sql: undefined
    });

    const delivery = mapper.map({
      run,
      replayRecords: [],
      artifactOverride: undefined
    });

    expect(delivery.answer.status).toBe("clarification");
    expect(delivery.artifact).toBeUndefined();
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

  it("maps optional trace.v2 into delivery evidence.v2 without changing base evidence fields", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
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
            {
              stage: "intake",
              status: "success"
            },
            {
              stage: "validate",
              status: "failed",
              failure: {
                code: "VALIDATION_FAILED",
                message: "table not allowed",
                category: "validation",
                terminal: true,
                correctable: false
              }
            }
          ],
          semanticPlan: {
            route: "reject",
            standaloneQuestion: "统计订单",
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"],
            confidence: 0.2,
            evidenceRefs: ["chunk:1"],
            snapshotId: "semantic-plan:fail-closed:ready:t1:c1:e1:g1:orders"
          },
          sqlValidation: {
            status: "failed",
            checks: [
              {
                check: "permission",
                status: "failed",
                code: "TABLE_FORBIDDEN"
              }
            ],
            correctable: false
          },
          loopEvidence: [
            {
              loopIndex: 1,
              triggerReason: "clarification_budget_exhausted|semantic_plan_fail_closed",
              actionType: "fail_closed",
              planDelta: {
                route: {
                  to: "reject"
                },
                snapshotId: "semantic-plan:fail-closed:ready:t1:c1:e1:g1:orders",
                addedCoverageGapTypes: ["user_decision_gap"],
                reasonCodes: [
                  "clarification_budget_exhausted",
                  "semantic_plan_fail_closed"
                ]
              },
              terminationReason: "semantic_plan_fail_closed",
              convergencePath: ["semantic-plan", "generate-sql", "reject"]
            }
          ],
          terminationReason: "semantic_plan_fail_closed"
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.runId).toBe("run-delivery-unit");
    expect(delivery.evidence?.v2?.version).toBe("v2");
    expect(delivery.evidence?.v2?.stageOrder).toEqual([
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
    expect(delivery.evidence?.v2?.stageArtifacts).toHaveLength(2);
    expect(delivery.evidence?.v2?.semanticPlan?.route).toBe("reject");
    expect(delivery.evidence?.v2?.semanticPlan?.snapshotId).toBe(
      "semantic-plan:fail-closed:ready:t1:c1:e1:g1:orders"
    );
    expect(delivery.evidence?.v2?.sqlValidation?.status).toBe("failed");
    expect(delivery.evidence?.v2?.loopEvidence).toEqual([
      {
        loopIndex: 1,
        triggerReason: "clarification_budget_exhausted|semantic_plan_fail_closed",
        actionType: "fail_closed",
        planDelta: {
          route: {
            to: "reject"
          },
          snapshotId: "semantic-plan:fail-closed:ready:t1:c1:e1:g1:orders",
          addedCoverageGapTypes: ["user_decision_gap"],
          reasonCodes: [
            "clarification_budget_exhausted",
            "semantic_plan_fail_closed"
          ]
        },
        terminationReason: "semantic_plan_fail_closed",
        convergencePath: ["semantic-plan", "generate-sql", "reject"]
      }
    ]);
    expect(delivery.evidence?.v2?.terminationReason).toBe("semantic_plan_fail_closed");
    expect(delivery.evidence?.v2?.failure?.code).toBe("VALIDATION_FAILED");
  });

  it("ignores legacy clarify step summaries without canonical trace decision payload", () => {
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

    expect(delivery.evidence?.clarificationDecision).toBeUndefined();
  });

  it("maps SQL coverage evidence from canonical trace.v2 sqlValidation", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
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
            { stage: "validate", status: "success" }
          ],
          sqlValidation: {
            status: "passed",
            checks: [
              {
                check: "plan-coverage",
                status: "passed"
              }
            ],
            correctable: false
          }
        }
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
      triggerSource: "semantic_context"
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

  it("maps saved prior SQL shortcut evidence from canonical v2 stage artifacts", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
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
            { stage: "generate-sql", status: "skipped" },
            { stage: "validate", status: "success" }
          ]
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.savedPriorSql).toEqual({
      status: "hit",
      shortcutUsed: true,
      reasonCodes: ["saved_prior_sql_shortcut"],
      safetyResult: "passed"
    });
  });

  it("reads semantic snapshot from canonical trace.v2 context pack", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun({
      trace: {
        runId: "run-delivery-unit",
        provider: "volcengine",
        retryCount: 0,
        modelingRevision: 21,
        steps: [],
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
          stages: [{ stage: "intake", status: "success" }],
          contextPack: {
            status: "ready",
            selectedEvidenceIds: [],
            selectedTables: [],
            selectedColumns: [],
            warnings: ["semantic_context_ready"]
          }
        }
      } as SqlRun["trace"]
    });

    const delivery = mapper.map({
      run,
      replayRecords: []
    });

    expect(delivery.evidence?.modelingRevision).toBe(21);
    expect(delivery.evidence?.contextPackStatus).toBe("ready");
    expect(delivery.evidence?.semanticDegradeReason).toBe("semantic_context_ready");
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
