import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("r6 gate readiness integration", () => {
  let app: INestApplication;
  let quality: RagQualityService;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("r6-gate-readiness");
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
    await app.init();
    quality = app.get(RagQualityService);
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  beforeEach(() => {
    quality.reset();
  });

  it("signals block when R6 samples are not ready", async () => {
    quality.recordEvaluation({
      runId: "run-r6-sample-not-ready",
      datasourceId: "ds-r6-sample-not-ready",
      sampleSize: 32,
      recallAt20: 0.9,
      mrrAt10: 0.8,
      retrievalRerankP95Ms: 640,
      degradeRate: 0.01
    });

    const qualityRes = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(qualityRes.status).toBe(200);
    expect(qualityRes.body.status).toBe("success");
    expect(qualityRes.body.data.r6.sampleReady).toBe(false);
    expect(qualityRes.body.data.r6.gatePass).toBe(false);
    expect(qualityRes.body.data.r6.gateDecision).toBe("block");
    expect(qualityRes.body.data.r6.blockReasons).toEqual(
      expect.arrayContaining(["sample_not_ready"])
    );
    expect(qualityRes.body.data.r6.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "cacheEligibleHitRate"
        }),
        expect.objectContaining({
          name: "securityGatePass"
        })
      ])
    );

    const healthRes = await request(app.getHttpServer()).get("/health").send();
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.dependencies.ragQuality.r6.gateDecision).toBe("block");
    expect(healthRes.body.data.dependencies.ragQuality.r6.blockReasons).toEqual(
      expect.arrayContaining(["sample_not_ready"])
    );
  });

  it("signals freeze when cache hit rate breaches with ready samples", async () => {
    for (let i = 0; i < 500; i += 1) {
      quality.recordDatasourceOrchestration({
        datasourceId: `ds-r6-freeze-${i % 5}`,
        workspaceId: "workspace-r6-freeze",
        queueWaitMs: 1200,
        isolationViolation: false
      });
    }

    for (let i = 0; i < 1000; i += 1) {
      quality.recordCacheBudget({
        cacheEligible: true,
        cacheHit: i < 400,
        budgetDegraded: false
      });
    }

    quality.recordEvaluation({
      runId: "run-r6-freeze-cache-hit",
      datasourceId: "ds-r6-freeze",
      sampleSize: 1200,
      recallAt20: 0.92,
      mrrAt10: 0.83,
      retrievalRerankP95Ms: 620,
      degradeRate: 0.02
    });

    const qualityRes = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(qualityRes.status).toBe(200);
    expect(qualityRes.body.status).toBe("success");
    expect(qualityRes.body.data.r6.sampleReady).toBe(true);
    expect(qualityRes.body.data.r6.gatePass).toBe(false);
    expect(qualityRes.body.data.r6.gateDecision).toBe("freeze");
    expect(qualityRes.body.data.r6.blockReasons).toEqual([]);
    expect(qualityRes.body.data.r6.freezeReasons).toEqual(
      expect.arrayContaining(["cacheEligibleHitRate_breach"])
    );
    expect(qualityRes.body.data.r6.rollbackReasons).toEqual([]);

    const healthRes = await request(app.getHttpServer()).get("/health").send();
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("success");
    expect(healthRes.body.data.dependencies.ragQuality.r6.sampleReady).toBe(true);
    expect(healthRes.body.data.dependencies.ragQuality.r6.gateDecision).toBe("freeze");
    expect(healthRes.body.data.dependencies.ragQuality.r6.freezeReasons).toEqual(
      expect.arrayContaining(["cacheEligibleHitRate_breach"])
    );
  });
});
