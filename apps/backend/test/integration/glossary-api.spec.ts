import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function asActor(
  req: request.Test,
  role: "admin" | "user",
  userId: string
): request.Test {
  return req.set("x-user-role", role).set("x-user-id", userId);
}

describe("glossary api integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;
  let auditLogRepository: AuditLogRepository;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("glossary-api");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestActorMiddleware);
    await app.init();
    auditLogRepository = app.get(AuditLogRepository, {
      strict: false
    });
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("allows admin to create/update/toggle terms, list by filters, and writes audit metadata", async () => {
    const createGlobalRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    )
      .set("x-idempotency-key", "glossary-create-global-1")
      .send({
        term: "GMV",
        definition: "gross merchandise value",
        synonyms: ["成交额"],
        scope: "global",
        priority: 60
      });

    expect(createGlobalRes.status).toBe(201);
    expect(createGlobalRes.body.status).toBe("success");
    const globalTermId = createGlobalRes.body.data.term.id as string;

    const createDatasourceRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    )
      .set("x-idempotency-key", "glossary-create-datasource-1")
      .send({
        term: "订单",
        definition: "订单事实表",
        synonyms: ["order"],
        scope: "datasource",
        datasourceId: "sqlite_main",
        priority: 80
      });

    expect(createDatasourceRes.status).toBe(201);
    expect(createDatasourceRes.body.status).toBe("success");
    const datasourceTermId = createDatasourceRes.body.data.term.id as string;

    const listGlobalRes = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    ).query({
      scope: "global"
    });
    expect(listGlobalRes.status).toBe(200);
    expect(listGlobalRes.body.status).toBe("success");
    expect(
      listGlobalRes.body.data.items.some((item: { id: string }) => item.id === globalTermId)
    ).toBe(true);
    expect(
      listGlobalRes.body.data.items.some(
        (item: { id: string }) => item.id === datasourceTermId
      )
    ).toBe(false);

    const listDatasourceRes = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    ).query({
      scope: "datasource",
      datasourceId: "sqlite_main",
      query: "订单",
      status: "active"
    });
    expect(listDatasourceRes.status).toBe(200);
    expect(listDatasourceRes.body.status).toBe("success");
    expect(listDatasourceRes.body.data.total).toBeGreaterThanOrEqual(1);
    expect(
      listDatasourceRes.body.data.items.some(
        (item: { id: string }) => item.id === datasourceTermId
      )
    ).toBe(true);

    const updateRes = await asActor(
      request(app.getHttpServer()).patch(`/api/v1/glossary/terms/${globalTermId}`),
      "admin",
      "admin-glossary"
    )
      .set("x-idempotency-key", "glossary-update-global-1")
      .send({
        definition: "gross merchandise value updated",
        synonyms: ["交易额", "成交总额"],
        priority: 75
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("success");
    expect(updateRes.body.data.term.priority).toBe(75);
    expect(updateRes.body.data.term.definition).toContain("updated");

    const toggleRes = await asActor(
      request(app.getHttpServer()).post(`/api/v1/glossary/terms/${globalTermId}/toggle`),
      "admin",
      "admin-glossary"
    )
      .set("x-idempotency-key", "glossary-toggle-global-1")
      .send({});
    expect(toggleRes.status).toBe(201);
    expect(toggleRes.body.status).toBe("success");
    expect(toggleRes.body.data.term.status).toBe("inactive");

    const inactiveListRes = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    ).query({
      status: "inactive",
      query: "GMV"
    });
    expect(inactiveListRes.status).toBe(200);
    expect(inactiveListRes.body.status).toBe("success");
    expect(
      inactiveListRes.body.data.items.some((item: { id: string }) => item.id === globalTermId)
    ).toBe(true);

    const writeEvents = await auditLogRepository.listEvents({
      eventType: "glossary.term.write",
      limit: 30
    });
    const toggleEvent = writeEvents.find(
      (item) => item.metadata?.idempotencyKey === "glossary-toggle-global-1"
    );
    expect(toggleEvent).toBeDefined();
    expect(toggleEvent?.metadata?.actorId).toBe("admin-glossary");
    expect(toggleEvent?.metadata?.scope).toBe("global");
    expect(toggleEvent?.metadata).toHaveProperty("winnerTerm");
    expect(toggleEvent?.metadata).toHaveProperty("loserTerms");
    expect(typeof toggleEvent?.metadata?.priority).toBe("number");
    expect(toggleEvent?.metadata?.idempotencyKey).toBe("glossary-toggle-global-1");
  });

  it("rejects non-admin writes and keeps term list unchanged", async () => {
    const beforeList = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    );
    expect(beforeList.status).toBe(200);
    const beforeTotal = beforeList.body.data.total as number;

    const deniedRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/terms"),
      "user",
      "user-glossary"
    ).send({
      term: "利润率",
      definition: "profit rate",
      scope: "global"
    });
    expect(deniedRes.status).toBe(403);

    const afterList = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/terms"),
      "admin",
      "admin-glossary"
    );
    expect(afterList.status).toBe(200);
    expect(afterList.body.data.total).toBe(beforeTotal);
    expect(
      afterList.body.data.items.some((item: { term: string }) => item.term === "利润率")
    ).toBe(false);
  });

  it("rejects invalid rollback target and records rollback rejection audit metadata", async () => {
    const deniedRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors/rollback"),
      "user",
      "user-glossary"
    ).send({
      scope: "datasource",
      datasourceId: "sqlite_main",
      targetAnchorId: "anchor-v1"
    });
    expect(deniedRes.status).toBe(403);

    const scaffoldRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors/rollback"),
      "admin",
      "admin-glossary"
    )
      .set("x-idempotency-key", "glossary-rollback-anchor-1")
      .send({
        scope: "datasource",
        datasourceId: "sqlite_main",
        targetAnchorId: "anchor-v1",
        rollbackReason: "unit2 scaffold check"
      });
    expect(scaffoldRes.body.status).toBe("error");
    expect(scaffoldRes.body.error.code).toBe("GLOSSARY_ANCHOR_NOT_FOUND");

    const rollbackEvents = await auditLogRepository.listEvents({
      eventType: "glossary.anchor.rollback.rejected",
      limit: 10
    });
    const rollbackEvent = rollbackEvents.find(
      (item) => item.metadata?.idempotencyKey === "glossary-rollback-anchor-1"
    );
    expect(rollbackEvent).toBeDefined();
    expect(rollbackEvent?.metadata?.actorId).toBe("admin-glossary");
    expect(rollbackEvent?.metadata?.scope).toBe("datasource");
    expect(rollbackEvent?.metadata?.winnerTerm).toBeNull();
    expect(rollbackEvent?.metadata?.loserTerms).toEqual([]);
    expect(rollbackEvent?.metadata?.priority).toBeNull();
  });
});
