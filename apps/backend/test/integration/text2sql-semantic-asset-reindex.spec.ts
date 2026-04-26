import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import {
  SemanticAssetReindexService,
  type SemanticAssetReindexTrigger
} from "../../src/modules/knowledge/rag/retrieval/semantic-asset-reindex.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("text2sql semantic asset reindex integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.NODE_ENV = "test";
    process.env.LLM_MOCK_MODE = "true";
    process.env.EMBEDDING_MOCK_MODE = "true";
    process.env.EMBEDDING_PROVIDER = "volcengine";
    process.env.EMBEDDING_MODEL = "embedding-v2";
    process.env.EMBEDDING_VECTOR_VERSION = "v3";
  });

  it("reindexes semantic assets with trigger-mapped source version", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);
    const repository = moduleRef.get(RagIndexRepository);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-semantic-asset-reindex-orders",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      }
    ]);

    const triggers: SemanticAssetReindexTrigger[] = ["schema", "embedding_model", "examples"];
    const result = await service.reindex({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-reindex",
      triggers,
      reason: "unit2_contract_refresh",
      runId: "run-semantic-asset-reindex-v1"
    });

    expect(result.status).toBe("reindexed");
    expect(result.indexVersionId).toBeDefined();
    expect(result.semanticAssetVersion).toContain("semantic-assets-");
    expect(result.sourceVersion).toContain("embedding_model");
    expect(result.embeddingProfile.provider).toBe("volcengine");
    expect(result.embeddingProfile.model).toBe("embedding-v2");
    expect(result.embeddingProfile.vectorVersion).toBe("v3");
    expect(result.triggerSummary.schema).toBe(true);
    expect(result.triggerSummary.embedding_model).toBe(true);
    expect(result.triggerSummary.examples).toBe(true);

    await moduleRef.close();
  });

  it("skips reindex when the same source version is already active", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);
    const repository = moduleRef.get(RagIndexRepository);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-semantic-asset-reindex-orders-2",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      }
    ]);

    const request = {
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-reindex",
      triggers: ["schema", "embedding_model"] as SemanticAssetReindexTrigger[],
      reason: "unit2_contract_refresh",
      runId: "run-semantic-asset-reindex-v2"
    };

    const first = await service.reindex(request);
    const second = await service.reindex(request);

    expect(first.status).toBe("reindexed");
    expect(second.status).toBe("skipped");
    expect(second.reasonCodes).toContain("skip:already_active");

    await moduleRef.close();
  });
});
