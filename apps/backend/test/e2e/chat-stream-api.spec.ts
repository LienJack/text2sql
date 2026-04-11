import { resolve } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";

describe("chat stream api (e2e)", () => {
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

  it("should stream chat events via sse endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({});
    const sessionId = sessionRes.body.data.id as string;

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({ message: "统计订单状态分布" });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");
    expect(streamRes.text).toContain("event: start");
    expect(streamRes.text).toContain("event: text-delta");
    expect(streamRes.text).toContain("event: finish");

    const messagesRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data.latestRun).toBeTruthy();
  });
});
