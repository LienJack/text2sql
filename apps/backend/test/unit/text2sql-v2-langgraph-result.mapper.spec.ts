import { DomainError } from "../../src/common/domain-error";
import type {
  ExecutionTraceStep,
  SqlRun,
  Text2SqlV2StageArtifact
} from "@text2sql/shared-types";
import { Text2SqlV2ArtifactBuilder } from "../../src/modules/conversation/artifacts/text2sql-v2-artifact-builder";
import { Text2SqlV2LangGraphResultMapper } from "../../src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph-result.mapper";
import {
  createText2SqlV2LangGraphInitialState,
  type Text2SqlV2LangGraphNodeName
} from "../../src/modules/conversation/runtime/langgraph/text2sql-v2-langgraph.state";
import type { AnswerNodeResult } from "../../src/modules/conversation/nodes/answer.node";

const createPreparedRunContext = () =>
  ({
    runId: "run-v2-langgraph",
    requestId: "req-v2-langgraph",
    question: "统计订单总数",
    session: {
      id: "session-v2-langgraph",
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
  }) as never;

describe("Text2SqlV2LangGraphResultMapper", () => {
  const mapper = new Text2SqlV2LangGraphResultMapper(
    new Text2SqlV2ArtifactBuilder()
  );

  it("maps graph state into canonical v2 artifact with graph-artifact-first semantics", () => {
    const state = {
      ...createText2SqlV2LangGraphInitialState({
        preparedRun: createPreparedRunContext(),
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      }),
      stageProgress: [
        "intake",
        "retrieve",
        "assemble-context",
        "semantic-plan",
        "generate-sql",
        "validate",
        "execute",
        "answer"
      ] as Text2SqlV2LangGraphNodeName[],
      stageArtifacts: [
        { stage: "intake", status: "success" },
        { stage: "retrieve", status: "success" },
        { stage: "assemble-context", status: "success" },
        { stage: "semantic-plan", status: "success" },
        { stage: "generate-sql", status: "success" },
        { stage: "validate", status: "success" },
        { stage: "execute", status: "success" },
        { stage: "answer", status: "success" }
      ] as Text2SqlV2StageArtifact[],
      traceSteps: [
        {
          node: "intake",
          status: "success",
          at: "2026-04-27T00:00:00.000Z"
        },
        {
          node: "answer",
          status: "success",
          at: "2026-04-27T00:00:01.000Z"
        }
      ] as ExecutionTraceStep[],
      contextPack: {
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
        filters: ["route_kind:text_to_sql"],
        snapshotId: "semantic-plan-v1",
        planLedger: {
          version: "plan-ledger.v1",
          snapshotId: "semantic-plan-v1",
          obligations: [
            {
              id: "ledger:table:orders",
              kind: "table",
              summary: "orders table",
              criticality: "hard_blocker",
              status: "fulfilled",
              evidenceRefs: ["chunk-orders-1"],
              reasonCodes: ["selected_table_grounded"],
              subject: "orders"
            }
          ],
          summary: {
            snapshotId: "semantic-plan-v1",
            total: 1,
            hardBlockerCount: 1,
            warningCount: 0,
            fulfilledCount: 1,
            failedCount: 0,
            failedHardBlockerIds: []
          }
        }
      },
      sqlGenerationArtifact: {
        sql: "SELECT COUNT(*) AS total FROM orders",
        assumptions: ["count orders"],
        usedTables: ["orders"],
        usedColumns: ["orders.id"],
        evidenceRefs: ["chunk-orders-1"],
        cause: "initial",
        dialect: "sqlite"
      },
      sqlValidationArtifact: {
        status: "passed",
        checks: [],
        correctable: false,
        ledgerFulfillment: {
          snapshotId: "semantic-plan-v1",
          total: 1,
          hardBlockerCount: 1,
          warningCount: 0,
          fulfilledCount: 1,
          failedCount: 0,
          failedHardBlockerIds: []
        }
      },
      executionResult: {
        rows: [{ total: 10 }],
        columns: ["total"],
        rowCount: 1,
        emptyResult: false
      },
      answerResult: {
        mode: "execution_result",
        answer: "订单总数为 10",
        status: "executionResult",
        evidenceRefs: ["chunk-orders-1"],
        warnings: []
      } as AnswerNodeResult
    };

    const mapped = mapper.mapSqlRun(state as never);

    expect(mapped.status).toBe("executionResult");
    expect(mapped.answer).toBe("订单总数为 10");
    expect(mapped.trace.v2?.version).toBe("v2");
    expect(mapped.trace.v2?.stageOrder).toEqual([
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
    expect(mapped.trace.v2?.stages.find((item) => item.stage === "correct")?.status).toBe(
      "skipped"
    );
    expect(
      mapped.trace.v2?.runtimePlan?.items.find((item) => item.stage === "generate-sql")
    ).toMatchObject({
      id: "runtime-plan:generate-sql",
      stage: "generate-sql",
      status: "completed"
    });
    expect(
      mapped.trace.v2?.runtimePlan?.items.find((item) => item.stage === "correct")
    ).toMatchObject({
      id: "runtime-plan:correct",
      stage: "correct",
      status: "skipped",
      reasonCodes: ["validation_passed"]
    });
    expect(mapped.trace.v2?.planLedger).toMatchObject({
      snapshotId: "semantic-plan-v1",
      total: 1,
      hardBlockerCount: 1,
      warningCount: 0,
      fulfilledCount: 1,
      failedCount: 0
    });
  });

  it("preserves valid runtime intelligence fields and ignores malformed optional fields", () => {
    const builder = new Text2SqlV2ArtifactBuilder();
    const baseRun = {
      runId: "run-runtime-intelligence",
      sessionId: "session-runtime-intelligence",
      question: "统计订单总数",
      status: "executionResult",
      provider: "volcengine",
      sql: "SELECT COUNT(*) AS total FROM orders",
      answer: "订单总数为 10",
      trace: {
        runId: "run-runtime-intelligence",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
        v2: {
          version: "v2",
          stageOrder: [],
          stages: [
            {
              stage: "intake",
              status: "success"
            }
          ],
          runtimePlan: {
            version: "runtime-plan.v1",
            items: [
              {
                id: "plan:intake",
                stage: "intake",
                goal: "Classify request intent.",
                status: "completed",
                reasonCodes: ["intake_ready_for_text_to_sql"]
              }
            ]
          },
          artifactRefs: [
            {
              id: "artifact:context:orders",
              category: "context_snippets",
              summary: "Compacted order context.",
              hash: "sha256:orders",
              visibility: "user",
              sensitivity: "none"
            },
            {
              id: "artifact:bad",
              category: "context_snippets",
              summary: "missing hash",
              visibility: "user"
            }
          ],
          smartDefaults: {
            bundleId: "text2sql-smart-defaults",
            version: "2026-04-28",
            coveredStages: ["generate-sql", "answer"],
            ruleIds: ["only-use-context-pack"],
            status: "applied"
          }
        }
      },
      llmRaw: null,
      createdAt: "2026-04-28T00:00:00.000Z"
    } as unknown as SqlRun;

    const artifact = builder.buildRunArtifact(baseRun);

    expect(artifact.runtimePlan?.items).toEqual([
      {
        id: "plan:intake",
        stage: "intake",
        goal: "Classify request intent.",
        status: "completed",
        reasonCodes: ["intake_ready_for_text_to_sql"]
      }
    ]);
    expect(artifact.artifactRefs).toEqual([
      {
        id: "artifact:context:orders",
        category: "context_snippets",
        summary: "Compacted order context.",
        hash: "sha256:orders",
        visibility: "user",
        sensitivity: "none"
      }
    ]);
    expect(artifact.smartDefaults?.bundleId).toBe("text2sql-smart-defaults");

    const oldRunArtifact = builder.buildRunArtifact({
      ...baseRun,
      trace: {
        ...baseRun.trace,
        v2: {
          version: "v2",
          stageOrder: [],
          stages: [
            {
              stage: "intake",
              status: "success"
            }
          ]
        }
      }
    });
    expect(oldRunArtifact.runtimePlan).toBeUndefined();
    expect(oldRunArtifact.artifactRefs).toBeUndefined();
    expect(oldRunArtifact.smartDefaults).toBeUndefined();
  });

  it("returns stream-safe progress summary without exposing raw graph state", () => {
    const state = {
      ...createText2SqlV2LangGraphInitialState({
        preparedRun: createPreparedRunContext(),
        route: "/api/v1/sessions/:sessionId/messages/stream",
        streamMode: true
      }),
      stageProgress: [
        "intake",
        "retrieve",
        "assemble-context",
        "answer"
      ] as Text2SqlV2LangGraphNodeName[],
      stageArtifacts: [],
      traceSteps: [],
      answerResult: {
        mode: "direct_answer",
        answer: "不需要执行 SQL，直接解释。",
        status: "executionResult",
        evidenceRefs: [],
        warnings: []
      } as AnswerNodeResult
    };

    const summary = mapper.mapProgressSummary(state as never);

    expect(summary.enteredStageCount).toBe(4);
    expect(summary.enteredStages).toEqual([
      "intake",
      "retrieve",
      "assemble-context",
      "answer"
    ]);
  });

  it("throws domain error when graph result has no answer or terminal failure", () => {
    const state = {
      ...createText2SqlV2LangGraphInitialState({
        preparedRun: createPreparedRunContext(),
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      }),
      stageProgress: ["intake"] as Text2SqlV2LangGraphNodeName[],
      stageArtifacts: [],
      traceSteps: [],
      answerResult: undefined,
      failure: undefined
    };

    expect(() => mapper.mapSqlRun(state as never)).toThrow(DomainError);
    expect(() => mapper.mapSqlRun(state as never)).toThrow(
      "LangGraph runtime completed without answer or terminal failure"
    );
  });
});
