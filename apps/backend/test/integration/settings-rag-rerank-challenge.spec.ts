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

describe("settings rag rerank challenge integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("settings-rag-rerank-challenge");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.RERANK_MOCK_MODE = "true";
    process.env.EMBEDDING_MOCK_MODE = "true";

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

  it("returns sample_not_ready challenge when sample candidates are insufficient", async () => {
    const rerankRes = await withActor(
      request(app.getHttpServer()).put("/api/v1/settings/rag-configs/rerank"),
      "admin",
      "admin-rag-rerank-challenge"
    ).send({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "rerank-health-key",
      enabled: true
    });
    expect(rerankRes.status).toBe(200);

    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/rerank/health"),
      "admin",
      "admin-rag-rerank-challenge"
    ).send({
      sampleQuery: "revenue by status",
      sampleCandidates: ["orders by status"]
    });
    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.reasonCode).toBe("sample_not_ready");
    expect(healthRes.body.data.challenge.status).toBe("sample_not_ready");
  });

  it("returns comparable challenge summary when samples are present", async () => {
    const healthRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/rag-configs/rerank/health"),
      "admin",
      "admin-rag-rerank-challenge"
    ).send({
      sampleQuery: "revenue by status",
      sampleCandidates: ["orders amount by status", "users profile", "finance cube"]
    });
    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.reasonCode).toBe("ok");
    expect(healthRes.body.data.challenge.status).toBe("comparable");
    expect(typeof healthRes.body.data.challenge.delta).toBe("number");
  });
});
