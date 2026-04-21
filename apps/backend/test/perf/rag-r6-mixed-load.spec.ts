import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag r6 mixed load perf", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let qualityService: RagQualityService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-r6-mixed-load");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    process.env.RELEASE_CANDIDATE = "r6-mixed-load-ci";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    retrievalService = moduleRef.get(RagRetrievalService, {
      strict: false
    });
    qualityService = moduleRef.get(RagQualityService, {
      strict: false
    });
    indexBuilder = moduleRef.get(RagIndexBuilderService, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
    qualityService.reset();
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
    delete process.env.RELEASE_CANDIDATE;
  });

  it("maps mixed-load budget pressure into rollback gate decision with complete samples", async () => {
    const datasourceId = "ds-r6-mixed-load";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-r6-mixed-load-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status, paid_at)"
      },
      {
        id: "chunk-r6-mixed-load-schema-users",
        datasourceId,
        domain: "schema",
        content: "table users(id, email, registered_at)"
      },
      {
        id: "chunk-r6-mixed-load-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV means sum(order amount)"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-r6-mixed-load-v1",
      createdByRunId: "run-r6-mixed-load-build-v1",
      activatedByRunId: "run-r6-mixed-load-build-v1"
    });

    const retrieval = await retrievalService.retrieve({
      query: "orders gmv trend by status",
      datasourceId,
      runId: "run-r6-mixed-load-query-v1",
      budgetSignal: {
        costPressure: 0.94,
        latencyPressure: 0.91,
        tokenPressure: 0.95
      }
    });
    expect(retrieval.retrieval_bundle.candidates.length).toBeGreaterThan(0);

    for (let index = 0; index < 520; index += 1) {
      qualityService.recordDatasourceOrchestration({
        datasourceId: `ds-r6-mixed-load-${index % 8}`,
        workspaceId: "workspace-r6-mixed-load",
        queueWaitMs: 1800,
        isolationViolation: false
      });
    }

    for (let index = 0; index < 1000; index += 1) {
      qualityService.recordCacheBudget({
        cacheEligible: true,
        cacheHit: index % 4 !== 0,
        budgetDegraded: index < 100
      });
    }

    qualityService.recordEvaluation({
      runId: "run-r6-mixed-load-quality-v1",
      datasourceId,
      sampleSize: 1200,
      recallAt20: 0.9,
      mrrAt10: 0.77,
      retrievalRerankP95Ms: 660,
      degradeRate: 0.04
    });

    const snapshot = qualityService.snapshot();
    expect(snapshot.r6.sampleReady).toBe(true);
    expect(snapshot.r6.gatePass).toBe(false);
    expect(snapshot.r6.gateDecision).toBe("rollback");
    expect(snapshot.r6.blockReasons).toEqual([]);
    expect(snapshot.r6.freezeReasons).toEqual([]);
    expect(snapshot.r6.rollbackReasons).toEqual(
      expect.arrayContaining(["budgetDegradeRate_breach"])
    );
    const budgetMetric = snapshot.r6.metrics.find(
      (metric) => metric.name === "budgetDegradeRate"
    );
    const retrievalMetric = snapshot.r6.metrics.find(
      (metric) => metric.name === "retrievalP95Ms"
    );
    const queueMetric = snapshot.r6.metrics.find(
      (metric) => metric.name === "orchestratorQueueWaitP95Ms"
    );

    expect(budgetMetric?.samples ?? 0).toBeGreaterThanOrEqual(1000);
    expect(retrievalMetric?.samples).toBe(1200);
    expect(queueMetric?.samples).toBe(520);
  });
});
