import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { SemanticAssetReindexService } from "../../src/modules/knowledge/rag/retrieval/semantic-asset-reindex.service";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function withActor(
  req: request.Test,
  role: "admin" | "user",
  userId: string
): request.Test {
  return req.set("x-user-role", role).set("x-user-id", userId);
}

describe("settings rag readiness integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("settings-rag-readiness");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.EMBEDDING_MOCK_MODE = "true";
    process.env.RERANK_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.use(requestActorMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("returns stable reasonCode/details when dimensions mismatch", async () => {
    const upsertEmbedding = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/embedding"),
      "admin",
      "admin-rag-readiness"
    ).send({
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "embedding-health-key",
      enabled: true,
      dimensions: 1536,
      vectorVersion: "v2"
    });
    expect(upsertEmbedding.status).toBe(200);

    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/embedding/health"),
      "admin",
      "admin-rag-readiness"
    ).send({
      expectedDimensions: 1024
    });

    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.status).toBe("failed");
    expect(healthRes.body.data.reasonCode).toBe("dimension_mismatch");
    expect(healthRes.body.data.details.expectedDimensions).toBe(1024);
    expect(healthRes.body.data.details.actualDimensions).toBeGreaterThan(0);
  });

  it("exposes active embedding/rerank provider summary in /health", async () => {
    const upsertRerank = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/rerank"),
      "admin",
      "admin-rag-readiness"
    ).send({
      provider: "siliconflow",
      model: "BAAI/bge-reranker-v2-m3",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "rerank-health-key",
      enabled: true,
      timeoutMs: 8000
    });
    expect(upsertRerank.status).toBe(200);

    const healthRes = await request(app.getHttpServer()).get("/health");

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.dependencies.ragConfig.embedding.provider).toBe("openai");
    expect(healthRes.body.data.dependencies.ragConfig.rerank.provider).toBe(
      "siliconflow"
    );
  });

  it("exposes semantic asset readiness summary in /health after reindex", async () => {
    const reindex = app.get(SemanticAssetReindexService, { strict: false });
    const result = await reindex.reindex({
      datasourceId: "ds-rag-readiness-semantic-assets",
      workspaceId: "ws-rag-readiness",
      triggers: ["schema"],
      reason: "health_readiness",
      runId: "run-rag-readiness-semantic-assets",
      sourceSnapshots: [
        {
          family: "table_description",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.description" },
          sourceVersion: "schema-health-v1",
          sourceHash: "hash-schema-health-v1",
          tableName: "orders",
          content: "Orders table stores paid and pending order facts."
        }
      ]
    });

    const healthRes = await request(app.getHttpServer()).get("/health");

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.data.dependencies.ragConfig.semanticAssetReadiness).toMatchObject({
      status: "ready",
      datasourceId: "ds-rag-readiness-semantic-assets",
      activeManifestFingerprint: result.semanticAssetVersion,
      activeIndexVersionId: result.indexVersionId,
      familyCounts: {
        table_description: 1
      },
      staleReasons: []
    });
    expect(
      healthRes.body.data.dependencies.ragConfig.semanticAssetReadiness.embeddingProfile
        .model
    ).toBeTruthy();
  });
});
