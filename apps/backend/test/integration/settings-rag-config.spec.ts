import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
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

describe("settings rag config integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("settings-rag-config");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.RERANK_MOCK_MODE = "false";
    process.env.EMBEDDING_MOCK_MODE = "false";
    process.env.EMBEDDING_BASE_URL = "";
    process.env.EMBEDDING_API_KEY = "";
    process.env.RERANK_BASE_URL = "";
    process.env.RERANK_API_KEY = "";

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

  it("returns degraded health when no settings config and no env fallback", async () => {
    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/embedding/health"),
      "admin",
      "admin-rag-health"
    ).send({});
    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.status).toBe("degraded");
    expect(healthRes.body.data.configSource).toBe("missing");
    expect(healthRes.body.data.checkedAgainst).toBe("persisted");
    expect(healthRes.body.data.reasonCode).toBe("provider_unavailable");
  });

  it("supports dry-check against draft config for embedding", async () => {
    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/embedding/health"),
      "admin",
      "admin-rag-draft-health"
    ).send({
      draft: {
        provider: "openai",
        model: "text-embedding-3-small",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-draft-embedding",
        enabled: true,
        dimensions: 1536,
        vectorVersion: "v1",
        timeoutMs: 5000
      },
      expectedDimensions: 1536
    });

    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.checkedAgainst).toBe("draft");
    expect(healthRes.body.data.reasonCode).toBe("ok");
  });

  it("returns schema_invalid when dry-check draft is incomplete", async () => {
    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/embedding/health"),
      "admin",
      "admin-rag-draft-invalid"
    ).send({
      draft: {
        provider: "openai",
        model: "",
        baseUrl: "https://api.openai.com/v1",
        enabled: true
      }
    });

    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.status).toBe("failed");
    expect(healthRes.body.data.reasonCode).toBe("schema_invalid");
    expect(healthRes.body.data.checkedAgainst).toBe("draft");
  });

  it("allows admin to upsert embedding/rerank configs and list task-separated records", async () => {
    const embeddingRes = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/embedding"),
      "admin",
      "admin-rag-config"
    ).send({
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "embedding-secret-key",
      enabled: true,
      dimensions: 1024,
      vectorVersion: "v2"
    });
    expect(embeddingRes.status).toBe(200);
    expect(embeddingRes.body.status).toBe("success");
    expect(embeddingRes.body.data.taskType).toBe("embedding");
    expect(embeddingRes.body.data.configSource).toBe("settings");

    const rerankRes = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/rerank"),
      "admin",
      "admin-rag-config"
    ).send({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "rerank-secret-key",
      enabled: true,
      timeoutMs: 5000
    });
    expect(rerankRes.status).toBe(200);
    expect(rerankRes.body.status).toBe("success");
    expect(rerankRes.body.data.taskType).toBe("rerank");
    expect(rerankRes.body.data.configSource).toBe("settings");

    const listRes = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/rag-configs"),
      "admin",
      "admin-rag-config"
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(Array.isArray(listRes.body.data.items)).toBe(true);
    expect(
      listRes.body.data.items.some(
        (item: { taskType: string; configSource: string; hasApiKey: boolean }) =>
          item.taskType === "embedding" &&
          item.configSource === "settings" &&
          item.hasApiKey === true
      )
    ).toBe(true);
    expect(
      listRes.body.data.items.some(
        (item: { taskType: string; configSource: string; hasApiKey: boolean }) =>
          item.taskType === "rerank" &&
          item.configSource === "settings" &&
          item.hasApiKey === true
      )
    ).toBe(true);
  });

  it("returns sample rerank payload from task-specific health check", async () => {
    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/rerank/health"),
      "admin",
      "admin-rag-health"
    ).send({
      sampleQuery: "revenue by status",
      sampleCandidates: ["orders amount by status", "users profile", "finance cube"]
    });
    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.status).toBe("healthy");
    expect(healthRes.body.data.configSource).toBe("settings");
    expect(Array.isArray(healthRes.body.data.sample?.reranked)).toBe(true);
  });

  it("rejects user-role write operations", async () => {
    const deniedRes = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/embedding"),
      "user",
      "user-rag-config"
    ).send({
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "forbidden"
    });
    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.statusCode).toBe(403);
    expect(deniedRes.body.message).toContain("仅管理员可执行该操作");
  });

  it("keeps /settings/models contract focused on provider/model governance", async () => {
    const viewRes = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/models"),
      "admin",
      "admin-rag-config"
    );
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.status).toBe("success");
    expect(Array.isArray(viewRes.body.data.providers)).toBe(true);
    expect(Array.isArray(viewRes.body.data.models)).toBe(true);
    expect(viewRes.body.data.items).toBeUndefined();
  });
});
