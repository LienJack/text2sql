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
});
