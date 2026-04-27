import { DomainError } from "../../src/common/domain-error";
import { Text2SqlV2RunnerService } from "../../src/modules/conversation/agent/v2/text2sql-v2-runner.service";
import { Text2SqlV2StateMachine } from "../../src/modules/conversation/agent/v2/text2sql-v2-state-machine";

const createPreparedRunContext = () =>
  ({
    runId: "run-v2",
    requestId: "req-v2",
    question: "统计订单总数",
    session: {
      id: "session-v2",
      datasource: "sqlite_main",
      modelCatalogId: undefined
    },
    datasource: {
      id: "sqlite_main",
      type: "sqlite"
    },
    sqlAccessContext: {
      allowedTables: ["orders"],
      readonly: true
    },
    userPersistResult: {
      primaryPersisted: true
    }
  }) as never;

const createRunnerService = (overrides?: {
  clarifyDecision?: Record<string, unknown>;
  generateSqlImpl?: () => Promise<Record<string, unknown>>;
  safetyCheckImpl?: jest.Mock;
  executeSqlImpl?: jest.Mock;
  correctionDecisionImpl?: jest.Mock;
}) =>
  new Text2SqlV2RunnerService(
    {
      evaluate: jest.fn(() => ({
        shouldClarify: false,
        reason: "continue",
        question: "",
        triggerPath: "rule",
        decisionSource: "rule",
        bypassed: false,
        confidenceLevel: "high",
        missingCriticalSlots: [],
        reasonCodes: [],
        ...(overrides?.clarifyDecision ?? {})
      }))
    } as never,
    {
      run: jest.fn(async () => ({
        status: "ready",
        snippets: [],
        summary: "ready",
        retrievalBundle: {
          status: "ready",
          selected_context: [],
          candidates: [],
          degrade_reasons: [],
          risk_tags: []
        },
        contextPack: {
          status: "ready",
          selectedEvidenceIds: [],
          selectedTables: [],
          selectedColumns: []
        },
        pinning: {
          enabled: false,
          status: "inactive"
        }
      }))
    } as never,
    {
      run: jest.fn(async () => ({
        status: "ready",
        intent: "aggregate",
        constraints: [],
        summary: "ok",
        riskTags: []
      }))
    } as never,
    {
      run: jest.fn(async () => ({
        status: "ready",
        semanticHints: [],
        lockStatus: "locked",
        fallbackApplied: false,
        riskTags: [],
        summary: "semantic ready"
      }))
    } as never,
    {
      run: jest.fn(async () => ({
        status: "ready",
        strategy: "direct_sql",
        semanticConstraintMode: "structured",
        lockStatus: "locked",
        fallbackApplied: false,
        cacheStatus: "miss",
        summary: "physical ready"
      }))
    } as never,
    {
      run: jest.fn(() => ({
        status: "miss",
        reasonCodes: ["lane_missing"]
      }))
    } as never,
    {
      run:
        overrides?.generateSqlImpl ??
        jest.fn(async () => ({
          provider: "volcengine",
          model: "mock-model",
          sql: "select count(*) as total from orders",
          explanation: "generated",
          rawText: "select count(*) as total from orders",
          prompt: {
            systemPrompt: "system",
            userPrompt: "user"
          },
          semanticContextPack: {
            status: "ready",
            selectedEvidenceIds: ["chunk-orders-1"],
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"]
          },
          semanticPlan: {
            route: "answer",
            standaloneQuestion: "统计订单总数",
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"],
            confidence: 0.9,
            evidenceRefs: ["chunk-orders-1"],
            snapshotId: "semantic-plan:text-to-sql:ready:t1:c1:e1:g0:orders"
          }
        }))
    } as never,
    {
      run:
        overrides?.safetyCheckImpl ??
        jest.fn(async () => ({
          allowed: true,
          mode: "pass",
          riskLevel: "low",
          riskTags: []
        }))
    } as never,
    {
      run:
        overrides?.executeSqlImpl ??
        jest.fn(async () => ({
          rows: [{ total: 10 }],
          columns: ["total"]
        }))
    } as never,
    {
      run: jest.fn(() => "订单总数为 10")
    } as never,
    {
      decide:
        overrides?.correctionDecisionImpl ??
        jest.fn(() => ({
          correctable: false,
          reason: "none",
          maxAttempts: 2
        }))
    } as never,
    {
      getToolsForDatasource: jest.fn(() => ({}))
    } as never,
    {
      resolveText2SqlStageTaskProfilePolicy: jest.fn((input: { stage: string }) => ({
        stage: input.stage,
        taskProfile:
          input.stage === "semantic-plan"
            ? "semantic-planning"
            : input.stage === "generate-sql"
              ? "sql-generation"
              : "intake-fast",
        reasoningTier:
          input.stage === "semantic-plan" || input.stage === "generate-sql"
            ? "high"
            : "low",
        provider: "volcengine",
        model: "mock-model",
        policySource: "session_model_binding"
      }))
    } as never,
    {
      startRoot: jest.fn(() => ({})),
      recordSpan: jest.fn(),
      endRoot: jest.fn()
    } as never,
    new Text2SqlV2StateMachine()
  );

