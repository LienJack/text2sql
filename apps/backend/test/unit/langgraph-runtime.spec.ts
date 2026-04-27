import type { SqlRun } from "@text2sql/shared-types";
import { createText2SqlV2LangGraph } from "../../src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.graph";
import {
  createText2SqlV2LangGraphInitialState
} from "../../src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.state";
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
        {
          stage: "generate-sql",
          status: "success",
          provider: { provider: "volcengine", model: "mock-model" }
        },
        { stage: "validate", status: "success" },
        { stage: "correct", status: "skipped" },
        { stage: "execute", status: "success" },
        { stage: "answer", status: "success" }
      ]
    },
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
        v2: {
          ...(createBaseRun().trace.v2 ?? {
            version: "v2",
            stageOrder: [],
            stages: []
          }),
          stages:
            createBaseRun().trace.v2?.stages.map((stage) =>
              stage.stage === "correct" ? { ...stage, status: "success" } : stage
            ) ?? []
        },
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
        v2: {
          ...(createBaseRun().trace.v2 ?? {
            version: "v2",
            stageOrder: [],
            stages: []
          }),
          stages:
            createBaseRun().trace.v2?.stages.map((stage) =>
              stage.stage === "correct"
                ? {
                    ...stage,
                    status: "failed",
                    failure: {
                      code: "CORRECT_FAILED",
                      message: "unknown column foo",
                      category: "validation",
                      terminal: true,
                      correctable: true
                    }
                  }
                : stage
            ) ?? []
        },
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
          stages: [{ stage: "intake", status: "clarification" }]
        },
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
    expect(artifact.stages.find((stage) => stage.stage === "answer")?.status).toBe("skipped");
  });

  it("compiles canonical langgraph backbone with conditional routing and no legacy delegation", async () => {
    const intakeNode = {
      run: jest.fn().mockReturnValue({
        originalQuestion: "统计订单总数",
        normalizedQuestion: "统计订单总数",
        standaloneQuestion: "统计订单总数",
        route: "text_to_sql",
        reasonCodes: ["intake_ready_for_text_to_sql"],
        confidence: 0.9,
        evidenceRefs: ["chunk-orders-1"],
        semanticIntent: "count"
      })
    };
    const retrieveContextNode = {
      run: jest.fn().mockResolvedValue({
        state: {
          status: "ready",
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          evidenceRefs: ["chunk-orders-1"],
          selectedContextSummary: {
            count: 1,
            snippetPreviews: ["orders snippet"]
          },
          warnings: []
        },
        artifact: {
          status: "ready",
          evidenceRefs: ["chunk-orders-1"],
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          retrievalBundle: {
            run_id: "run-v2-runtime",
            datasource_id: "sqlite_main",
            status: "ready",
            selected_context: [{ chunk_id: "chunk-orders-1", content: "orders snippet" }],
            degrade_reasons: []
          },
          contextPack: {
            status: "ready",
            selected_context: [{ chunk_id: "chunk-orders-1", content: "orders snippet" }],
            degrade_reasons: []
          }
        }
      })
    };
    const assembleContextNode = {
      run: jest.fn().mockReturnValue({
        contextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-orders-1"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"]
        },
        typedSummary: {
          status: "ready",
          selectedEvidenceCount: 1,
          selectedTableCount: 1,
          selectedColumnCount: 1,
          laneStateCounts: {
            ready: 1,
            degraded: 0,
            unavailable: 0,
            skipped: 0
          },
          pruningDecisionCount: 0,
          permissionReasonCount: 0,
          warningCount: 0
        },
        evidenceRefs: ["chunk-orders-1"]
      })
    };
    const semanticPlanNode = {
      run: jest.fn().mockReturnValue({
        route: "ready",
        plan: {
          route: "answer",
          standaloneQuestion: "统计订单总数",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"],
          confidence: 0.9,
          evidenceRefs: ["chunk-orders-1"],
          filters: ["route_kind:text_to_sql"]
        },
        validation: {
          valid: true,
          lowConfidence: false,
          unsupportedTables: [],
          unsupportedColumns: [],
          reasons: [],
          routeKind: "text_to_sql",
          outcome: "ready",
          evidenceComplete: true,
          requiresClarification: false,
          shouldDirectAnswer: false,
          terminal: false
        }
      })
    };
    const generateSqlNode = {
      run: jest.fn().mockResolvedValue({
        draft: {
          provider: "volcengine",
          model: "mock-model",
          sql: "SELECT COUNT(*) AS total FROM orders",
          explanation: "count orders",
          rawText: "SELECT COUNT(*) AS total FROM orders",
          prompt: {
            systemPrompt: "system",
            userPrompt: "user"
          }
        },
        artifact: {
          sql: "SELECT COUNT(*) AS total FROM orders",
          assumptions: ["count orders"],
          usedTables: ["orders"],
          usedColumns: ["orders.id"],
          evidenceRefs: ["chunk-orders-1"],
          cause: "initial",
          dialect: "sqlite"
        }
      })
    };
    const validateSqlNode = {
      run: jest.fn().mockResolvedValue({
        outcome: "pass",
        artifact: {
          status: "passed",
          checks: [],
          correctable: false
        }
      })
    };
    const correctSqlNode = {
      run: jest.fn()
    };
    const executeSqlNode = {
      run: jest.fn().mockResolvedValue({
        rows: [{ total: 10 }],
        columns: ["total"],
        rowCount: 1,
        emptyResult: false
      })
    };
    const answerNode = {
      run: jest.fn().mockReturnValue({
        mode: "execution_result",
        answer: "订单总数为 10",
        status: "executionResult",
        evidenceRefs: ["chunk-orders-1"],
        warnings: []
      })
    };

    const graph = createText2SqlV2LangGraph({
      intakeNode: intakeNode as never,
      retrieveContextNode: retrieveContextNode as never,
      assembleContextNode: assembleContextNode as never,
      semanticPlanNode: semanticPlanNode as never,
      generateSqlNode: generateSqlNode as never,
      validateSqlNode: validateSqlNode as never,
      correctSqlNode: correctSqlNode as never,
      executeSqlNode: executeSqlNode as never,
      answerNode: answerNode as never,
      resolveSqlTools: jest.fn().mockReturnValue({})
    });
    const finalState = await graph.invoke(
      createText2SqlV2LangGraphInitialState({
        preparedRun: {
          runId: "run-v2-runtime",
          requestId: "req-v2-runtime",
          question: "统计订单总数",
          session: {
            id: "session-v2-runtime",
            datasource: "sqlite_main",
            modelProvider: "volcengine",
            modelName: "mock-model"
          },
          datasource: {
            id: "sqlite_main",
            type: "sqlite"
          },
          sqlAccessContext: undefined,
          contextEnvelope: undefined,
          userPersistResult: {
            primaryPersisted: true
          }
        } as never,
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      })
    );

    expect(finalState.stageProgress).toEqual([
      "intake",
      "retrieve",
      "assemble-context",
      "semantic-plan",
      "generate-sql",
      "validate",
      "execute",
      "answer"
    ]);
    expect(finalState.answerResult?.status).toBe("executionResult");
    expect(correctSqlNode.run).not.toHaveBeenCalled();
    expect(generateSqlNode.run).toHaveBeenCalledTimes(1);
  });

  it("routes metadata intent through retrieve/assemble/semantic-plan and skips SQL stages", async () => {
    const intakeNode = {
      run: jest.fn().mockReturnValue({
        originalQuestion: "数据库有哪些表",
        normalizedQuestion: "数据库有哪些表",
        standaloneQuestion: "数据库有哪些表",
        route: "metadata",
        reasonCodes: ["intake_metadata_detected"],
        confidence: 0.95,
        evidenceRefs: ["chunk-schema-orders"],
        semanticIntent: "metadata",
        directAnswer:
          "这是元数据问题，我会基于可访问的表结构与语义证据直接说明，不执行 SQL。"
      })
    };
    const retrieveContextNode = {
      run: jest.fn().mockResolvedValue({
        state: {
          status: "ready",
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          evidenceRefs: ["chunk-schema-orders"],
          selectedContextSummary: {
            count: 1,
            snippetPreviews: ["orders table schema"]
          },
          warnings: []
        },
        artifact: {
          status: "ready",
          evidenceRefs: ["chunk-schema-orders"],
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          retrievalBundle: {
            run_id: "run-v2-runtime",
            datasource_id: "sqlite_main",
            status: "ready",
            selected_context: [
              {
                chunk_id: "chunk-schema-orders",
                content: "orders(id, amount, status)"
              }
            ],
            degrade_reasons: []
          },
          contextPack: {
            status: "ready",
            selected_context: [
              {
                chunk_id: "chunk-schema-orders",
                content: "orders(id, amount, status)"
              }
            ],
            degrade_reasons: []
          }
        }
      })
    };
    const assembleContextNode = {
      run: jest.fn().mockReturnValue({
        contextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-schema-orders"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id", "orders.amount"]
        },
        typedSummary: {
          status: "ready",
          selectedEvidenceCount: 1,
          selectedTableCount: 1,
          selectedColumnCount: 2,
          laneStateCounts: {
            ready: 1,
            degraded: 0,
            unavailable: 0,
            skipped: 0
          },
          pruningDecisionCount: 0,
          permissionReasonCount: 0,
          warningCount: 0
        },
        evidenceRefs: ["chunk-schema-orders"]
      })
    };
    const semanticPlanNode = {
      run: jest.fn().mockReturnValue({
        route: "direct_answer",
        plan: {
          route: "answer",
          standaloneQuestion: "数据库有哪些表",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id", "orders.amount"],
          confidence: 0.88,
          evidenceRefs: ["chunk-schema-orders"],
          filters: ["route_kind:metadata"]
        },
        validation: {
          valid: true,
          lowConfidence: false,
          unsupportedTables: [],
          unsupportedColumns: [],
          reasons: [],
          routeKind: "metadata",
          outcome: "direct_answer",
          evidenceComplete: true,
          requiresClarification: false,
          shouldDirectAnswer: true,
          terminal: false
        }
      })
    };
    const generateSqlNode = {
      run: jest.fn()
    };
    const validateSqlNode = {
      run: jest.fn()
    };
    const correctSqlNode = {
      run: jest.fn()
    };
    const executeSqlNode = {
      run: jest.fn()
    };
    const answerNode = {
      run: jest.fn().mockReturnValue({
        mode: "direct_answer",
        answer: "orders 表包含 id、amount、status 字段。",
        status: "executionResult",
        evidenceRefs: ["chunk-schema-orders"],
        warnings: []
      })
    };

    const graph = createText2SqlV2LangGraph({
      intakeNode: intakeNode as never,
      retrieveContextNode: retrieveContextNode as never,
      assembleContextNode: assembleContextNode as never,
      semanticPlanNode: semanticPlanNode as never,
      generateSqlNode: generateSqlNode as never,
      validateSqlNode: validateSqlNode as never,
      correctSqlNode: correctSqlNode as never,
      executeSqlNode: executeSqlNode as never,
      answerNode: answerNode as never,
      resolveSqlTools: jest.fn().mockReturnValue({})
    });
    const finalState = await graph.invoke(
      createText2SqlV2LangGraphInitialState({
        preparedRun: {
          runId: "run-v2-runtime",
          requestId: "req-v2-runtime",
          question: "数据库有哪些表",
          session: {
            id: "session-v2-runtime",
            datasource: "sqlite_main",
            modelProvider: "volcengine",
            modelName: "mock-model"
          },
          datasource: {
            id: "sqlite_main",
            type: "sqlite"
          },
          sqlAccessContext: undefined,
          contextEnvelope: undefined,
          userPersistResult: {
            primaryPersisted: true
          }
        } as never,
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      })
    );

    expect(finalState.stageProgress).toEqual([
      "intake",
      "retrieve",
      "assemble-context",
      "semantic-plan",
      "answer"
    ]);
    expect(generateSqlNode.run).not.toHaveBeenCalled();
    expect(validateSqlNode.run).not.toHaveBeenCalled();
    expect(executeSqlNode.run).not.toHaveBeenCalled();
    expect(answerNode.run).toHaveBeenCalledTimes(1);
  });

  it("passes correction grounding into second generation attempt after correctable validation", async () => {
    const intakeNode = {
      run: jest.fn().mockReturnValue({
        originalQuestion: "统计订单总数",
        normalizedQuestion: "统计订单总数",
        standaloneQuestion: "统计订单总数",
        route: "text_to_sql",
        reasonCodes: ["intake_ready_for_text_to_sql"],
        confidence: 0.9,
        evidenceRefs: ["chunk-orders-1"],
        semanticIntent: "count"
      })
    };
    const retrieveContextNode = {
      run: jest.fn().mockResolvedValue({
        state: {
          status: "ready",
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          evidenceRefs: ["chunk-orders-1"],
          selectedContextSummary: {
            count: 1,
            snippetPreviews: ["orders snippet"]
          },
          warnings: []
        },
        artifact: {
          status: "ready",
          evidenceRefs: ["chunk-orders-1"],
          typedSummary: {
            denseState: "ready",
            denseReason: undefined,
            rerankState: "ready",
            rerankReason: undefined,
            degradeReasons: []
          },
          retrievalBundle: {
            run_id: "run-v2-runtime",
            datasource_id: "sqlite_main",
            status: "ready",
            selected_context: [{ chunk_id: "chunk-orders-1", content: "orders snippet" }],
            degrade_reasons: []
          },
          contextPack: {
            status: "ready",
            selected_context: [{ chunk_id: "chunk-orders-1", content: "orders snippet" }],
            degrade_reasons: []
          }
        }
      })
    };
    const assembleContextNode = {
      run: jest.fn().mockReturnValue({
        contextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-orders-1"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"]
        },
        typedSummary: {
          status: "ready",
          selectedEvidenceCount: 1,
          selectedTableCount: 1,
          selectedColumnCount: 1,
          laneStateCounts: {
            ready: 1,
            degraded: 0,
            unavailable: 0,
            skipped: 0
          },
          pruningDecisionCount: 0,
          permissionReasonCount: 0,
          warningCount: 0
        },
        evidenceRefs: ["chunk-orders-1"]
      })
    };
    const semanticPlanNode = {
      run: jest.fn().mockReturnValue({
        route: "ready",
        plan: {
          route: "answer",
          standaloneQuestion: "统计订单总数",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"],
          confidence: 0.9,
          evidenceRefs: ["chunk-orders-1"],
          snapshotId: "semantic-plan-1",
          filters: ["route_kind:text_to_sql"]
        },
        validation: {
          valid: true,
          lowConfidence: false,
          unsupportedTables: [],
          unsupportedColumns: [],
          reasons: [],
          routeKind: "text_to_sql",
          outcome: "ready",
          evidenceComplete: true,
          requiresClarification: false,
          shouldDirectAnswer: false,
          terminal: false
        }
      })
    };
    const generateSqlNode = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          draft: {
            provider: "volcengine",
            model: "mock-model",
            sql: "SELECT missing_city FROM orders",
            explanation: "initial attempt",
            rawText: "SELECT missing_city FROM orders",
            prompt: {
              systemPrompt: "system",
              userPrompt: "user"
            }
          },
          artifact: {
            sql: "SELECT missing_city FROM orders",
            assumptions: ["initial attempt"],
            usedTables: ["orders"],
            usedColumns: ["orders.missing_city"],
            evidenceRefs: ["chunk-orders-1"],
            cause: "initial",
            dialect: "sqlite"
          }
        })
        .mockResolvedValueOnce({
          draft: {
            provider: "volcengine",
            model: "mock-model",
            sql: "SELECT orders.id FROM orders",
            explanation: "retry attempt",
            rawText: "SELECT orders.id FROM orders",
            prompt: {
              systemPrompt: "system",
              userPrompt: "user"
            }
          },
          artifact: {
            sql: "SELECT orders.id FROM orders",
            assumptions: ["retry attempt"],
            usedTables: ["orders"],
            usedColumns: ["orders.id"],
            evidenceRefs: ["chunk-orders-1"],
            cause: "correction",
            dialect: "sqlite"
          }
        })
    };
    const validateSqlNode = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "correctable",
          artifact: {
            status: "failed",
            checks: [],
            correctable: true,
            failure: {
              code: "SQL_MISSING_COLUMN",
              message: "missing column orders.missing_city",
              category: "validation",
              terminal: false,
              correctable: true
            }
          }
        })
        .mockResolvedValueOnce({
          outcome: "pass",
          artifact: {
            status: "passed",
            checks: [],
            correctable: false
          }
        })
    };
    const correctSqlNode = {
      run: jest.fn().mockReturnValue({
        outcome: "retry_generation",
        budget: {
          attemptCount: 1,
          maxAttempts: 2,
          remainingAttempts: 1,
          exhausted: false
        },
        artifact: {
          failedSql: "SELECT missing_city FROM orders",
          retryReason: "missing column orders.missing_city",
          category: "validation",
          source: "validation",
          failureCode: "SQL_MISSING_COLUMN",
          attemptCount: 1,
          maxAttempts: 2,
          semanticPlanSnapshotId: "semantic-plan-1",
          evidenceRefs: ["chunk-orders-1"],
          shouldRevalidate: true,
          grounding: {
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
      })
    };
    const executeSqlNode = {
      run: jest.fn().mockResolvedValue({
        rows: [{ total: 10 }],
        columns: ["total"],
        rowCount: 1,
        emptyResult: false
      })
    };
    const answerNode = {
      run: jest.fn().mockReturnValue({
        mode: "execution_result",
        answer: "订单总数为 10",
        status: "executionResult",
        evidenceRefs: ["chunk-orders-1"],
        warnings: []
      })
    };

    const graph = createText2SqlV2LangGraph({
      intakeNode: intakeNode as never,
      retrieveContextNode: retrieveContextNode as never,
      assembleContextNode: assembleContextNode as never,
      semanticPlanNode: semanticPlanNode as never,
      generateSqlNode: generateSqlNode as never,
      validateSqlNode: validateSqlNode as never,
      correctSqlNode: correctSqlNode as never,
      executeSqlNode: executeSqlNode as never,
      answerNode: answerNode as never,
      resolveSqlTools: jest.fn().mockReturnValue({})
    });
    const finalState = await graph.invoke(
      createText2SqlV2LangGraphInitialState({
        preparedRun: {
          runId: "run-v2-runtime",
          requestId: "req-v2-runtime",
          question: "统计订单总数",
          session: {
            id: "session-v2-runtime",
            datasource: "sqlite_main",
            modelProvider: "volcengine",
            modelName: "mock-model"
          },
          datasource: {
            id: "sqlite_main",
            type: "sqlite"
          },
          sqlAccessContext: undefined,
          contextEnvelope: undefined,
          userPersistResult: {
            primaryPersisted: true
          }
        } as never,
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      })
    );

    expect(generateSqlNode.run).toHaveBeenCalledTimes(2);
    expect(generateSqlNode.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cause: "correction",
        retryReason: "missing column orders.missing_city",
        correctionGrounding: expect.objectContaining({
          failedSqlRef: "sql.sha256.abc123abc123abcd",
          attemptCount: 1,
          maxAttempts: 2,
          failureCode: "SQL_MISSING_COLUMN"
        })
      })
    );
    expect(finalState.answerResult?.status).toBe("executionResult");
  });
});
