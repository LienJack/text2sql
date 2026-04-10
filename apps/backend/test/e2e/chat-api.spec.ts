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
    expect(runRes.body.data.run.llmRaw).toBeTruthy();
    expect(runRes.body.data.run.llmRaw.provider).toBe("volcengine");
    expect(runRes.body.data.run.llmRaw.model).toBeTruthy();

    const messageViewRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messageViewRes.status).toBe(200);
    expect(messageViewRes.body.status).toBe("success");
    expect(messageViewRes.body.data.session.id).toBe(sessionId);
    expect(Array.isArray(messageViewRes.body.data.messages)).toBe(true);
    expect(messageViewRes.body.data.latestRun.runId).toBe(runRes.body.data.run.runId);
  });

  it("should list, rename and soft-delete sessions", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({});
    const sessionId = sessionRes.body.data.id as string;

    const listBefore = await request(app.getHttpServer())
      .get("/api/v1/sessions")
      .send();
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.status).toBe("success");
    expect(
      listBefore.body.data.some((item: { id: string }) => item.id === sessionId)
    ).toBe(true);

    const renameRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ title: "会话重命名测试" });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.status).toBe("success");
    expect(renameRes.body.data.title).toBe("会话重命名测试");

    const invalidRenameRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ title: "   " });
    expect(invalidRenameRes.status).toBe(200);
    expect(invalidRenameRes.body.status).toBe("error");
    expect(invalidRenameRes.body.error.code).toBe("VALIDATION_ERROR");

    const debugRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ debugEnabled: true });
    expect(debugRes.status).toBe(200);
    expect(debugRes.body.status).toBe("success");
    expect(debugRes.body.data.debugEnabled).toBe(true);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/sessions/${sessionId}`)
      .send();
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe("success");
    expect(deleteRes.body.data.deleted).toBe(true);

    const listAfter = await request(app.getHttpServer())
      .get("/api/v1/sessions")
      .send();
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.status).toBe("success");
    expect(
      listAfter.body.data.some((item: { id: string }) => item.id === sessionId)
    ).toBe(false);
  });

  it("should expose configured cors origins in health response", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.cors.allowedOrigins).toContain("http://localhost:3001");
    expect(res.body.data.dependencies.sessions.sync.total).toBeGreaterThanOrEqual(0);
  });
});
