import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("workspace datasource api (e2e)", () => {
  let app: INestApplication;
  let datasourceRepository: DatasourceRepository;

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
    datasourceRepository = app.get(DatasourceRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  it("supports workspace table-permissions list/replace with optimistic concurrency and idempotency", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-workspace-permission-1",
      name: "空间权限测试库",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });

    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .send({ name: "空间-表权限替换测试" });
    expect(workspaceRes.status).toBe(201);
    const workspaceId = workspaceRes.body.data.id as string;

    const addBindingRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-workspace-permission-1"]
      });
    expect(addBindingRes.status).toBe(201);

    const initialListRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin");
    expect(initialListRes.status).toBe(200);
    expect(initialListRes.body.data.policyVersion).toBe(0);
    expect(initialListRes.body.data.tableNames).toEqual([]);

    const replaceRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "ws-perm-replace-1")
      .send({
        policyVersion: 0,
        tableNames: ["orders", "users"]
      });
    expect(replaceRes.status).toBe(200);
    expect(replaceRes.body.data.policyVersion).toBe(1);
    expect(replaceRes.body.data.tableNames).toEqual(["orders", "users"]);
    expect(replaceRes.body.data.impactSummary).toMatchObject({
      beforeCount: 0,
      afterCount: 2,
      addedCount: 2,
      removedCount: 0
    });
    expect(replaceRes.body.data.replayed).toBe(false);

    const replayRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "ws-perm-replace-1")
      .send({
        policyVersion: 0,
        tableNames: ["orders", "users"]
      });
    expect(replayRes.status).toBe(200);
    expect(replayRes.body.data.replayed).toBe(true);
    expect(replayRes.body.data.policyVersion).toBe(1);

    const staleVersionRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "ws-perm-replace-2")
      .send({
        policyVersion: 0,
        tableNames: ["orders"]
      });
    expect(staleVersionRes.status).toBe(200);
    expect(staleVersionRes.body.status).toBe("error");
    expect(staleVersionRes.body.error.code).toBe("POLICY_VERSION_CONFLICT");

    const listRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin");
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.policyVersion).toBe(1);
    expect(listRes.body.data.tableNames).toEqual(["orders", "users"]);

    const retiredRouteRes = await request(app.getHttpServer())
      .post(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-acl/replace`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .send({
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        tableNames: ["orders"]
      });
    expect(retiredRouteRes.status).toBe(404);

    const legacyPayloadRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-permission-1/table-permissions`
      )
      .set("x-user-id", "admin-workspace-permission")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "ws-perm-replace-legacy-payload")
      .send({
        version: 1,
        tables: ["orders"]
      });
    expect(legacyPayloadRes.status).toBe(400);
  });
});
