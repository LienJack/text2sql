import {
  createInitialLangGraphState,
  normalizeTraceContext
} from "../../src/modules/agent/graph/langgraph.state";
import { createLangGraphRuntime } from "../../src/modules/agent/graph/langgraph.runtime";

describe("langgraph runtime", () => {
  it("should run through executionResult path with expected node steps", async () => {
    const runtime = createLangGraphRuntime({
      clarifyNode: {
        run: () => undefined
      },
      generateSqlNode: {
        run: async () => ({
          provider: "mock-provider",
          model: "mock-model",
          sql: "SELECT 1 AS value",
          explanation: "mock explanation",
          rawText: "mock raw text",
          prompt: {
            systemPrompt: "sys",
            userPrompt: "usr"
          }
        })
      },
      safetyNode: {
        run: () => ({ safe: true as const })
      },
      executeNode: {
        run: async () => ({
          rows: [{ value: 1 }],
          columns: ["value"]
        })
      },
      formatNode: {
        run: () => "formatted"
      }
    });

    const state = createInitialLangGraphState({
      runId: "run-1",
      sessionId: "session-1",
      question: "统计订单总数"
    });
    const output = await runtime.invoke(state);

    expect(output.terminalStatus).toBe("executionResult");
    expect(output.provider).toBe("mock-provider");
    expect(output.llmRaw?.model).toBe("mock-model");
    expect(output.answer).toBe("formatted");
    expect(output.trace.steps.map((step) => step.node)).toEqual([
      "clarify",
      "generate-sql",
      "safety-check",
      "execute-sql",
      "format-answer"
    ]);
  });

  it("should normalize missing trace context", () => {
    expect(normalizeTraceContext(undefined)).toEqual({
      source: "chat",
      route: "unknown"
    });
  });

  it("should capture fatal llm error into state without throwing from runtime", async () => {
    const runtime = createLangGraphRuntime({
      clarifyNode: {
        run: () => undefined
      },
      generateSqlNode: {
        run: async () => {
          throw new Error("llm failed");
        }
      },
      safetyNode: {
        run: () => ({ safe: true as const })
      },
      executeNode: {
        run: async () => ({
          rows: [],
          columns: []
        })
      },
      formatNode: {
        run: () => "formatted"
      }
    });

    const state = createInitialLangGraphState({
      runId: "run-2",
      sessionId: "session-2",
      question: "统计异常"
    });
    const output = await runtime.invoke(state);

    expect(output.terminalStatus).toBe("failed");
    expect(output.error).toBe("llm failed");
    expect(output.fatalError).toBeInstanceOf(Error);
    expect(output.trace.steps.map((step) => step.node)).toEqual([
      "clarify",
      "generate-sql"
    ]);
    expect(output.trace.steps[1]?.status).toBe("failed");
    expect(output.trace.steps[1]?.errorSummary).toContain("llm failed");
  });
});
