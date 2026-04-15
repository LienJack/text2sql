import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { ExecuteSqlNode } from "../../src/modules/agent/nodes/execute-sql.node";
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

  it("persists governance audit events for binding and table acl updates", async () => {
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

    const aclRes = await request(app.getHttpServer())
      .post(
        `/api/v1/system/workspaces/${workspaceId}/datasources/sqlite_main/table-acl/replace`
      )
      .set("x-user-id", "admin-audit-ops")
      .set("x-user-role", "admin")
      .send({
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        tableNames: ["orders"]
      });
    expect(aclRes.status).toBe(201);
    expect(aclRes.body.status).toBe("success");

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

    const aclEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.acl.updated",
      limit: 20
    });
    expect(
      aclEvents.some(
        (event) =>
          event.eventCode === "ACL_REPLACE_BATCH" &&
          event.metadata?.workspaceId === workspaceId
      )
    ).toBe(true);
  });

  it("records acl denied audit event before rejecting unauthorized table read", async () => {
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
        accessContext: {
          actorId: "workspace-member-audit",
          workspaceId,
          roleSet: ["member"]
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_FORBIDDEN"
    });

    const deniedEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.acl.denied",
      limit: 20
    });
    expect(
      deniedEvents.some(
        (event) =>
          event.eventCode === "ACL_FORBIDDEN" &&
          event.metadata?.workspaceId === workspaceId &&
          event.metadata?.datasourceId === "sqlite_main"
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

  it("keeps workflow state idempotent across repeated binding and acl replace submissions", async () => {
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

    for (let index = 0; index < 2; index += 1) {
      const bindRes = await request(app.getHttpServer())
        .post(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings/add`)
        .set("x-user-id", "admin-audit-idempotent")
        .set("x-user-role", "admin")
        .send({
          datasourceIds: ["ds-audit-workflow-idempotent"]
        });
      expect(bindRes.status).toBe(201);
      expect(bindRes.body.status).toBe("success");
      expect(bindRes.body.data.failedItems).toEqual([]);
    }

    for (let index = 0; index < 2; index += 1) {
      const aclRes = await request(app.getHttpServer())
        .post(
          `/api/v1/system/workspaces/${workspaceId}/datasources/ds-audit-workflow-idempotent/table-acl/replace`
        )
        .set("x-user-id", "admin-audit-idempotent")
        .set("x-user-role", "admin")
        .send({
          subjectType: "role",
          subjectId: "member",
          effect: "allow",
          tableNames: ["orders", "users"]
        });
      expect(aclRes.status).toBe(201);
      expect(aclRes.body.status).toBe("success");
    }

    const listBindingsRes = await request(app.getHttpServer())
      .get(`/api/v1/system/workspaces/${workspaceId}/datasources/bindings`)
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin");
    expect(listBindingsRes.status).toBe(200);
    expect(
      listBindingsRes.body.data.items.filter(
        (item: { datasourceId: string }) =>
          item.datasourceId === "ds-audit-workflow-idempotent"
      )
    ).toHaveLength(1);

    const listAclRes = await request(app.getHttpServer())
      .get(
        `/api/v1/system/workspaces/${workspaceId}/datasources/ds-audit-workflow-idempotent/table-acl`
      )
      .set("x-user-id", "admin-audit-idempotent")
      .set("x-user-role", "admin");
    expect(listAclRes.status).toBe(200);
    expect(listAclRes.body.status).toBe("success");
    const aclTableNames = listAclRes.body.data.items.map(
      (item: { tableName: string }) => item.tableName
    ) as string[];
    expect(aclTableNames.sort()).toEqual(["orders", "users"]);

    const bindingEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.binding.updated",
      limit: 100
    });
    const currentWorkspaceBindingEvents = bindingEvents.filter(
      (event) =>
        event.eventCode === "BINDING_ADD_BATCH" &&
        event.metadata?.workspaceId === workspaceId
    );
    expect(currentWorkspaceBindingEvents).toHaveLength(2);

    const aclEvents = await auditLogRepository.listEvents({
      eventType: "workspace.datasource.acl.updated",
      limit: 100
    });
    const currentWorkspaceAclEvents = aclEvents.filter(
      (event) =>
        event.eventCode === "ACL_REPLACE_BATCH" &&
        event.metadata?.workspaceId === workspaceId &&
        event.metadata?.datasourceId === "ds-audit-workflow-idempotent"
    );
    expect(currentWorkspaceAclEvents).toHaveLength(2);
  });
});
