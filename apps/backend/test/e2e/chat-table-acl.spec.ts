import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("chat table acl / policy guard (e2e)", () => {
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
    app.use(requestIdMiddleware);
    app.use(requestActorMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks message sending when workspace binding is removed after session creation", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .send({ name: "会话只读策略空间" });
    const workspaceId = workspaceRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/members`)
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .send({
        userId: "chat-member-acl",
        role: "member"
      });

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["sqlite_main"]
      });

    const listPermissionsRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-permissions`
      )
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin");
    expect(listPermissionsRes.status).toBe(200);
    const policyVersion = Number(listPermissionsRes.body.data.policyVersion ?? 0);

    const replacePermissionsRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-permissions`
      )
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "idem-chat-table-acl")
      .send({
        policyVersion: Number.isFinite(policyVersion) ? policyVersion : 0,
        tableNames: ["users"]
      });
    expect(replacePermissionsRes.status).toBe(200);

    const retiredRuleGroupRouteRes = await request(app.getHttpServer())
      .post("/api/v1/system/rule-groups")
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .send({
        workspaceId,
        name: "legacy-chat-group"
      });
    expect(retiredRuleGroupRouteRes.status).toBe(404);

    const createSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .set("x-user-id", "chat-member-acl")
      .set("x-user-role", "user")
      .set("x-workspace-id", workspaceId)
      .send({
        datasource: "sqlite_main",
        workspaceId
      });
    expect(createSessionRes.body.status).toBe("success");
    const sessionId = createSessionRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/remove`)
      .set("x-user-id", "admin-chat-acl")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["sqlite_main"]
      });

    const sendRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .set("x-user-id", "chat-member-acl")
      .set("x-user-role", "user")
      .set("x-workspace-id", workspaceId)
      .send({ message: "查询订单总数" });

    expect(sendRes.status).toBe(409);
    expect(sendRes.body.status).toBe("error");
    expect(sendRes.body.error.code).toBe("SESSION_READONLY_BY_POLICY");
  });
});
