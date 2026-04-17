import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/agent/graph/graph.builder";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("agent rag main flow integration", () => {
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

  it("runs retrieve -> rerank pipeline and passes selected_context to SQL generation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const graph = moduleRef.get(GraphBuilderService);
    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-agent-rag-schema",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-agent-rag-sql",
        datasourceId: "sqlite_main",
        domain: "sql_example",
        content: "SELECT status, SUM(amount) FROM orders GROUP BY status"
      },
      {
        id: "chunk-agent-rag-semantic",
        datasourceId: "sqlite_main",
        domain: "semantic_term",
        content: "GMV maps to total order amount."
      }
    ]);
    await builder.buildAndActivate({
      datasourceId: "sqlite_main",
      sourceVersion: "source-agent-rag-main-v1",
      createdByRunId: "run-agent-rag-main-build-v1",
      activatedByRunId: "run-agent-rag-main-build-v1"
    });

    const run = await graph.run({
      runId: "run-agent-rag-main-v1",
      sessionId: "session-agent-rag-main-v1",
      question: "统计订单 GMV",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });

    const stepNames = run.trace.steps.map((step) => step.node);
    expect(stepNames).toEqual(
      expect.arrayContaining([
        "retrieve-knowledge",
        "build-intent-plan",
        "build-semantic-query",
        "generate-sql",
        "safety-check"
      ])
    );

    const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
    expect(generateStep?.inputSummary).toContain("selectedContextCount");

    const safetyStep = run.trace.steps.find((step) => step.node === "safety-check");
    expect(safetyStep?.outputSummary).toContain("riskTags");

    await moduleRef.close();
  });
});
