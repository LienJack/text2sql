import type { SqlRun } from "@text2sql/shared-types";
import { DomainError } from "../../src/common/domain-error";
import { Text2SqlV2ArtifactBuilder } from "../../src/modules/conversation/agent/v2/text2sql-v2-artifact-builder";
import { Text2SqlV2LangGraphResultMapper } from "../../src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph-result.mapper";
import {
  createText2SqlV2LangGraphInitialState,
  type Text2SqlV2LangGraphNodeName
} from "../../src/modules/conversation/agent/v2/langgraph/text2sql-v2-langgraph.state";

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

const createRun = (patch?: Partial<SqlRun>): SqlRun => ({
  runId: "run-v2-langgraph",
  sessionId: "session-v2-langgraph",
  question: "统计订单总数",
  status: "executionResult",
  provider: "volcengine",
  model: "mock-model",
  sql: "select count(*) as total from orders",
  answer: "订单总数为 10",
  rows: [{ total: 10 }],
  columns: ["total"],
  trace: {
    runId: "run-v2-langgraph",
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
        { stage: "retrieve", status: "success" },
        { stage: "assemble-context", status: "success" },
        { stage: "semantic-plan", status: "success" },
        { stage: "generate-sql", status: "success" },
        { stage: "validate", status: "success" },
        { stage: "correct", status: "skipped" },
        { stage: "execute", status: "success" },
        { stage: "answer", status: "success" }
      ]
    }
  },
  llmRaw: null,
  createdAt: "2026-04-27T00:00:00.000Z",
  ...patch
});

describe("Text2SqlV2LangGraphResultMapper", () => {
  const mapper = new Text2SqlV2LangGraphResultMapper(
    new Text2SqlV2ArtifactBuilder()
  );

  it("maps legacy runtime run into canonical v2 artifact", () => {
    const state = {
      ...createText2SqlV2LangGraphInitialState({
        preparedRun: createPreparedRunContext(),
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      }),
      stageProgress: [
        "intake",
        "retrieve",
        "answer"
      ] satisfies Text2SqlV2LangGraphNodeName[],
      legacyRun: createRun()
    };

    const mapped = mapper.mapSqlRun(state);

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
    expect(mapped.trace.v2?.stages).toHaveLength(9);
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
      ] satisfies Text2SqlV2LangGraphNodeName[],
      legacyRun: createRun()
    };

    const summary = mapper.mapProgressSummary(state);

    expect(summary.enteredStageCount).toBe(4);
    expect(summary.enteredStages).toEqual([
      "intake",
      "retrieve",
      "assemble-context",
      "answer"
    ]);
  });

  it("throws domain error when graph result has no mapped run", () => {
    const state = {
      ...createText2SqlV2LangGraphInitialState({
        preparedRun: createPreparedRunContext(),
        route: "/api/v1/sessions/:sessionId/messages",
        streamMode: false
      }),
      stageProgress: ["intake"] satisfies Text2SqlV2LangGraphNodeName[],
      legacyRun: undefined
    };

    expect(() => mapper.mapSqlRun(state)).toThrow(DomainError);
    expect(() => mapper.mapSqlRun(state)).toThrow(
      "LangGraph runtime completed without a mapped SqlRun"
    );
  });
});
