import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RetrieveKnowledgeNode } from "../../src/modules/conversation/agent/nodes/retrieve-knowledge.node";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("agent context pack integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("returns context_pack through retrieve-knowledge node and keeps summary aligned", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrieveKnowledgeNode = moduleRef.get(RetrieveKnowledgeNode);

    const datasourceId = "ds-agent-context-pack";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-context-pack-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-context-pack-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV maps to order amount aggregation."
      },
      {
        id: "chunk-context-pack-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'"
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-agent-context-pack-v1",
      createdByRunId: "run-agent-context-pack-build-v1",
      activatedByRunId: "run-agent-context-pack-build-v1"
    });

    const retrieved = await retrieveKnowledgeNode.run({
      question: "统计 GMV",
      datasourceId,
      runId: "run-agent-context-pack-v1"
    });

    expect(retrieved.retrievalBundle).toBeDefined();
    expect(retrieved.contextPack).toBeDefined();
    expect(retrieved.contextPack?.status).toBe(retrieved.retrievalBundle?.status);
    expect(retrieved.contextPack?.selected_context_summary.count).toBe(
      retrieved.retrievalBundle?.selected_context?.length ?? 0
    );
    expect(retrieved.contextPack?.semantic_lock_status).toBeDefined();

    await moduleRef.close();
  });
});
