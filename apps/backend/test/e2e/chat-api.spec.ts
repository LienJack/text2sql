import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("chat api (e2e)", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;
  let datasourceRepository: DatasourceRepository;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("chat-api");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    datasourceRepository = app.get(DatasourceRepository);
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("should create session and send one message", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.status).toBe("success");
    const sessionId = sessionRes.body.data.id;

    const runRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({ message: "统计订单状态分布" });
    expect(runRes.status).toBe(201);
    expect(runRes.body.status).toBe("success");
    expect(runRes.body.data.kind).toBe("agent-run");
    expect(runRes.body.data.outcome).toBe("executionResult");
    expect(runRes.body.data.run.runId).toBeDefined();
    expect(runRes.body.data.run.sql).toMatch(/select/i);
    expect(runRes.body.data.run.explanation).toBeTruthy();
    expect(runRes.body.data.run.llmRaw).toBeTruthy();
    expect(runRes.body.data.run.llmRaw.provider).toBe("volcengine");
    expect(runRes.body.data.run.llmRaw.model).toBeTruthy();
    expect(runRes.body.data.delivery).toBeTruthy();
    expect(runRes.body.data.run.delivery).toEqual(runRes.body.data.delivery);
    expect(runRes.body.data.run.answer).toBe(runRes.body.data.delivery.answer.text);
    expect(runRes.body.data.delivery.evidence.runId).toBe(runRes.body.data.run.runId);
    const syncArtifact = runRes.body.data.delivery.artifact as
      | {
          rowCount?: number;
          summary?: { text?: string };
          table?: { rowCount?: number };
          display?: string;
          validation?: { status?: string };
        }
      | undefined;
    expect(syncArtifact).toBeTruthy();
    expect(syncArtifact?.summary?.text).toBeTruthy();
    expect(syncArtifact?.table?.rowCount).toBe(syncArtifact?.rowCount);
    expect(syncArtifact?.display).toBeTruthy();
    expect(syncArtifact?.validation?.status).toBeTruthy();
    const contextPackStatus = runRes.body.data.delivery?.evidence?.contextPackStatus;
    if (contextPackStatus !== undefined) {
      expect(["ready", "degraded"]).toContain(contextPackStatus);
    }
    const traceV2 = runRes.body.data.run.trace?.v2 as
      | {
          version?: string;
          stageOrder?: string[];
          stages?: Array<{ stage?: string }>;
        }
      | undefined;
    if (traceV2 !== undefined) {
      expect(traceV2.version).toBe("v2");
      expect(traceV2.stageOrder).toEqual([
        "intake",
        "retrieve",
        "assemble-context",
        "semantic-plan",
        "generate-sql",
        "validate",
        "correct",
        "execute",
        "answer"
      ]);
      expect(traceV2.stages?.map((item) => item.stage)).toEqual(traceV2.stageOrder);
    }
    const deliveryV2 = runRes.body.data.delivery?.evidence?.v2 as
      | {
          stageArtifacts?: Array<{ stage?: string }>;
        }
      | undefined;
    if (deliveryV2 !== undefined) {
      expect(deliveryV2.stageArtifacts?.map((item) => item.stage)).toEqual(
        traceV2?.stageOrder
      );
    }

    const messageViewRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messageViewRes.status).toBe(200);
    expect(messageViewRes.body.status).toBe("success");
    expect(messageViewRes.body.data.session.id).toBe(sessionId);
    expect(Array.isArray(messageViewRes.body.data.messages)).toBe(true);
    expect(messageViewRes.body.data.latestRun.runId).toBe(runRes.body.data.run.runId);
    expect(messageViewRes.body.data.latestRun.answer).toBe(
      messageViewRes.body.data.latestRun.delivery.answer.text
    );
    expect(messageViewRes.body.data.latestRun.delivery.evidence.runId).toBe(
      messageViewRes.body.data.latestRun.runId
    );
    expect(messageViewRes.body.data.latestRun.delivery.artifact.summary.text).toBeTruthy();
    const latestTraceV2 = messageViewRes.body.data.latestRun.trace?.v2 as
      | {
          version?: string;
        }
      | undefined;
    if (latestTraceV2 !== undefined) {
      expect(latestTraceV2.version).toBe("v2");
    }
  });

  it("should accept optional contextEnvelope on sync message endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id as string;

    const runRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({
        message: "统计华东区已支付订单净销售额",
        contextEnvelope: {
          metricDefinition: "净销售额=订单金额-退款金额",
          timeRange: {
            from: "2026-01-01",
            to: "2026-03-31",
            timezone: "Asia/Shanghai"
          },
          entityMappings: [
            {
              entity: "华东区",
              mappedTo: "region=east_china"
            }
          ],
          mustIncludeTables: ["orders", "refunds"],
          mustExcludeTables: ["internal_audit_logs"],
          businessConstraints: ["仅统计已支付订单"]
        }
      });

    expect(runRes.status).toBe(201);
    expect(runRes.body.status).toBe("success");
    expect(runRes.body.data.kind).toBe("agent-run");
    expect(runRes.body.data.run.runId).toBeDefined();
  });

  it("should reject invalid contextEnvelope boundary on sync message endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id as string;

    const invalidRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({
        message: "统计订单",
        contextEnvelope: {
          metricDefinition: "x".repeat(301)
        }
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.statusCode).toBe(400);
    expect(invalidRes.body.error).toBe("Bad Request");
    expect(Array.isArray(invalidRes.body.message)).toBe(true);
    expect(
      (invalidRes.body.message as string[]).some((item) =>
        item.includes("contextEnvelope.metricDefinition")
      )
    ).toBe(true);
  });

  it("should list, rename and soft-delete sessions", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    const sessionId = sessionRes.body.data.id as string;

    const listBefore = await request(app.getHttpServer())
      .get("/api/v1/sessions")
      .send();
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.status).toBe("success");
    expect(
      listBefore.body.data.some((item: { id: string }) => item.id === sessionId)
    ).toBe(true);

    const renameRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ title: "会话重命名测试" });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.status).toBe("success");
    expect(renameRes.body.data.title).toBe("会话重命名测试");

    const invalidRenameRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ title: "   " });
    expect(invalidRenameRes.status).toBe(400);
    expect(invalidRenameRes.body.status).toBe("error");
    expect(invalidRenameRes.body.error.code).toBe("VALIDATION_ERROR");

    const debugRes = await request(app.getHttpServer())
      .patch(`/api/v1/sessions/${sessionId}`)
      .send({ debugEnabled: true });
    expect(debugRes.status).toBe(200);
    expect(debugRes.body.status).toBe("success");
    expect(debugRes.body.data.debugEnabled).toBe(true);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/sessions/${sessionId}`)
      .send();
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe("success");
    expect(deleteRes.body.data.deleted).toBe(true);

    const listAfter = await request(app.getHttpServer())
      .get("/api/v1/sessions")
      .send();
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.status).toBe("success");
    expect(
      listAfter.body.data.some((item: { id: string }) => item.id === sessionId)
    ).toBe(false);
  });

  it("should reject session creation without explicit datasource", async () => {
    const missingDatasourceRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({});

    expect(missingDatasourceRes.status).toBe(400);
    expect(missingDatasourceRes.body.status).toBe("error");
    expect(missingDatasourceRes.body.error.code).toBe("VALIDATION_ERROR");

    const blankDatasourceRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "   "
      });

    expect(blankDatasourceRes.status).toBe(400);
    expect(blankDatasourceRes.body.status).toBe("error");
    expect(blankDatasourceRes.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should filter sessions by datasource id", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-filter-mysql",
      name: "筛选测试 MySQL",
      type: "mysql",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        host: "127.0.0.1",
        port: 3306,
        database: "biz",
        username: "root",
        password: "secret"
      }
    });

    const sqliteSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "sqlite_main"
      });
    const mysqlSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "ds-filter-mysql"
      });

    expect(sqliteSessionRes.body.status).toBe("success");
    expect(mysqlSessionRes.body.status).toBe("success");

    const sqliteListRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?datasource=sqlite_main")
      .send();
    const mysqlListRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?datasource=ds-filter-mysql")
      .send();

    expect(sqliteListRes.body.status).toBe("success");
    expect(mysqlListRes.body.status).toBe("success");
    expect(
      sqliteListRes.body.data.every(
        (item: { datasource: string }) => item.datasource === "sqlite_main"
      )
    ).toBe(true);
    expect(
      mysqlListRes.body.data.every(
        (item: { datasource: string }) => item.datasource === "ds-filter-mysql"
      )
    ).toBe(true);
  });

  it("should support session list view contract", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-view-current",
      name: "当前数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-view-unavailable",
      name: "不可用数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-view-deleted",
      name: "已删除数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });

    const currentSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "ds-view-current"
      });
    const unavailableSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "ds-view-unavailable"
      });
    const deletedSessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "ds-view-deleted"
      });

    const currentSessionId = currentSessionRes.body.data.id as string;
    const unavailableSessionId = unavailableSessionRes.body.data.id as string;
    const deletedSessionId = deletedSessionRes.body.data.id as string;

    await datasourceRepository.markDatasourceUnavailable("ds-view-unavailable", {
      reason: "view-contract"
    });
    await datasourceRepository.softDeleteDatasource("ds-view-deleted");

    const invalidCurrentViewRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?view=current")
      .send();
    expect(invalidCurrentViewRes.status).toBe(400);
    expect(invalidCurrentViewRes.body.status).toBe("error");
    expect(invalidCurrentViewRes.body.error.code).toBe("VALIDATION_ERROR");

    const unknownDatasourceViewRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?view=current&datasource=ds-not-exist")
      .send();
    expect(unknownDatasourceViewRes.status).toBe(404);
    expect(unknownDatasourceViewRes.body.status).toBe("error");
    expect(unknownDatasourceViewRes.body.error.code).toBe("DATASOURCE_NOT_FOUND");

    const currentViewRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?view=current&datasource=ds-view-current")
      .send();
    expect(currentViewRes.status).toBe(200);
    expect(currentViewRes.body.status).toBe("success");
    expect(
      currentViewRes.body.data.some(
        (item: { id: string }) => item.id === currentSessionId
      )
    ).toBe(true);
    expect(
      currentViewRes.body.data.every(
        (item: { datasource: string; datasourceStatus?: string }) =>
          item.datasource === "ds-view-current" &&
          item.datasourceStatus === "available"
      )
    ).toBe(true);

    const readonlyHistoryRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?view=readonly-history")
      .send();
    expect(readonlyHistoryRes.status).toBe(200);
    expect(readonlyHistoryRes.body.status).toBe("success");
    const readonlyIds = readonlyHistoryRes.body.data.map(
      (item: { id: string }) => item.id
    ) as string[];
    expect(readonlyIds).toContain(unavailableSessionId);
    expect(readonlyIds).toContain(deletedSessionId);
    expect(readonlyIds).not.toContain(currentSessionId);
    expect(
      readonlyHistoryRes.body.data.every(
        (item: { datasourceStatus?: string }) =>
          item.datasourceStatus === "unavailable" ||
          item.datasourceStatus === "deleted"
      )
    ).toBe(true);

    const allViewRes = await request(app.getHttpServer())
      .get("/api/v1/sessions?view=all&datasource=ds-view-current")
      .send();
    expect(allViewRes.status).toBe(200);
    expect(allViewRes.body.status).toBe("success");
    expect(
      allViewRes.body.data.every(
        (item: { datasource: string }) => item.datasource === "ds-view-current"
      )
    ).toBe(true);
  });

  it("should block message sending when session datasource is unavailable", async () => {
    await datasourceRepository.upsertDatasource({
      id: "ds-unavailable",
      name: "失效数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: process.env.SQLITE_PATH
      }
    });

    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({
        datasource: "ds-unavailable"
      });
    const sessionId = sessionRes.body.data.id as string;

    await datasourceRepository.markDatasourceUnavailable("ds-unavailable", {
      reason: "manual-test"
    });

    const sendRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({ message: "查询最近订单" });

    expect(sendRes.status).toBe(409);
    expect(sendRes.body.status).toBe("error");
    expect(sendRes.body.error.code).toBe("DATASOURCE_UNAVAILABLE");

    const viewRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.status).toBe("success");
  });

  it("should expose configured cors origins in health response", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.cors.allowedOrigins).toContain("http://localhost:3000");
    expect(res.body.data.dependencies.sessions.sync.total).toBeGreaterThanOrEqual(0);
    expect(res.body.data.dependencies.gateMetrics.acceptance).toEqual(
      expect.objectContaining({
        observedRuns: expect.any(Number),
        sampleReady: expect.any(Boolean),
        gatePass: expect.any(Boolean)
      })
    );

    const apiHealthRes = await request(app.getHttpServer())
      .get("/api/health")
      .send();
    expect(apiHealthRes.status).toBe(200);
    expect(apiHealthRes.body.status).toBe("success");
    expect(apiHealthRes.body.data.status).toBe(res.body.data.status);
  });
});
