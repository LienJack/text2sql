import {
  createInitialLangGraphState,
  normalizeTraceContext
} from "../../src/modules/conversation/agent/graph/langgraph.state";
import { createLangGraphRuntime } from "../../src/modules/conversation/agent/graph/langgraph.runtime";

const createMockIntentPlan = () => ({
  status: "ready" as const,
  intent: "aggregate" as const,
  constraints: [],
  summary: "stub",
  uncertaintySignal: {
    level: "low" as const,
    needsStrictSemanticPath: false,
    reasonCodes: ["rule_slots_sufficient"]
  },
  clarificationDecision: {
    decision: "continue" as const,
    triggerPath: "rule" as const,
    confidenceLevel: "high" as const,
    missingCriticalSlots: [],
    conflictDetected: false,
    reasonCodes: ["rule_slots_sufficient"],
    question: "",
    reason: "问题信息充足"
  },
  riskTags: [],
  planningWarnings: []
});

const createMockSemanticPlan = () => ({
  status: "ready" as const,
  semanticHints: [],
  semanticVersion: 1,
  lockStatus: "locked" as const,
  fallbackApplied: false,
  riskTags: [],
  intentRiskTags: [],
  semanticRiskTags: [],
  planningWarnings: {
    intent: [],
    semantic: []
  },
  strictMode: false,
  strictModeReasons: [],
  summary: "stub"
});

