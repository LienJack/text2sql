import { resolve } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";

describe("settings api (e2e)", () => {
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
    app.use(requestActorMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should reject provider write for non-admin", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/settings/providers")
      .send({
        provider: "openai",
        displayName: "OpenAI Main",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test"
      });

    expect(res.status).toBe(403);
  });

  it("should allow admin to create provider and read settings view", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/settings/providers")
      .set("x-user-role", "admin")
      .set("x-user-id", "admin-e2e")
      .send({
        provider: "openai",
        displayName: "OpenAI Main",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-1234"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("success");
    expect(createRes.body.data.provider).toBe("openai");
    expect(createRes.body.data.hasApiKey).toBe(true);
    expect(createRes.body.data.apiKeyMasked).toContain("***");

    const viewRes = await request(app.getHttpServer())
      .get("/api/v1/settings/models")
      .set("x-user-role", "admin")
      .set("x-user-id", "admin-e2e")
      .send();

    expect(viewRes.status).toBe(200);
    expect(viewRes.body.status).toBe("success");
    expect(viewRes.body.data.actor.role).toBe("admin");
    expect(
      viewRes.body.data.providers.some(
        (item: { provider: string }) => item.provider === "openai"
      )
    ).toBe(true);
  });

  it("should allow non-admin to read settings view but deny provider write", async () => {
    const viewRes = await request(app.getHttpServer())
      .get("/api/v1/settings/models")
      .set("x-user-role", "user")
      .set("x-user-id", "user-e2e")
      .send();

    expect(viewRes.status).toBe(200);
    expect(viewRes.body.status).toBe("success");
    expect(viewRes.body.data.actor.role).toBe("user");

    const writeRes = await request(app.getHttpServer())
      .post("/api/v1/settings/providers")
      .set("x-user-role", "user")
      .set("x-user-id", "user-e2e")
      .send({
        provider: "openai",
        displayName: "OpenAI Denied",
        baseUrl: "https://api.openai.com/v1"
      });

    expect(writeRes.status).toBe(403);
    expect(
      (writeRes.body.error?.message as string | undefined) ??
        (writeRes.body.message as string | undefined)
    ).toContain("仅管理员可执行该操作");
  });
});
