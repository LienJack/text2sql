import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/conversation/agent/graph/graph.builder";

describe("agent main flow", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
  });

  it("should return execution result for clear question", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);
    const run = await graph.run({
      runId: "run-1",
      sessionId: "session-1",
      question: "统计商家交易额",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite"
    });
    expect(["executionResult", "failed"]).toContain(run.status);
    expect(run.trace.steps.length).toBeGreaterThan(0);
    expect(run.llmRaw?.rawText).toBeTruthy();
    expect(run.trace.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.trace.steps[0]?.sequence).toBe(1);
    expect(run.trace.steps[0]?.stepId).toContain("run-1:");
    expect(run.trace.steps[0]?.lifecycle).toBeTruthy();
    expect(run.trace.clarificationDecision).toBeDefined();
    expect(["continue", "clarify"]).toContain(run.trace.clarificationDecision?.decision);
  });

  it("should reject non-readonly sql intent", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);
    const run = await graph.run({
      runId: "run-2",
      sessionId: "session-2",
      question: "DELETE orders where id = 1",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite"
    });
    expect(run.status).toBe("rejected");
    expect(run.trace.clarificationDecision?.decisionSource).toBe("sql-write-intent");
    expect(run.trace.clarificationDecision?.bypassed).toBe(true);
  });
});