describe("Text2SqlV2RunnerService", () => {
  it("returns the canonical v2 trace contract for a successful run", async () => {
    const service = createRunnerService();

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("executionResult");
    expect(run.trace.v2?.version).toBe("v2");
    expect(run.trace.v2?.stageOrder).toEqual([
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
    expect(run.trace.v2?.stages.map((item) => item.stage)).toEqual(
      run.trace.v2?.stageOrder
    );
    expect(run.trace.v2?.semanticPlan?.snapshotId).toBe(
      "semantic-plan:text-to-sql:ready:t1:c1:e1:g0:orders"
    );
    const generateSqlStage = run.trace.v2?.stages.find(
      (item) => item.stage === "generate-sql"
    );
    expect(generateSqlStage).toEqual(
      expect.objectContaining({
        stage: "generate-sql",
        status: "success",
        provider: {
          provider: run.provider,
          model: run.model
        }
      })
    );
    expect(generateSqlStage?.metadata).toMatchObject({
      taskProfile: expect.any(String),
      reasoningTier: expect.any(String)
    });
  });

  it("records minimal loop evidence when clarification exits before retrieval", async () => {
    const service = createRunnerService({
      clarifyDecision: {
        shouldClarify: true,
        question: "请补充时间范围。",
        reason: "关键槽位缺失：时间范围",
        triggerPath: "hybrid",
        confidenceLevel: "low",
        reasonCodes: ["missing_time_slot"]
      }
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("clarification");
    expect(run.answer).toBe("请补充时间范围。");
    expect(run.trace.v2?.terminationReason).toBe("clarification_requested");
    expect(run.trace.v2?.loopEvidence).toEqual([
      {
        loopIndex: 1,
        triggerReason: "missing_time_slot",
        actionType: "clarify",
        planDelta: {
          route: {
            to: "clarify"
          },
          reasonCodes: ["missing_time_slot"]
        },
        terminationReason: "clarification_requested",
        convergencePath: ["intake", "clarification"]
      }
    ]);
  });

  it("records semantic-plan clarification loop evidence and returns clarification", async () => {
    const service = createRunnerService({
      generateSqlImpl: jest.fn(async () => {
        throw new DomainError(
          "SEMANTIC_PLAN_REQUIRES_CLARIFICATION",
          "语义计划要求先澄清问题，已阻止 SQL 生成。",
          422,
          {
            validation: {
              reasons: ["plan_missing_coverage_gaps", "semantic_plan_requires_clarification"]
            },
            semanticPlan: {
              route: "clarify",
              standaloneQuestion: "统计订单总数",
              selectedTables: [],
              selectedColumns: [],
              confidence: 0.3,
              evidenceRefs: [],
              coverageGaps: [
                {
                  gapType: "user_decision_gap",
                  subjectKind: "time",
                  reasonCode: "semantic_plan_requires_clarification",
                  evidenceRefs: [],
                  impactScope: "clarification"
                }
              ],
              snapshotId: "semantic-plan:clarify:ready:t0:c0:e0:g1:none"
            }
          }
        );
      })
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("clarification");
    expect(run.answer).toBe("请补充时间范围或统计窗口，以便继续生成 SQL。");
    expect(run.trace.v2?.terminationReason).toBe(
      "semantic_plan_requires_clarification"
    );
    expect(run.trace.v2?.semanticPlan?.route).toBe("clarify");
    expect(run.trace.v2?.loopEvidence).toEqual([
      {
        loopIndex: 1,
        triggerReason:
          "plan_missing_coverage_gaps|semantic_plan_requires_clarification",
        actionType: "clarify",
        planDelta: {
          route: {
            to: "clarify"
          },
          snapshotId: "semantic-plan:clarify:ready:t0:c0:e0:g1:none",
          addedCoverageGapTypes: ["user_decision_gap"],
          reasonCodes: [
            "plan_missing_coverage_gaps",
            "semantic_plan_requires_clarification"
          ]
        },
        terminationReason: "semantic_plan_requires_clarification",
        convergencePath: [
          "retrieve",
          "assemble-context",
          "semantic-plan",
          "generate-sql",
          "clarification"
        ]
      }
    ]);
  });

  it("records semantic-plan fail-closed loop evidence and returns rejected", async () => {
    const service = createRunnerService({
      generateSqlImpl: jest.fn(async () => {
        throw new DomainError(
          "SEMANTIC_PLAN_FAIL_CLOSED",
          "语义计划进入 fail-closed 路径，已阻止 SQL 生成。",
          422,
          {
            validation: {
              reasons: ["plan_missing_coverage_gaps", "clarification_budget_exhausted"]
            },
            semanticPlan: {
              route: "reject",
              standaloneQuestion: "统计订单总数",
              selectedTables: [],
              selectedColumns: [],
              confidence: 0.2,
              evidenceRefs: [],
              coverageGaps: [
                {
                  gapType: "user_decision_gap",
                  subjectKind: "time",
                  reasonCode: "clarification_budget_exhausted",
                  evidenceRefs: [],
                  impactScope: "execution"
                }
              ],
              snapshotId: "semantic-plan:fail-closed:degraded:t0:c0:e0:g1:none"
            }
          }
        );
      })
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("rejected");
    expect(run.error).toBe("语义计划进入 fail-closed 路径，已阻止 SQL 生成。");
    expect(run.trace.v2?.terminationReason).toBe("semantic_plan_fail_closed");
    expect(run.trace.v2?.semanticPlan?.route).toBe("reject");
    expect(run.trace.v2?.semanticPlan?.snapshotId).toBe(
      "semantic-plan:fail-closed:degraded:t0:c0:e0:g1:none"
    );
    expect(run.trace.v2?.loopEvidence).toEqual([
      {
        loopIndex: 1,
        triggerReason:
          "plan_missing_coverage_gaps|clarification_budget_exhausted|semantic_plan_fail_closed",
        actionType: "fail_closed",
        planDelta: {
          route: {
            to: "reject"
          },
          snapshotId: "semantic-plan:fail-closed:degraded:t0:c0:e0:g1:none",
          addedCoverageGapTypes: ["user_decision_gap"],
          reasonCodes: [
            "plan_missing_coverage_gaps",
            "clarification_budget_exhausted",
            "semantic_plan_fail_closed"
          ]
        },
        terminationReason: "semantic_plan_fail_closed",
        convergencePath: [
          "retrieve",
          "assemble-context",
          "semantic-plan",
          "generate-sql",
          "reject"
        ]
      }
    ]);
  });

  it.each([
    {
      code: "SEMANTIC_PLAN_METADATA_ANSWER",
      routeKind: "metadata",
      answer: "这是元数据查询，请查看当前数据源的表、字段与语义证据。"
    },
    {
      code: "SEMANTIC_PLAN_GENERAL_ANSWER",
      routeKind: "general",
      answer: "这是通用说明问题，不需要执行 SQL；我会基于已有语义证据直接解释。"
    }
  ])("answers $routeKind route without validation or SQL execution", async ({ code, routeKind, answer }) => {
    const executeSqlImpl = jest.fn();
    const service = createRunnerService({
      executeSqlImpl,
      generateSqlImpl: jest.fn(async () => {
        throw new DomainError(code, "non sql route", 200, {
          validation: {
            reasons: [],
            routeKind,
            valid: true
          },
          semanticPlan: {
            route: "answer",
            standaloneQuestion: "什么是 GMV 口径？",
            selectedTables: [],
            selectedColumns: [],
            confidence: 0.74,
            evidenceRefs: ["metric.gmv"],
            filters: [`route_kind:${routeKind}`],
            snapshotId: `semantic-plan:${routeKind}:ready:t0:c0:e1:g0:none`
          },
          answer
        });
      })
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("executionResult");
    expect(run.answer).toBe(answer);
    expect(run.sql).toBeUndefined();
    expect(executeSqlImpl).not.toHaveBeenCalled();
    expect(run.trace.v2?.terminationReason).toBe(`semantic_plan_${routeKind}_answer`);
    expect(run.trace.v2?.semanticPlan?.filters).toContain(`route_kind:${routeKind}`);
    expect(
      run.trace.v2?.stages.find((stage) => stage.stage === "generate-sql")
    ).toMatchObject({
      status: "skipped",
      metadata: {
        routeKind
      }
    });
    expect(
      run.trace.v2?.stages.find((stage) => stage.stage === "execute")
    ).toMatchObject({
      status: "skipped"
    });
  });

  it("re-enters validation and execution after a correctable execution error", async () => {
    const generateSqlImpl = jest
      .fn()
      .mockResolvedValueOnce({
        provider: "volcengine",
        model: "mock-model",
        sql: "select missing_city from orders",
        explanation: "generated",
        rawText: "select missing_city from orders",
        prompt: {
          systemPrompt: "system",
          userPrompt: "user"
        },
        semanticContextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-orders-1"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"]
        },
        semanticPlan: {
          route: "answer",
          standaloneQuestion: "统计订单总数",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"],
          confidence: 0.9,
          evidenceRefs: ["chunk-orders-1"]
        }
      })
      .mockResolvedValueOnce({
        provider: "volcengine",
        model: "mock-model",
        sql: "select count(*) as total from orders",
        explanation: "corrected",
        rawText: "select count(*) as total from orders",
        prompt: {
          systemPrompt: "system",
          userPrompt: "user"
        },
        semanticContextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-orders-1"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"]
        },
        semanticPlan: {
          route: "answer",
          standaloneQuestion: "统计订单总数",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"],
          confidence: 0.9,
          evidenceRefs: ["chunk-orders-1"]
        }
      });
    const safetyCheckImpl = jest.fn(async () => ({
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    }));
    const executeSqlImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("unknown column `missing_city`"))
      .mockResolvedValueOnce({
        rows: [{ total: 10 }],
        columns: ["total"]
      });
    const correctionDecisionImpl = jest.fn(() => ({
      correctable: true,
      reason: "unknown column `missing_city`",
      maxAttempts: 2
    }));
    const service = createRunnerService({
      generateSqlImpl,
      safetyCheckImpl,
      executeSqlImpl,
      correctionDecisionImpl
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("executionResult");
    expect(run.trace.retryCount).toBe(1);
    expect(generateSqlImpl).toHaveBeenCalledTimes(2);
    expect(safetyCheckImpl).toHaveBeenCalledTimes(2);
    expect(executeSqlImpl).toHaveBeenCalledTimes(2);
    expect(correctionDecisionImpl).toHaveBeenCalledTimes(1);
    expect(run.sql).toBe("select count(*) as total from orders");
    expect(run.trace.steps.map((step) => step.node)).toContain(
      "relationship-correction"
    );
  });

  it("stops correction after the configured max attempts", async () => {
    const generateSqlImpl = jest.fn(async () => ({
      provider: "volcengine",
      model: "mock-model",
      sql: "select missing_city from orders",
      explanation: "generated",
      rawText: "select missing_city from orders",
      prompt: {
        systemPrompt: "system",
        userPrompt: "user"
      },
      semanticContextPack: {
        status: "ready",
        selectedEvidenceIds: ["chunk-orders-1"],
        selectedTables: ["orders"],
        selectedColumns: ["orders.id"]
      },
      semanticPlan: {
        route: "answer",
        standaloneQuestion: "统计订单总数",
        selectedTables: ["orders"],
        selectedColumns: ["orders.id"],
        confidence: 0.9,
        evidenceRefs: ["chunk-orders-1"]
      }
    }));
    const executeSqlImpl = jest.fn(async () => {
      throw new Error("unknown column `missing_city`");
    });
    const correctionDecisionImpl = jest.fn(() => ({
      correctable: true,
      reason: "unknown column `missing_city`",
      maxAttempts: 1
    }));
    const service = createRunnerService({
      generateSqlImpl,
      executeSqlImpl,
      correctionDecisionImpl
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("failed");
    expect(run.error).toBe("unknown column `missing_city`");
    expect(run.trace.retryCount).toBe(1);
    expect(generateSqlImpl).toHaveBeenCalledTimes(2);
    expect(executeSqlImpl).toHaveBeenCalledTimes(2);
    expect(correctionDecisionImpl).toHaveBeenCalledTimes(2);
  });

  it("does not execute SQL when validation returns a terminal safety decision", async () => {
    const safetyCheckImpl = jest.fn(async () => ({
      allowed: false,
      mode: "hard-block",
      riskLevel: "high",
      riskTags: ["terminal_validation_failure", "SQL_READ_ONLY_VIOLATION"],
      reason: "检测到写操作或 DDL，已阻止执行"
    }));
    const executeSqlImpl = jest.fn();
    const service = createRunnerService({
      safetyCheckImpl,
      executeSqlImpl
    });

    const run = await service.runSync(
      createPreparedRunContext(),
      "/api/v1/sessions/:sessionId/messages"
    );

    expect(run.status).toBe("rejected");
    expect(run.error).toBe("检测到写操作或 DDL，已阻止执行");
    expect(safetyCheckImpl).toHaveBeenCalledTimes(1);
    expect(executeSqlImpl).not.toHaveBeenCalled();
    expect(run.trace.v2?.stages.find((stage) => stage.stage === "validate")).toMatchObject({
      status: "failed",
      failure: {
        code: "VALIDATION_REJECTED",
        category: "governance",
        terminal: true,
        correctable: false
      }
    });
  });
});
