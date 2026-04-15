import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";

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

  it("supports datasource binding and table acl management", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-workspace-bind-1",
      name: "空间绑定测试库",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });

    const createWorkspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin")
      .send({
        name: "空间-数据源绑定测试"
      });
    expect(createWorkspaceRes.body.status).toBe("success");
    const workspaceId = createWorkspaceRes.body.data.id as string;

    const addBindingRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-workspace-bind-1"]
      });
    expect(addBindingRes.status).toBe(201);
    expect(addBindingRes.body.status).toBe("success");
    expect(addBindingRes.body.data.successItems).toEqual(["ds-workspace-bind-1"]);

    const listBindingsRes = await request(app.getHttpServer())
      .get(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings`)
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin");
    expect(listBindingsRes.status).toBe(200);
    expect(listBindingsRes.body.status).toBe("success");
    expect(
      listBindingsRes.body.data.items.some(
        (item: { datasourceId: string }) => item.datasourceId === "ds-workspace-bind-1"
      )
    ).toBe(true);

    const replaceAclRes = await request(app.getHttpServer())
      .post(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-bind-1/table-acl/replace`
      )
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin")
      .send({
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        tableNames: ["orders", "users"]
      });
    expect(replaceAclRes.status).toBe(201);
    expect(replaceAclRes.body.status).toBe("success");
    expect(replaceAclRes.body.data.addedTables).toEqual(["orders", "users"]);

    const listAclRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-bind-1/table-acl`
      )
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin");
    expect(listAclRes.status).toBe(200);
    expect(listAclRes.body.status).toBe("success");
    expect(listAclRes.body.data.items).toHaveLength(2);

    const listTablesRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-bind-1/tables`
      )
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin");
    expect(listTablesRes.status).toBe(200);
    expect(listTablesRes.body.status).toBe("success");
    expect(listTablesRes.body.data.items).toContain("orders");
    expect(listTablesRes.body.data.items).toContain("users");

    const removeAclRes = await request(app.getHttpServer())
      .post(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-workspace-bind-1/table-acl/remove`
      )
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin")
      .send({
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        tableNames: ["users"]
      });
    expect(removeAclRes.status).toBe(201);
    expect(removeAclRes.body.status).toBe("success");
    expect(removeAclRes.body.data.removedCount).toBe(1);

    const removeBindingRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/remove`)
      .set("x-user-id", "admin-workspace-binding")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-workspace-bind-1"]
      });
    expect(removeBindingRes.status).toBe(201);
    expect(removeBindingRes.body.status).toBe("success");
    expect(removeBindingRes.body.data.successItems).toEqual(["ds-workspace-bind-1"]);
  });
});
