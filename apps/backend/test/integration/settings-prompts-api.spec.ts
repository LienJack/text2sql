import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function withActor(req: request.Test, role: "admin" | "user", userId: string): request.Test {
  return req.set("x-user-role", role).set("x-user-id", userId);
}

describe("settings prompts api integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("settings-prompts-api");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
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

  it("supports admin CRUD with envelope and soft-delete semantics", async () => {
    const createRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/prompts"),
      "admin",
      "admin-prompts"
    ).send({
      name: "default sql analyst",
      scene: "sql",
      content: "你是 SQL 助手，请保持只读 SQL。",
      scope: "global",
      scopeKey: "global"
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("success");
    expect(createRes.body.requestId).toBeDefined();
    expect(createRes.body.data.template.name).toBe("default sql analyst");
    const templateId = createRes.body.data.template.id as string;

    const listRes = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/prompts"),
      "user",
      "user-prompts"
    ).query({
      scene: "sql",
      scope: "global"
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(
      listRes.body.data.items.some((item: { id: string }) => item.id === templateId)
    ).toBe(true);

    const updateRes = await withActor(
      request(app.getHttpServer()).patch(`/api/v1/settings/prompts/${templateId}`),
      "admin",
      "admin-prompts"
    ).send({
      content: "你是 SQL 助手，必须遵守只读语句并返回 explain。",
      status: "draft"
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("success");
    expect(updateRes.body.data.template.status).toBe("draft");
    expect(updateRes.body.data.template.content).toContain("explain");

    const deleteRes = await withActor(
      request(app.getHttpServer()).delete(`/api/v1/settings/prompts/${templateId}`),
      "admin",
      "admin-prompts"
    );
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe("success");
    expect(deleteRes.body.data.deleted).toBe(true);

    const defaultListAfterDelete = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/prompts"),
      "user",
      "user-prompts"
    ).query({
      scene: "sql",
      scope: "global"
    });
    expect(defaultListAfterDelete.status).toBe(200);
    expect(defaultListAfterDelete.body.status).toBe("success");
    expect(
      defaultListAfterDelete.body.data.items.some(
        (item: { id: string }) => item.id === templateId
      )
    ).toBe(false);

    const includeDeletedList = await withActor(
      request(app.getHttpServer()).get("/api/v1/settings/prompts"),
      "user",
      "user-prompts"
    ).query({
      scene: "sql",
      scope: "global",
      includeDeleted: "true"
    });
    expect(includeDeletedList.status).toBe(200);
    expect(includeDeletedList.body.status).toBe("success");
    const deletedItem = includeDeletedList.body.data.items.find(
      (item: { id: string }) => item.id === templateId
    );
    expect(deletedItem).toBeDefined();
    expect(deletedItem.deletedAt).toBeTruthy();
  });

  it("returns 403 for non-admin write operations", async () => {
    const deniedRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/prompts"),
      "user",
      "user-prompts"
    ).send({
      name: "forbidden write",
      scene: "sql",
      content: "test",
      scope: "global"
    });

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.statusCode).toBe(403);
    expect(deniedRes.body.message).toContain("仅管理员可执行该操作");
  });

  it("returns 404 envelope when updating a non-existent template", async () => {
    const updateRes = await withActor(
      request(app.getHttpServer()).patch("/api/v1/settings/prompts/prompt-missing"),
      "admin",
      "admin-prompts"
    ).send({
      content: "missing template should return 404"
    });

    expect(updateRes.status).toBe(404);
    expect(updateRes.body.status).toBe("error");
    expect(updateRes.body.error.code).toBe("PROMPT_TEMPLATE_NOT_FOUND");
  });

  it("returns 409 envelope for duplicate template in same scene and scope", async () => {
    const payload = {
      name: "duplicate-key",
      scene: "sql",
      content: "duplicate test",
      scope: "global",
      scopeKey: "global"
    };

    const firstCreate = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/prompts"),
      "admin",
      "admin-prompts"
    ).send(payload);
    expect(firstCreate.status).toBe(201);

    const conflictCreate = await withActor(
      request(app.getHttpServer()).post("/api/v1/settings/prompts"),
      "admin",
      "admin-prompts"
    ).send(payload);

    expect(conflictCreate.status).toBe(409);
    expect(conflictCreate.body.status).toBe("error");
    expect(conflictCreate.body.error.code).toBe("PROMPT_TEMPLATE_CONFLICT");
  });
});
