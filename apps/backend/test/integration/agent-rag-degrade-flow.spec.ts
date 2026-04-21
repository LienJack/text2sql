import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/conversation/agent/graph/graph.builder";

describe("agent rag degrade flow integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.AGENT_PLANNING_SCAFFOLD_ENABLED = "true";
  });

  it("keeps main flow available when retrieval degrades due to missing active index", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);

    const run = await graph.run({
      runId: "run-agent-rag-degrade-v1",
      sessionId: "session-agent-rag-degrade-v1",
      question: "按状态统计订单数量",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });

    const retrieveStep = run.trace.steps.find((step) => step.node === "retrieve-knowledge");
    expect(retrieveStep?.detail).toContain("降级");

    const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
    expect(generateStep?.inputSummary).toContain("retrievalStatus");
    expect(generateStep?.inputSummary).toContain("selectedContextCount");

    expect(["executionResult", "failed", "rejected"]).toContain(run.status);

    await moduleRef.close();
  });
});
