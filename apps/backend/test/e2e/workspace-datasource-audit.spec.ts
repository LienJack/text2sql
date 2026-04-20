import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { ExecuteSqlNode } from "../../src/modules/conversation/agent/nodes/execute-sql.node";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("workspace datasource governance audit (e2e)", () => {
  let app: INestApplication;
  let auditLogRepository: AuditLogRepository;
  let executeSqlNode: ExecuteSqlNode;
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
    auditLogRepository = app.get(AuditLogRepository);
    executeSqlNode = app.get(ExecuteSqlNode);
    datasourceRepository = app.get(DatasourceRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  it("persists governance audit events for table-permissions replace", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-audit-ops")
      .set("x-user-role", "admin")
      .send({ name: "审计验证空间-治理写入" });
    expect(workspaceRes.body.status).toBe("success");
    const workspaceId = workspaceRes.body.data.id as string;

    const bindRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-audit-ops")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["sqlite_main"]
      });
    expect(bindRes.status).toBe(201);
    expect(bindRes.body.status).toBe("success");

    const initialListRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-permissions`
      )
      .set("x-user-id", "admin-audit-ops")
      .set("x-user-role", "admin");
    expect(initialListRes.status).toBe(200);

    const replaceRes = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-permissions`
      )
      .set("x-user-id", "admin-audit-ops")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "audit-table-permissions-1")
      .send({
        policyVersion: Number(initialListRes.body.data.policyVersion ?? 0),
        tableNames: ["orders"]
      });
    expect(replaceRes.status).toBe(200);

    const bindingEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.binding.updated",
      limit: 20
    });
    expect(
      bindingEvents.some(
        (event) =>
          event.eventCode === "BINDING_ADD_BATCH" &&
          event.metadata?.workspaceId === workspaceId
      )
    ).toBe(true);

    const permissionEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.table-permissions.updated",
      limit: 20
    });
    expect(
      permissionEvents.some(
        (event) =>
          event.metadata?.workspaceId === workspaceId &&
          event.metadata?.datasourceId === "sqlite_main"
      )
    ).toBe(true);
  });

  it("records security audit when workspace and datasource binding is forged", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-audit-forged-binding")
      .set("x-user-role", "admin")
      .send({ name: "审计验证空间-伪造绑定" });
    expect(workspaceRes.body.status).toBe("success");
    const workspaceId = workspaceRes.body.data.id as string;

    const forgedListRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-permissions`
      )
      .set("x-user-id", "admin-audit-forged-binding")
      .set("x-user-role", "admin");
    expect(forgedListRes.status).toBe(200);
    expect(forgedListRes.body.status).toBe("error");
    expect(forgedListRes.body.error.code).toBe("WORKSPACE_DATASOURCE_NOT_BOUND");

    const securityEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.binding.rejected",
      limit: 50
    });
    const event = securityEvents.find(
      (item) =>
        item.metadata?.workspaceId === workspaceId &&
        item.metadata?.datasourceId === "sqlite_main" &&
        item.metadata?.actorId === "admin-audit-forged-binding"
    );
    expect(event).toBeDefined();
    expect(event?.eventCode).toBe("WORKSPACE_DATASOURCE_NOT_BOUND");
    expect(event?.severity).toBe("warning");
  });

  it("records table-permissions denied audit event before rejecting unauthorized table read", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-audit-deny")
      .set("x-user-role", "admin")
      .send({ name: "审计验证空间-拒绝查询" });
    expect(workspaceRes.body.status).toBe("success");
    const workspaceId = workspaceRes.body.data.id as string;

    const bindRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-audit-deny")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["sqlite_main"]
      });
    expect(bindRes.status).toBe(201);
    expect(bindRes.body.status).toBe("success");

    await expect(
      executeSqlNode.run({
        sql: "SELECT * FROM users",
        datasourceId: "sqlite_main",
        sessionId: "session-audit-denied",
        requestId: "req-audit-denied-1",
        accessContext: {
          actorId: "workspace-member-audit",
          workspaceId,
          roleSet: ["member"]
        }
      })
    ).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_FORBIDDEN"
    });

    const deniedEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.table-permissions.denied",
      requestId: "req-audit-denied-1",
      limit: 20
    });
    expect(
      deniedEvents.some(
        (event) =>
          event.eventCode === "TABLE_PERMISSIONS_FORBIDDEN" &&
          event.metadata?.workspaceId === workspaceId &&
          event.metadata?.datasourceId === "sqlite_main" &&
          event.requestId === "req-audit-denied-1"
      )
    ).toBe(true);
  });

  it("records warning audit payload when binding batch contains invalid datasource", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-audit-binding-warning")
      .set("x-user-role", "admin")
      .send({ name: "审计验证空间-绑定失败阶段" });
    expect(workspaceRes.body.status).toBe("success");
    const workspaceId = workspaceRes.body.data.id as string;

    const bindRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-audit-binding-warning")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-not-exists-for-audit"]
      });
    expect(bindRes.status).toBe(201);
    expect(bindRes.body.status).toBe("success");
    expect(bindRes.body.data.successItems).toEqual([]);
    expect(bindRes.body.data.failedItems).toHaveLength(1);
    expect(bindRes.body.data.failedItems[0].code).toBe("DATASOURCE_NOT_FOUND");

    const bindingEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.binding.updated",
      limit: 100
    });
    const warningEvent = bindingEvents.find(
      (event) =>
        event.eventCode === "BINDING_ADD_BATCH" &&
        event.metadata?.workspaceId === workspaceId
    );
    expect(warningEvent).toBeDefined();
    expect(warningEvent?.severity).toBe("warning");
    expect(
      Array.isArray(warningEvent?.metadata?.failedItems) &&
        warningEvent?.metadata?.failedItems.length === 1
    ).toBe(true);
  });

  it("keeps table-permissions replace idempotent on key replay", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-audit-workflow-idempotent",
      name: "审计幂等验证库",
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
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin")
      .send({ name: "审计验证空间-幂等重试" });
    expect(workspaceRes.body.status).toBe("success");
    const workspaceId = workspaceRes.body.data.id as string;

    const bindRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin")
      .send({
        datasourceIds: ["ds-audit-workflow-idempotent"]
      });
    expect(bindRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-audit-workflow-idempotent/table-permissions`
      )
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin");
    expect(listRes.status).toBe(200);
    const version = Number(listRes.body.data.policyVersion ?? 0);

    const key = `table-permissions-idem-${Date.now()}`;
    const firstReplace = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-audit-workflow-idempotent/table-permissions`
      )
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", key)
      .send({
        policyVersion: version,
        tableNames: ["orders"]
      });
    expect(firstReplace.status).toBe(200);
    expect(firstReplace.body.data.replayed).toBe(false);

    const replayedReplace = await request(app.getHttpServer())
      .put(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-audit-workflow-idempotent/table-permissions`
      )
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", key)
      .send({
        policyVersion: version,
        tableNames: ["orders"]
      });
    expect(replayedReplace.status).toBe(200);
    expect(replayedReplace.body.data.replayed).toBe(true);
  });
});
