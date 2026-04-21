import type { ChatMessage, DeliveryContract, SqlRun } from "@text2sql/shared-types";

export function createMockRun(partial?: Partial<SqlRun>): SqlRun {
  return {
    runId: "run-1",
    sessionId: "session-1",
    question: "近30天支付方式分布",
    status: "executionResult",
    provider: "mock",
    sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
    explanation: "统计近 30 天支付方式分布。",
    llmRaw: {
      provider: "mock",
      model: "mock-model",
      rawText:
        "```sql\nSELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method\n```",
      createdAt: "2026-04-10T00:00:00.000Z"
    },
    rows: [{ payment_method: "card", cnt: 12 }],
    columns: ["payment_method", "cnt"],
    trace: {
      runId: "run-1",
      provider: "mock",
      retryCount: 0,
      steps: [
        {
          node: "generate-sql",
          status: "success",
          at: "2026-04-10T00:00:00.000Z",
          durationMs: 18,
          inputSummary: "question=近30天支付方式分布",
          outputSummary: "sql=SELECT payment_method..."
        }
      ]
    },
    createdAt: "2026-04-10T00:00:00.000Z",
    ...partial
  };
}

export type RagSelectedContextState = "happy" | "nil" | "empty" | "error";

export function createMockRagDelivery(
  state: RagSelectedContextState,
  options?: {
    runId?: string;
    answerText?: string;
    artifact?: DeliveryContract["artifact"];
    evidencePatch?: Partial<NonNullable<DeliveryContract["evidence"]>>;
  }
): DeliveryContract {
  const runId = options?.runId ?? "run-1";
  const answerText = options?.answerText ?? "已为你生成 SQL，并展示结果。";
  const baseEvidence: NonNullable<DeliveryContract["evidence"]> = {
    runId
  };

  if (state === "happy") {
    baseEvidence.retrievalStatus = "ready";
    baseEvidence.selectedContext = {
      count: 2,
      snippets: ["schema.orders", "few-shot.payment_method"]
    };
  }

  if (state === "empty") {
    baseEvidence.retrievalStatus = "ready";
    baseEvidence.selectedContext = {
      count: 0
    };
  }

  if (state === "error") {
    baseEvidence.retrievalStatus = "degraded";
    baseEvidence.degradeReasons = ["retrieval_timeout"];
    baseEvidence.riskTags = ["semantic_registry_degraded"];
  }

  const evidence = {
    ...baseEvidence,
    ...(options?.evidencePatch ?? {})
  };

  const delivery: DeliveryContract = {
    answer: {
      text: answerText,
      status: "executionResult",
      provider: "mock-provider"
    },
    ...(state === "nil" ? {} : { evidence }),
    ...(options?.artifact ? { artifact: options.artifact } : {})
  };

  return delivery;
}

export function createMockRunWithRagState(
  state: RagSelectedContextState,
  partial?: Partial<SqlRun>
): SqlRun {
  return createMockRun({
    delivery: createMockRagDelivery(state),
    ...partial
  });
}

export function createMockMessages(partial?: Partial<ChatMessage>[]): ChatMessage[] {
  const defaults: ChatMessage[] = [
    {
      id: "msg-1",
      sessionId: "session-1",
      role: "user",
      content: "近30天支付方式分布",
      createdAt: "2026-04-10T00:00:00.000Z"
    },
    {
      id: "msg-2",
      sessionId: "session-1",
      role: "assistant",
      content: "已为你生成 SQL，并展示结果。",
      metadata: {
        runId: "run-1",
        status: "executionResult"
      },
      createdAt: "2026-04-10T00:00:01.000Z"
    }
  ];

  if (!partial) {
    return defaults;
  }

  return defaults.map((message, index) => ({ ...message, ...(partial[index] ?? {}) }));
}
