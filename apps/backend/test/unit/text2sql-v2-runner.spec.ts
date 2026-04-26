import { Text2SqlV2RunnerService } from "../../src/modules/conversation/agent/v2/text2sql-v2-runner.service";
import { Text2SqlV2StateMachine } from "../../src/modules/conversation/agent/v2/text2sql-v2-state-machine";

describe("Text2SqlV2RunnerService", () => {
  it("attaches fixed v2 stage order artifact to trace", async () => {
    const service = new Text2SqlV2RunnerService(
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
          reasonCodes: []
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
        run: jest.fn(async () => ({
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
            selectedEvidenceIds: [],
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"]
          },
          semanticPlan: {
            route: "answer",
            standaloneQuestion: "统计订单总数",
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"],
            confidence: 0.9,
            evidenceRefs: []
          }
        }))
      } as never,
      {
        run: jest.fn(async () => ({
          allowed: true,
          mode: "pass",
          riskLevel: "low",
          riskTags: []
        }))
      } as never,
      {
        run: jest.fn(async () => ({
          rows: [{ total: 10 }],
          columns: ["total"]
        }))
      } as never,
      {
        run: jest.fn(() => "订单总数为 10")
      } as never,
      {
        decide: jest.fn(() => ({
          correctable: false,
          reason: "none",
          maxAttempts: 2
        }))
      } as never,
      {
        getToolsForDatasource: jest.fn(() => ({}))
      } as never,
      {
        startRoot: jest.fn(() => ({})),
        recordSpan: jest.fn(),
        endRoot: jest.fn()
      } as never,
      new Text2SqlV2StateMachine()
    );

    const run = await service.runSync(
      {
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
      } as never,
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
  });
});
