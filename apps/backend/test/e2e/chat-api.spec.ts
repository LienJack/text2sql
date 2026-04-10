import { resolve } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";

describe("chat api (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should create session and send one message", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({});
    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.status).toBe("success");
    const sessionId = sessionRes.body.data.id;

    const runRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({ message: "统计订单状态分布" });
    expect(runRes.status).toBe(201);
    expect(runRes.body.status).toBe("success");
    expect(runRes.body.data.run.runId).toBeDefined();
    expect(runRes.body.data.run.sql).toMatch(/select/i);
    expect(runRes.body.data.run.explanation).toBeTruthy();
  });

  it("should expose configured cors origins in health response", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.cors.allowedOrigins).toContain("http://localhost:3001");
  });
});
