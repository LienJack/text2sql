import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";

describe("datasource visibility api (e2e)", () => {
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

  it("returns only workspace-bound datasources for scoped actor", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-visible-only",
      name: "仅可见数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-hidden-only",
      name: "不可见数据源",
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
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin")
      .send({ name: "可见性测试空间" });
    const workspaceId = workspaceRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/members`)
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin")
      .send({
        userId: "workspace-member-visible",
        role: "member"
      });

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-visible-only"]
      });

    const listPermissionsRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-visible-only/table-permissions`
      )
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin");
    expect(listPermissionsRes.status).toBe(200);
    const currentPolicyVersionRaw = listPermissionsRes.body.data.policyVersion;
    const currentPolicyVersion = Number(
      typeof currentPolicyVersionRaw === "string"
        ? currentPolicyVersionRaw
        : currentPolicyVersionRaw ?? 0
    );

    const replacePermissionsRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-visible-only/table-permissions`
      )
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "idem-ds-visible-only")
      .send({
        policyVersion: Number.isFinite(currentPolicyVersion)
          ? currentPolicyVersion
          : 0,
        tableNames: ["orders"]
      });
    expect(replacePermissionsRes.status).toBe(200);

    const retiredRuleGroupRouteRes = await request(app.getHttpServer())
      .post("/api/v1/system/rule-groups")
      .set("x-user-id", "admin-ds-visible")
      .set("x-user-role", "admin")
      .send({
        workspaceId,
        name: "legacy-route-should-be-retired"
      });
    expect(retiredRuleGroupRouteRes.status).toBe(404);

    const scopedListRes = await request(app.getHttpServer())
      .get(`/api/v1/datasources?workspaceId=${workspaceId}`)
      .set("x-user-id", "workspace-member-visible")
      .set("x-user-role", "user")
      .set("x-workspace-id", workspaceId);

    expect(scopedListRes.status).toBe(200);
    expect(scopedListRes.body.status).toBe("success");
    const ids = scopedListRes.body.data.map((item: { id: string }) => item.id) as string[];
    expect(ids).toContain("ds-visible-only");
    expect(ids).not.toContain("ds-hidden-only");
  });
});
