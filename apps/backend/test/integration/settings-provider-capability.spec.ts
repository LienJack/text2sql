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

describe("settings provider capability integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("settings-provider-capability");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4.1-mini";
    process.env.LLM_MOCK_MODE = "true";

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

  it("exposes provider capability metadata and allows provider create/read lifecycle", async () => {
    const supportedRes = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/providers/supported"),
      "admin",
      "admin-settings-provider"
    );
    expect(supportedRes.status).toBe(200);
    expect(supportedRes.body.status).toBe("success");
    expect(Array.isArray(supportedRes.body.data)).toBe(true);
    expect(
      supportedRes.body.data.some(
        (item: {
          provider: string;
          displayName: string;
          defaultBaseUrl: string;
          supportsModelListing: boolean;
        }) =>
          item.provider === "openai" &&
          item.displayName.length > 0 &&
          item.defaultBaseUrl.length > 0 &&
          typeof item.supportsModelListing === "boolean"
      )
    ).toBe(true);

    const createRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/providers"),
      "admin",
      "admin-settings-provider"
    ).send({
      provider: "openai",
      displayName: "unit1-openai-provider",
      baseUrl: "https://api.openai.com/v1",
      enabled: true
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("success");
    expect(createRes.body.data.provider).toBe("openai");
    expect(createRes.body.data.displayName).toBe("unit1-openai-provider");
    const providerConfigId = createRes.body.data.id as string;

    const viewRes = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/models"),
      "admin",
      "admin-settings-provider"
    );
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.status).toBe("success");
    expect(
      viewRes.body.data.providers.some(
        (provider: { id: string; provider: string; displayName: string }) =>
          provider.id === providerConfigId &&
          provider.provider === "openai" &&
          provider.displayName === "unit1-openai-provider"
      )
    ).toBe(true);
    expect(Array.isArray(viewRes.body.data.models)).toBe(true);
  });

  it("returns degraded health with stable reason when provider api key is missing", async () => {
    const createRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/providers"),
      "admin",
      "admin-settings-provider"
    ).send({
      provider: "openai",
      displayName: "unit1-health-openai-provider",
      baseUrl: "https://api.openai.com/v1",
      enabled: true
    });
    expect(createRes.status).toBe(201);
    const providerConfigId = createRes.body.data.id as string;

    const healthRes = await withActor(
      request(app.getHttpServer()).post(
        `/api/v1/settings/providers/${providerConfigId}/health`
      ),
      "admin",
      "admin-settings-provider"
    );
    expect(healthRes.status).toBe(201);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.status).toBe("degraded");
    expect(typeof healthRes.body.data.message).toBe("string");
    expect(healthRes.body.data.message).toContain("配置不完整");
  });

  it("rejects user-role provider write operation", async () => {
    const deniedRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/providers"),
      "user",
      "user-settings-provider"
    ).send({
      provider: "openai",
      displayName: "forbidden-provider"
    });
    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.statusCode).toBe(403);
    expect(deniedRes.body.message).toContain("仅管理员可执行该操作");
  });
});
