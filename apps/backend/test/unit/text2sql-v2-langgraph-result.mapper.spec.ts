import { DomainError } from "../../src/common/domain-error";
import type {
  ExecutionTraceStep,
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
        filters: ["route_kind:text_to_sql"]
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
        correctable: false
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
