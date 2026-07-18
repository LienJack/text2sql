import type { SqlRun } from "@text2sql/shared-types";
import { createText2SqlV2LangGraph } from "../../src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph.graph";
import {
  createText2SqlV2LangGraphInitialState
} from "../../src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph.state";
import { Text2SqlV2ArtifactBuilder } from "../../src/modules/conversation/artifacts/text2sql-v2-artifact-builder";
import { Text2SqlV2LangGraphResultMapper } from "../../src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph-result.mapper";

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

    const artifact = new Text2SqlV2ArtifactBuilder().buildRunArtifact(run);
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

    const artifact = new Text2SqlV2ArtifactBuilder().buildRunArtifact(run);
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

    const artifact = new Text2SqlV2ArtifactBuilder().buildRunArtifact(run);
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
      run: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
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
        };
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
    const streamedSteps: Array<{
      node: string;
      lifecycle?: "running" | "completed" | "failed" | "skipped";
      outputSummary?: string;
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
    }> = [];
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
        streamMode: true,
        streamOptions: {
          onStep: ({ step }) => {
            streamedSteps.push({
              node: step.node,
              lifecycle: step.lifecycle,
              outputSummary: step.outputSummary,
              startedAt: step.startedAt,
              endedAt: step.endedAt,
              durationMs: step.durationMs
            });
          }
        }
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
    expect(
      streamedSteps.filter((step) => step.lifecycle === "running").map((step) => step.node)
    ).toEqual([
      "intake",
      "retrieve-context",
      "assemble-context",
      "semantic-plan",
      "generate-sql",
      "validate-sql",
      "execute-sql",
      "answer"
    ]);
    expect(
      streamedSteps
        .filter((step) => step.lifecycle === "completed")
        .map((step) => step.node)
    ).toEqual([
      "intake",
      "retrieve-context",
      "assemble-context",
      "semantic-plan",
      "generate-sql",
      "validate-sql",
      "execute-sql",
      "answer"
    ]);
    expect(
      streamedSteps
        .filter((step) => step.lifecycle === "skipped")
        .map((step) => step.node)
    ).toEqual(["correct-sql"]);
    expect(
      streamedSteps.some((step) =>
        step.outputSummary?.includes('"status":"running"')
      )
    ).toBe(true);
    const generateRunningStep = streamedSteps.find(
      (step) => step.node === "generate-sql" && step.lifecycle === "running"
    );
    const generateCompletedStep = streamedSteps.find(
      (step) => step.node === "generate-sql" && step.lifecycle === "completed"
    );
    const generateStage = finalState.stageArtifacts.find(
      (stage) => stage.stage === "generate-sql"
    );
    expect(generateRunningStep?.startedAt).toBeDefined();
    expect(generateRunningStep?.endedAt).toBeUndefined();
    expect(generateRunningStep?.durationMs).toBeUndefined();
    expect(generateCompletedStep?.startedAt).toBe(generateRunningStep?.startedAt);
    expect(generateCompletedStep?.endedAt).toBeDefined();
    expect(generateCompletedStep?.durationMs).toBeGreaterThanOrEqual(1);
    expect(generateStage?.startedAt).toBe(generateRunningStep?.startedAt);
    expect(generateStage?.endedAt).toBe(generateCompletedStep?.endedAt);
    expect(generateStage?.durationMs).toBe(generateCompletedStep?.durationMs);
    const artifact = new Text2SqlV2LangGraphResultMapper(
      new Text2SqlV2ArtifactBuilder()
    ).mapRunArtifact(finalState as never);
    expect(
      artifact.runtimePlan?.items.find((item) => item.stage === "generate-sql")
    ).toMatchObject({
      status: "completed"
    });
    expect(
      artifact.runtimePlan?.items.find((item) => item.stage === "correct")
    ).toMatchObject({
      status: "skipped",
      reasonCodes: ["validation_passed"]
    });
  });

  it("runs one targeted dependency retrieval before replanning a missing join closure", async () => {
    const intakeNode = {
      run: jest.fn().mockReturnValue({
        standaloneQuestion: "统计每个客户的订单金额",
        route: "text_to_sql",
        reasonCodes: ["intake_ready_for_text_to_sql"],
        confidence: 0.9,
        evidenceRefs: [],
        semanticIntent: "sum"
      })
    };
    const retrievalOutput = (evidenceRef: string) => ({
      state: {
        status: "ready",
        typedSummary: {
          denseState: "ready",
          rerankState: "ready",
          degradeReasons: []
        },
        evidenceRefs: [evidenceRef],
        selectedContextSummary: {
          count: 1,
          snippetPreviews: [evidenceRef]
        },
        warnings: []
      },
      artifact: {
        status: "ready",
        evidenceRefs: [evidenceRef],
        typedSummary: {
          denseState: "ready",
          rerankState: "ready",
          degradeReasons: []
        },
        retrievalBundle: {
          run_id: "run-targeted-replan",
          datasource_id: "sqlite_main",
          status: "ready",
          selected_context: [{ chunk_id: evidenceRef, content: evidenceRef }],
          degrade_reasons: []
        }
      }
    });
    const retrieveContextNode = {
      run: jest
        .fn()
        .mockResolvedValueOnce(retrievalOutput("schema-orders-customers"))
        .mockResolvedValueOnce(retrievalOutput("relationship-orders-customers"))
    };
    const contextPackSummary = {
      status: "ready",
      selectedEvidenceCount: 1,
      selectedTableCount: 2,
      selectedColumnCount: 3,
      laneStateCounts: {
        ready: 1,
        degraded: 0,
        unavailable: 0,
        skipped: 0
      },
      pruningDecisionCount: 0,
      permissionReasonCount: 0,
      warningCount: 0
    };
    const assembleContextNode = {
      run: jest
        .fn()
        .mockReturnValueOnce({
          contextPack: {
            status: "ready",
            selectedEvidenceIds: ["schema-orders-customers"],
            selectedTables: ["orders", "customers"],
            selectedColumns: [
              "orders.customer_id",
              "orders.amount",
              "customers.id"
            ],
            dependencyClosure: {
              status: "missing",
              conflictSet: [],
              joinClosure: [],
              metricDependencies: [],
              calculatedDependencies: [],
              filterDependencies: [],
              timeDependencies: [],
              mandatoryEvidenceRefs: [],
              optionalEvidenceRefs: ["schema-orders-customers"],
              reasonCodes: ["join_closure_missing"]
            }
          },
          typedSummary: contextPackSummary,
          evidenceRefs: ["schema-orders-customers"]
        })
        .mockReturnValueOnce({
          contextPack: {
            status: "ready",
            selectedEvidenceIds: ["relationship-orders-customers"],
            selectedTables: ["orders", "customers"],
            selectedColumns: [
              "orders.customer_id",
              "orders.amount",
              "customers.id"
            ],
            dependencyClosure: {
              status: "ready",
              conflictSet: [],
              joinClosure: ["relationship-orders-customers"],
              metricDependencies: [],
              calculatedDependencies: [],
              filterDependencies: [],
              timeDependencies: [],
              mandatoryEvidenceRefs: ["relationship-orders-customers"],
              optionalEvidenceRefs: [],
              reasonCodes: []
            }
          },
          typedSummary: contextPackSummary,
          evidenceRefs: ["relationship-orders-customers"]
        })
    };
    const readyPlan = {
      route: "answer" as const,
      standaloneQuestion: "统计每个客户的订单金额",
      selectedTables: ["orders", "customers"],
      selectedColumns: ["orders.customer_id", "orders.amount", "customers.id"],
      confidence: 0.9,
      evidenceRefs: ["relationship-orders-customers"],
      filters: ["route_kind:text_to_sql"],
      joinPath: ["orders->customers"],
      snapshotId: "semantic-plan-replanned"
    };
    const semanticPlanNode = {
      run: jest
        .fn()
        .mockReturnValueOnce({
          route: "needs_clarification",
          plan: {
            ...readyPlan,
            route: "clarify",
            joinPath: [],
            snapshotId: "semantic-plan-missing-join",
            planLedger: {
              summary: {
                reasonCodes: ["missing_join_path"],
                failedHardBlockerIds: ["ledger:join-path:orders-customers"]
              }
            }
          },
          validation: {
            valid: false,
            reasons: ["missing_join_path"],
            routeKind: "text_to_sql",
            outcome: "needs_clarification"
          }
        })
        .mockReturnValueOnce({
          route: "ready",
          plan: readyPlan,
          validation: {
            valid: true,
            reasons: [],
            routeKind: "text_to_sql",
            outcome: "ready"
          }
        })
    };
    const graph = createText2SqlV2LangGraph({
      intakeNode: intakeNode as never,
      retrieveContextNode: retrieveContextNode as never,
      assembleContextNode: assembleContextNode as never,
      semanticPlanNode: semanticPlanNode as never,
      generateSqlNode: {
        run: jest.fn().mockResolvedValue({
          draft: {
            sql: "SELECT customers.id, SUM(orders.amount) FROM orders JOIN customers ON orders.customer_id = customers.id GROUP BY customers.id",
            provider: "mock",
            model: "mock",
            explanation: "grounded join",
            rawText: "sql",
            prompt: { systemPrompt: "system", userPrompt: "user" }
          },
          artifact: {
            sql: "SELECT 1",
            assumptions: [],
            usedTables: ["orders", "customers"],
            usedColumns: ["orders.customer_id", "customers.id", "orders.amount"],
            evidenceRefs: ["relationship-orders-customers"],
            cause: "initial",
            dialect: "sqlite"
          }
        })
      } as never,
      validateSqlNode: {
        run: jest.fn().mockResolvedValue({
          outcome: "pass",
          artifact: { status: "passed", checks: [], correctable: false }
        })
      } as never,
      correctSqlNode: { run: jest.fn() } as never,
      executeSqlNode: {
        run: jest.fn().mockResolvedValue({
          rows: [{ customer_id: 1, amount: 20 }],
          columns: ["customer_id", "amount"],
          rowCount: 1,
          emptyResult: false
        })
      } as never,
      answerNode: {
        run: jest.fn().mockReturnValue({
          mode: "execution_result",
          answer: "客户 1 的订单金额为 20",
          status: "executionResult",
          evidenceRefs: ["relationship-orders-customers"],
          warnings: []
        })
      } as never,
      resolveSqlTools: jest.fn().mockReturnValue({})
    });

    const finalState = await graph.invoke(
      createText2SqlV2LangGraphInitialState({
        preparedRun: {
          runId: "run-targeted-replan",
          requestId: "req-targeted-replan",
          question: "统计每个客户的订单金额",
          session: {
            id: "session-targeted-replan",
            datasource: "sqlite_main",
            modelProvider: "mock",
            modelName: "mock"
          },
          datasource: { id: "sqlite_main", type: "sqlite" },
          userPersistResult: { primaryPersisted: true }
        } as never,
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      })
    );

    expect(retrieveContextNode.run).toHaveBeenCalledTimes(2);
    expect(retrieveContextNode.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        question: expect.stringContaining("targeted_dependency_closure")
      })
    );
    expect(semanticPlanNode.run).toHaveBeenCalledTimes(2);
    expect(finalState.loopEvidence).toEqual([
      expect.objectContaining({
        loopIndex: 1,
        actionType: "replan",
        triggerReason: expect.stringContaining("missing_join_path"),
        convergencePath: expect.arrayContaining(["semantic-plan:replan"])
      })
    ]);
    expect(finalState.answerResult?.status).toBe("executionResult");
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
    const artifact = new Text2SqlV2LangGraphResultMapper(
      new Text2SqlV2ArtifactBuilder()
    ).mapRunArtifact(finalState as never);
    for (const stage of ["generate-sql", "validate", "correct", "execute"] as const) {
      expect(artifact.runtimePlan?.items.find((item) => item.stage === stage)).toMatchObject({
        status: "skipped",
        reasonCodes: expect.arrayContaining(["metadata_no_sql"])
      });
    }
  });

  it("applies a bounded patch and revalidates without a second generation call", async () => {
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
        outcome: "retry_validation",
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
          patchedSql: "SELECT orders.id FROM orders",
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

    expect(generateSqlNode.run).toHaveBeenCalledTimes(1);
    expect(validateSqlNode.run).toHaveBeenCalledTimes(2);
    expect(validateSqlNode.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sqlArtifact: expect.objectContaining({
          sql: "SELECT orders.id FROM orders",
          correctionGrounding: expect.objectContaining({
            failedSqlRef: "sql.sha256.abc123abc123abcd",
            attemptCount: 1,
            maxAttempts: 2,
            failureCode: "SQL_MISSING_COLUMN"
          })
        })
      })
    );
    expect(finalState.answerResult?.status).toBe("executionResult");
    expect(
      finalState.runtimePlan?.items.find((item) => item.stage === "correct")
    ).toMatchObject({
      status: "completed",
      correctionIntent: {
        failedStage: "validate",
        failureCode: "SQL_MISSING_COLUMN",
        retryReason: "missing column orders.missing_city",
        targetStage: "validate"
      }
    });
  });
});
