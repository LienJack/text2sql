import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { DatasourceService } from "../../src/modules/governance/datasource/datasource.service";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { WorkspaceDatasourceService } from "../../src/modules/governance/workspace/workspace-datasource.service";

describe("datasource workflow api (e2e)", () => {
  let app: INestApplication;
  let datasourceRepository: DatasourceRepository;
  let datasourceService: DatasourceService;
  let workspaceDatasourceService: WorkspaceDatasourceService;
  let auditLogRepository: AuditLogRepository;

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
    datasourceService = app.get(DatasourceService);
    workspaceDatasourceService = app.get(WorkspaceDatasourceService);
    auditLogRepository = app.get(AuditLogRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects PATCH datasource type mutation and enforces type boundary", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-patch-boundary-1",
      name: "Patch 边界测试库",
      type: "mysql",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        host: "127.0.0.1",
        port: 3306,
        database: "analytics",
        username: "root",
        passwordCiphertext: "masked",
        passwordMasked: "ro***ot"
      }
    });

    const patchTypeRes = await request(app.getHttpServer())
      .patch("/api/v1/datasources/ds-patch-boundary-1")
      .set("x-user-id", "admin-ds-patch")
      .set("x-user-role", "admin")
      .send({
        type: "postgresql"
      });

    expect(patchTypeRes.status).toBe(200);
    expect(patchTypeRes.body.status).toBe("error");
    expect(patchTypeRes.body.error.code).toBe("VALIDATION_ERROR");
    expect(patchTypeRes.body.error.details.field).toBe("type");
  });

  it("returns stage/workspaceId/datasourceId/bindingSummary for workflow create", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-contract")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", "workflow-contract-key")
      .send({
        mode: "create",
        datasource: {
          name: "Workflow Contract DS",
          type: "sqlite",
          filePath: process.env.SQLITE_PATH
        },
        workspaceCreate: {
          name: "Workflow Contract Workspace"
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("success");
    expect(response.body.data.stage).toBe("completed");
    expect(typeof response.body.data.workspaceId).toBe("string");
    expect(response.body.data.workspaceId.length).toBeGreaterThan(0);
    expect(typeof response.body.data.datasourceId).toBe("string");
    expect(response.body.data.datasourceId.length).toBeGreaterThan(0);
    expect(response.body.data.bindingSummary.bound).toBe(true);
    expect(response.body.data.bindingSummary.workspaceId).toBe(response.body.data.workspaceId);
    expect(response.body.data.bindingSummary.datasourceId).toBe(response.body.data.datasourceId);
  });

  it("deduplicates repeated create workflow by x-idempotency-key", async () => {
    const key = `workflow-idempotency-${Date.now()}`;
    const datasourceName = `Workflow Idempotency DS ${Date.now()}`;
    const requestBody = {
      mode: "create" as const,
      datasource: {
        name: datasourceName,
        type: "sqlite" as const,
        filePath: process.env.SQLITE_PATH
      },
      workspaceCreate: {
        name: `Workflow Idempotency Workspace ${Date.now()}`
      }
    };

    const first = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-idempotency")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", key)
      .send(requestBody);
    const second = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-idempotency")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", key)
      .send(requestBody);

    expect(first.body.status).toBe("success");
    expect(second.body.status).toBe("success");
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.datasourceId).toBe(first.body.data.datasourceId);
    expect(second.body.data.workspaceId).toBe(first.body.data.workspaceId);

    const all = await datasourceRepository.listDatasources({
      includeDeleted: true
    });
    const matched = all.filter((item) => item.name === datasourceName);
    expect(matched).toHaveLength(1);
  });

  it("soft deletes newly created datasource when workflow create fails after datasource creation", async () => {
    jest
      .spyOn(workspaceDatasourceService, "bindDatasources")
      .mockResolvedValueOnce({
        workspaceId: "workspace-failed",
        successItems: [],
        failedItems: [
          {
            item: "ds-failed",
            code: "WORKSPACE_BINDING_FAILED",
            message: "binding failed"
          }
        ]
      });

    const response = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-compensation")
      .set("x-user-role", "admin")
      .send({
        mode: "create",
        datasource: {
          name: `Workflow Compensation DS ${Date.now()}`,
          type: "sqlite",
          filePath: process.env.SQLITE_PATH
        },
        workspaceCreate: {
          name: `Workflow Compensation Workspace ${Date.now()}`
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("error");
    expect(response.body.error.details.stage).toBe("binding_apply_failed");
    expect(response.body.error.details.compensation.attempted).toBe(true);
    expect(response.body.error.details.compensation.strategy).toBe("soft_delete");
    expect(response.body.error.details.compensation.status).toBe("succeeded");

    const datasourceId = response.body.error.details.datasourceId as string;
    const datasource = await datasourceRepository.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    expect(datasource?.status).toBe("deleted");
  });

  it("falls back to unavailable + provisioning_failed when soft delete compensation fails", async () => {
    jest
      .spyOn(workspaceDatasourceService, "bindDatasources")
      .mockResolvedValueOnce({
        workspaceId: "workspace-failed",
        successItems: [],
        failedItems: [
          {
            item: "ds-failed",
            code: "WORKSPACE_BINDING_FAILED",
            message: "binding failed"
          }
        ]
      });
    jest
      .spyOn(datasourceRepository, "softDeleteDatasource")
      .mockRejectedValueOnce(new Error("soft delete crashed"));

    const response = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-fallback")
      .set("x-user-role", "admin")
      .send({
        mode: "create",
        datasource: {
          name: `Workflow Fallback DS ${Date.now()}`,
          type: "sqlite",
          filePath: process.env.SQLITE_PATH
        },
        workspaceCreate: {
          name: `Workflow Fallback Workspace ${Date.now()}`
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("error");
    expect(response.body.error.details.compensation.attempted).toBe(true);
    expect(response.body.error.details.compensation.strategy).toBe("mark_unavailable");
    expect(response.body.error.details.compensation.status).toBe("succeeded");

    const datasourceId = response.body.error.details.datasourceId as string;
    const datasource = await datasourceRepository.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    expect(datasource?.status).toBe("unavailable");
    expect((datasource?.config as Record<string, unknown>)?.lastError).toMatchObject({
      code: "provisioning_failed"
    });
  });

  it("records workflow governance audit events with required metadata", async () => {
    const requestBody = {
      mode: "create" as const,
      datasource: {
        name: `Workflow Audit DS ${Date.now()}`,
        type: "sqlite" as const,
        filePath: process.env.SQLITE_PATH
      },
      workspaceCreate: {
        name: `Workflow Audit Workspace ${Date.now()}`
      }
    };

    const response = await request(app.getHttpServer())
      .post("/api/v1/datasources/workflow")
      .set("x-user-id", "admin-workflow-audit")
      .set("x-user-role", "admin")
      .set("x-idempotency-key", `workflow-audit-${Date.now()}`)
      .send(requestBody);
    expect(response.body.status).toBe("success");

    const datasourceId = response.body.data.datasourceId as string;
    const workspaceId = response.body.data.workspaceId as string;

    const lifecycleEvents = await auditLogRepository.listEvents({
      eventType: "datasource.workflow.lifecycle",
      limit: 100
    });
    const succeeded = lifecycleEvents.find(
      (event) =>
        event.eventCode === "WORKFLOW_SUCCEEDED" &&
        event.metadata?.datasourceId === datasourceId &&
        event.metadata?.workspaceId === workspaceId
    );
    expect(succeeded).toBeDefined();
    expect(succeeded?.metadata?.actorId).toBe("admin-workflow-audit");
    expect((succeeded?.metadata?.bindingSummary as Record<string, unknown>)?.bound).toBe(true);
  });

  it("supports PATCH relational datasource update with preflight validation", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-patch-relational-1",
      name: "Patch Relational Old",
      type: "mysql",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        host: "127.0.0.1",
        port: 3306,
        database: "analytics",
        username: "root",
        passwordCiphertext: "masked",
        passwordMasked: "ro***ot"
      }
    });
    const mysqlCreateConnection = jest.fn().mockResolvedValue({
      end: jest.fn().mockResolvedValue(undefined)
    });
    jest
      .spyOn(datasourceService as any, "loadMysqlModule")
      .mockResolvedValue({
        createConnection: mysqlCreateConnection
      });

    const patchRes = await request(app.getHttpServer())
      .patch("/api/v1/datasources/ds-patch-relational-1")
      .set("x-user-id", "admin-ds-patch")
      .set("x-user-role", "admin")
      .send({
        name: "Patch Relational New",
        host: "127.0.0.2",
        password: "next-secret"
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("success");
    expect(patchRes.body.data.name).toBe("Patch Relational New");
    expect(mysqlCreateConnection).toHaveBeenCalledTimes(1);
  });
});