describe("langgraph runtime", () => {
  it("passes contextEnvelope into clarify node", async () => {
    const clarifyRun = jest.fn().mockReturnValue({
      decision: "clarify",
      action: "ask_clarification",
      source: "rule",
      decisionSource: "rule",
      triggerPath: "rule",
      bypassed: false,
      confidence: "low",
      confidenceLevel: "low",
      missingSlots: ["metric"],
      shouldClarify: true,
      missingCriticalSlots: ["metric"],
      reasonCodes: ["missing_metric_slot"],
      reason: "need clarification",
      question: "请补充指标口径"
    });
    const runtime = createLangGraphRuntime({
      clarifyNode: {
        evaluate: clarifyRun
      },
      retrieveKnowledgeNode: {
        run: async () => ({
          status: "ready",
          snippets: ["stub"],
          summary: "stub"
        })
      },
      buildIntentPlanNode: {
        run: async () => createMockIntentPlan()
      },
      buildSemanticQueryNode: {
        run: async () => createMockSemanticPlan()
      },
      buildPhysicalPlanNode: {
        run: async () => ({
          status: "ready",
          strategy: "direct_sql",
          semanticConstraintMode: "structured" as const,
          semanticVersion: 1,
          lockStatus: "locked" as const,
          fallbackApplied: false,
          cacheStatus: "miss" as const,
          summary: "stub"
        })
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
        run: async () => ({
          allowed: true,
          mode: "pass" as const,
          riskLevel: "low" as const,
          riskTags: []
        })
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

    const contextEnvelope = {
      metricDefinition: "订单总数"
    };
    const state = createInitialLangGraphState({
      runId: "run-with-envelope",
      sessionId: "session-1",
      question: "这个趋势怎么样",
      datasourceId: "ds-1",
      contextEnvelope
    });
    const output = await runtime.invoke(state);

    expect(clarifyRun).toHaveBeenCalledWith("这个趋势怎么样", contextEnvelope);
    expect(output.terminalStatus).toBe("clarification");
    expect(output.trace.clarificationDecision?.decision).toBe("clarify");
  });

  it("should run through executionResult path with expected node steps", async () => {
    const runtime = createLangGraphRuntime({
      clarifyNode: {
        evaluate: () => ({
          decision: "continue",
          action: "proceed",
          source: "rule",
          decisionSource: "rule",
          triggerPath: "rule",
          bypassed: false,
          confidence: "high",
          confidenceLevel: "high",
          missingSlots: [],
          shouldClarify: false,
          missingCriticalSlots: [],
          reasonCodes: ["rule_slots_sufficient"],
          reason: "问题信息充足",
          question: ""
        })
      },
      retrieveKnowledgeNode: {
        run: async () => ({
          status: "ready",
          snippets: ["stub"],
          summary: "stub"
        })
      },
      buildIntentPlanNode: {
        run: async () => createMockIntentPlan()
      },
      buildSemanticQueryNode: {
        run: async () => createMockSemanticPlan()
      },
      buildPhysicalPlanNode: {
        run: async () => ({
          status: "ready",
          strategy: "direct_sql",
          semanticConstraintMode: "structured" as const,
          semanticVersion: 1,
          lockStatus: "locked" as const,
          fallbackApplied: false,
          cacheStatus: "miss" as const,
          summary: "stub"
        })
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
        run: async () => ({
          allowed: true,
          mode: "pass" as const,
          riskLevel: "low" as const,
          riskTags: []
        })
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
      question: "统计订单总数",
      datasourceId: "ds-1"
    });
    const output = await runtime.invoke(state);

    expect(output.terminalStatus).toBe("executionResult");
    expect(output.provider).toBe("mock-provider");
    expect(output.llmRaw?.model).toBe("mock-model");
    expect(output.answer).toBe("formatted");
    expect(output.trace.steps.map((step) => step.node)).toEqual([
      "clarify",
      "retrieve-knowledge",
      "build-intent-plan",
      "build-semantic-query",
      "build-physical-plan",
      "generate-sql",
      "safety-check",
      "execute-sql",
      "format-answer"
    ]);
    expect(output.trace.steps[0]?.sequence).toBe(1);
    expect(output.trace.steps[0]?.stepId).toBe("run-1:clarify:1");
    expect(output.trace.steps[0]?.lifecycle).toBe("skipped");
    expect(output.trace.steps[5]?.sequence).toBe(6);
    expect(output.trace.steps[5]?.lifecycle).toBe("completed");
    expect(output.trace.clarificationDecision?.decision).toBe("continue");
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
        evaluate: () => ({
          decision: "continue",
          action: "proceed",
          source: "rule",
          decisionSource: "rule",
          triggerPath: "rule",
          bypassed: false,
          confidence: "high",
          confidenceLevel: "high",
          missingSlots: [],
          shouldClarify: false,
          missingCriticalSlots: [],
          reasonCodes: ["rule_slots_sufficient"],
          reason: "问题信息充足",
          question: ""
        })
      },
      retrieveKnowledgeNode: {
        run: async () => ({
          status: "ready",
          snippets: ["stub"],
          summary: "stub"
        })
      },
      buildIntentPlanNode: {
        run: async () => createMockIntentPlan()
      },
      buildSemanticQueryNode: {
        run: async () => createMockSemanticPlan()
      },
      buildPhysicalPlanNode: {
        run: async () => ({
          status: "ready",
          strategy: "direct_sql",
          semanticConstraintMode: "structured" as const,
          semanticVersion: 1,
          lockStatus: "locked" as const,
          fallbackApplied: false,
          cacheStatus: "miss" as const,
          summary: "stub"
        })
      },
      generateSqlNode: {
        run: async () => {
          throw new Error("llm failed");
        }
      },
      safetyNode: {
        run: async () => ({
          allowed: true,
          mode: "pass" as const,
          riskLevel: "low" as const,
          riskTags: []
        })
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
      question: "统计异常",
      datasourceId: "ds-2"
    });
    const output = await runtime.invoke(state);

    expect(output.terminalStatus).toBe("failed");
    expect(output.error).toBe("llm failed");
    expect(output.fatalError).toBeInstanceOf(Error);
    expect(output.trace.steps.map((step) => step.node)).toEqual([
      "clarify",
      "retrieve-knowledge",
      "build-intent-plan",
      "build-semantic-query",
      "build-physical-plan",
      "generate-sql"
    ]);
    expect(output.trace.steps[5]?.status).toBe("failed");
    expect(output.trace.steps[5]?.sequence).toBe(6);
    expect(output.trace.steps[5]?.stepId).toBe("run-2:generate-sql:6");
    expect(output.trace.steps[5]?.lifecycle).toBe("failed");
    expect(output.trace.steps[5]?.errorSummary).toContain("llm failed");
  });
});
