import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { RagAuditReplayService } from "../../src/modules/rag/audit/rag-audit-replay.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function asActor(
  req: request.Test,
  role: "admin" | "user",
  userId: string
): request.Test {
  return req.set("x-user-role", role).set("x-user-id", userId);
}

describe("glossary release + rollback anchor integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;
  let auditLogRepository: AuditLogRepository;
  let ragAuditReplayService: RagAuditReplayService;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("glossary-release-rollback");
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

    auditLogRepository = app.get(AuditLogRepository, { strict: false });
    ragAuditReplayService = app.get(RagAuditReplayService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("creates/lists anchors and supports rollback-to-anchor with idempotent rollback-to-current", async () => {
    const rollbackRequestContext = "glossary-req:glossary-anchor-rollback-v1";
    const createTermRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/terms"),
      "admin",
      "admin-anchor"
    )
      .set("x-idempotency-key", "glossary-anchor-term-create")
      .send({
        term: "GMV",
        definition: "gross merchandise value",
        scope: "global",
        priority: 80
      });
    expect(createTermRes.status).toBe(201);
    expect(createTermRes.body.status).toBe("success");

    const releaseV1Res = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors"),
      "admin",
      "admin-anchor"
    )
      .set("x-idempotency-key", "glossary-anchor-release-v1")
      .send({
        scope: "global",
        version: 1,
        summary: "release-v1",
        metadata: {
          runId: "run-glossary-anchor-release-v1"
        }
      });
    expect(releaseV1Res.status).toBe(201);
    expect(releaseV1Res.body.status).toBe("success");
    const releaseAnchorV1Id = releaseV1Res.body.data.anchor.id as string;

    const releaseV2Res = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors"),
      "admin",
      "admin-anchor"
    )
      .set("x-idempotency-key", "glossary-anchor-release-v2")
      .send({
        scope: "global",
        version: 2,
        summary: "release-v2",
        metadata: {
          runId: "run-glossary-anchor-release-v2"
        }
      });
    expect(releaseV2Res.status).toBe(201);
    expect(releaseV2Res.body.status).toBe("success");
    expect(releaseV2Res.body.data.previousAnchorId).toBe(releaseAnchorV1Id);

    const listRes = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/anchors"),
      "admin",
      "admin-anchor"
    ).query({
      scope: "global"
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(listRes.body.data.items.length).toBeGreaterThanOrEqual(2);
    expect(
      listRes.body.data.items.some(
        (item: { id: string; anchorType: string }) =>
          item.id === releaseAnchorV1Id && item.anchorType === "release"
      )
    ).toBe(true);

    const rollbackRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors/rollback"),
      "admin",
      "admin-anchor"
    )
      .set("x-idempotency-key", "glossary-anchor-rollback-v1")
      .send({
        scope: "global",
        targetAnchorId: releaseAnchorV1Id,
        rollbackReason: "manual rollback check"
      });
    expect(rollbackRes.status).toBe(201);
    expect(rollbackRes.body.status).toBe("success");
    expect(rollbackRes.body.data.activeAnchor.anchorType).toBe("rollback");
    expect(rollbackRes.body.data.activeAnchor.version).toBe(1);
    expect(rollbackRes.body.data.previousAnchorId).toBe(releaseV2Res.body.data.anchor.id);
    expect(rollbackRes.body.data.replayed).toBe(false);

    const rollbackNoopRes = await asActor(
      request(app.getHttpServer()).post("/api/v1/glossary/anchors/rollback"),
      "admin",
      "admin-anchor"
    )
      .set("x-idempotency-key", "glossary-anchor-rollback-v1-noop")
      .send({
        scope: "global",
        targetAnchorId: releaseAnchorV1Id,
        rollbackReason: "manual rollback check"
      });
    expect(rollbackNoopRes.status).toBe(201);
    expect(rollbackNoopRes.body.status).toBe("success");
    expect(rollbackNoopRes.body.data.replayed).toBe(true);
    expect(rollbackNoopRes.body.data.activeAnchor.id).toBe(
      rollbackRes.body.data.activeAnchor.id
    );

    const rollbackListRes = await asActor(
      request(app.getHttpServer()).get("/api/v1/glossary/anchors"),
      "admin",
      "admin-anchor"
    ).query({
      scope: "global",
      anchorType: "rollback"
    });
    expect(rollbackListRes.status).toBe(200);
    expect(rollbackListRes.body.status).toBe("success");
    expect(
      rollbackListRes.body.data.items.some(
        (item: { id: string; anchorType: string }) =>
          item.id === rollbackRes.body.data.activeAnchor.id &&
          item.anchorType === "rollback"
      )
    ).toBe(true);

    const rollbackAuditEvents = await auditLogRepository.listEvents({
      eventType: "glossary.anchor.rollback.applied",
      limit: 10
    });
    const rollbackEvent = rollbackAuditEvents.find(
      (item) => item.metadata?.idempotencyKey === "glossary-anchor-rollback-v1"
    );
    expect(rollbackEvent).toBeDefined();
    expect(rollbackEvent?.metadata?.anchorType).toBe("rollback");
    expect(rollbackEvent?.requestId).toBe(rollbackRequestContext);

    const runId = rollbackRes.body.data.activeAnchor.createdByRunId as string;
    const chainByRun = await ragAuditReplayService.queryChain({ runId });
    expect(chainByRun.runId).toBe(runId);

    const chainByRequest = await ragAuditReplayService.queryChain({
      requestId: rollbackRequestContext
    });
    expect(
      chainByRequest.events.some((item) => item.requestId === rollbackRequestContext)
    ).toBe(true);
    expect(
      chainByRequest.events.some((item) => item.eventType === "glossary.anchor.rollback")
    ).toBe(true);
    expect(
      chainByRequest.events.some((item) =>
        item.audits.some((audit) => audit.eventType === "glossary.anchor.rollback.applied")
      )
    ).toBe(true);
  });
});
