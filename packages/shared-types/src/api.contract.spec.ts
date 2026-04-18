import type { AgentRunResponse, ChatStreamEvent, DeliveryContract, SqlRun } from "./api";

type Expect<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

const deliverySample: DeliveryContract = {
  answer: {
    text: "ok",
    status: "executionResult",
    provider: "openai",
    model: "gpt-5.4"
  },
  evidence: {
    runId: "run_123",
    retrievalStatus: "ready",
    selectedContext: {
      count: 1,
      snippets: ["users table schema"]
    },
    retrievalLogs: [
      {
        replayKey: "retrieval:selected_context",
        stage: "retrieval",
        indexVersionId: "idx_v1",
        createdAt: "2026-04-18T00:00:00.000Z"
      }
    ],
    riskTags: []
  },
  artifact: {
    sql: "select 1",
    columns: ["value"],
    rowCount: 1,
    rowsPreview: [{ value: 1 }],
    hasError: false
  }
};

const sqlRunSample: SqlRun = {
  runId: "run_123",
  sessionId: "session_123",
  question: "hello",
  status: "executionResult",
  provider: "openai",
  sql: "select 1",
  answer: "ok",
  rows: [{ value: 1 }],
  columns: ["value"],
  trace: {
    runId: "run_123",
    provider: "openai",
    retryCount: 0,
    steps: []
  },
  delivery: deliverySample,
  createdAt: "2026-04-18T00:00:00.000Z"
};

const agentRunResponseSample: AgentRunResponse = {
  kind: "agent-run",
  outcome: "executionResult",
  run: sqlRunSample,
  delivery: deliverySample,
  agent: {
    provider: "openai",
    model: "gpt-5.4",
    hasSql: true,
    hasToolCalls: false,
    hasError: false
  }
};

const finishEventWithDelivery: ChatStreamEvent = {
  type: "finish",
  runId: "run_123",
  sessionId: "session_123",
  at: "2026-04-18T00:00:00.000Z",
  data: {
    status: "executionResult",
    rowCount: 1,
    delivery: deliverySample
  }
};

const finishEventWithoutDelivery: ChatStreamEvent = {
  type: "finish",
  runId: "run_123",
  sessionId: "session_123",
  at: "2026-04-18T00:00:00.000Z",
  data: {
    status: "failed",
    rowCount: 0
  }
};

type DeliveryOnRunIsCompatible = Expect<IsAssignable<DeliveryContract | undefined, SqlRun["delivery"]>>;
type DeliveryOnAgentResponseIsCompatible = Expect<
  IsAssignable<DeliveryContract | undefined, AgentRunResponse["delivery"]>
>;

void agentRunResponseSample;
void finishEventWithDelivery;
void finishEventWithoutDelivery;
