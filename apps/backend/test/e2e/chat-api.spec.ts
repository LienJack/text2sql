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

    const messageViewRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messageViewRes.status).toBe(200);
    expect(messageViewRes.body.status).toBe("success");
    expect(messageViewRes.body.data.session.id).toBe(sessionId);
    expect(Array.isArray(messageViewRes.body.data.messages)).toBe(true);
    expect(messageViewRes.body.data.latestRun.runId).toBe(runRes.body.data.run.runId);
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
    expect(res.body.data.cors.allowedOrigins).toContain("http://localhost:3001");
    expect(res.body.data.dependencies.sessions.sync.total).toBeGreaterThanOrEqual(0);
    expect(res.body.data.dependencies.gateMetrics.acceptance).toEqual(
      expect.objectContaining({
        observedRuns: expect.any(Number),
        sampleReady: expect.any(Boolean),
        gatePass: expect.any(Boolean)
      })
    );
  });
});
