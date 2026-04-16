import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";

describe("workspace datasource authz (e2e)", () => {
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

  it("enforces workspace-admin scope for workspace datasource operations", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-workspace-authz-1",
      name: "权限空间数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });

    const workspaceARes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-ds-authz")
      .set("x-user-role", "admin")
      .send({ name: "权限空间-A" });
    const workspaceBRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-ds-authz")
      .set("x-user-role", "admin")
      .send({ name: "权限空间-B" });

    const workspaceA = workspaceARes.body.data.id as string;
    const workspaceB = workspaceBRes.body.data.id as string;

    const grantWorkspaceAdminRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "admin-ds-authz")
      .set("x-user-role", "admin")
      .send({
        userId: "workspace-admin-only-a",
        role: "admin"
      });
    expect(grantWorkspaceAdminRes.body.status).toBe("success");

    const allowedRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/datasources/bindings/add`)
      .set("x-user-id", "workspace-admin-only-a")
      .set("x-user-role", "user")
      .send({
        datasourceIds: ["ds-workspace-authz-1"]
      });
    expect(allowedRes.status).toBe(201);
    expect(allowedRes.body.status).toBe("success");

    const deniedCrossWorkspaceRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceB}/datasources/bindings/add`)
      .set("x-user-id", "workspace-admin-only-a")
      .set("x-user-role", "user")
      .send({
        datasourceIds: ["ds-workspace-authz-1"]
      });
    expect(deniedCrossWorkspaceRes.status).toBe(403);
    expect(readErrorMessage(deniedCrossWorkspaceRes.body)).toContain(
      "仅系统管理员或工作空间管理员可执行该操作"
    );
  });
});

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  if (
    record.error &&
    typeof record.error === "object" &&
    "message" in record.error
  ) {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") {
      return nested.message;
    }
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return "";
}
