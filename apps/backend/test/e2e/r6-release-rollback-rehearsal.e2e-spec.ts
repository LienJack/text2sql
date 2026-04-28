import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("r6 release rollback rehearsal e2e", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let qualityService: RagQualityService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("r6-release-rollback-rehearsal");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    process.env.GRAPH_ACCELERATION_ENABLED = "true";
    process.env.GRAPH_ACCELERATION_FORCE_FAILURE = "timeout";
    process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD = "1";
    process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS = "1000";
    process.env.RELEASE_CANDIDATE = "r6-rollback-rehearsal-ci";

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
    delete process.env.GRAPH_ACCELERATION_ENABLED;
    delete process.env.GRAPH_ACCELERATION_FORCE_FAILURE;
    delete process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD;
    delete process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS;
    delete process.env.RELEASE_CANDIDATE;
  });

  it("rehearses rollback decision under graph fault, budget breach and build-failure pressure", async () => {
    const datasourceId = "ds-r6-release-rollback-rehearsal";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-r6-rollback-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, user_id, amount, paid_at)"
      },
      {
        id: "chunk-r6-rollback-schema-users",
        datasourceId,
        domain: "schema",
        content: "table users(id, email, city)"
      },
      {
        id: "chunk-r6-rollback-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "daily revenue tracks paid order amount"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-r6-rollback-rehearsal-v1",
      createdByRunId: "run-r6-rollback-rehearsal-build-v1",
      activatedByRunId: "run-r6-rollback-rehearsal-build-v1"
    });

    const retrieval = await retrievalService.retrieve({
      query: "orders users relationship for rollback rehearsal",
      datasourceId,
      runId: "run-r6-rollback-rehearsal-query-v1"
    });
    expect(retrieval.retrieval_bundle.candidates.length).toBeGreaterThan(0);
    expect(retrieval.retrieval_bundle.lane_results.graph.status).toBe("degraded");
    expect(retrieval.retrieval_bundle.lane_results.graph.degrade_reason).toContain(
      "graph_acceleration"
    );

    for (let index = 0; index < 520; index += 1) {
      qualityService.recordDatasourceOrchestration({
        datasourceId: `ds-r6-rollback-build-${index % 6}`,
        workspaceId: "workspace-r6-release-rollback",
        queueWaitMs: 3600,
        isolationViolation: index < 16
      });
    }

    for (let index = 0; index < 1000; index += 1) {
      qualityService.recordCacheBudget({
        cacheEligible: true,
        cacheHit: index % 3 !== 0,
        budgetDegraded: index < 150
      });
    }

    qualityService.recordEvaluation({
      runId: "run-r6-rollback-gate-v1",
      datasourceId,
      sampleSize: 1200,
      recallAt20: 0.85,
      mrrAt10: 0.7,
      retrievalRerankP95Ms: 820,
      degradeRate: 0.04
    });

    const snapshot = qualityService.snapshot();
    expect(snapshot.r6.sampleReady).toBe(true);
    expect(snapshot.r6.gateDecision).toBe("block");
    expect(snapshot.r6.gatePass).toBe(false);
    expect(snapshot.r6.blockReasons).toEqual(
      expect.arrayContaining(["indexBuildSuccessRate_breach", "retrievalP95Ms_breach"])
    );
    expect(snapshot.r6.freezeReasons).toEqual([]);
    expect(snapshot.r6.rollbackReasons).toEqual(
      expect.arrayContaining(["budgetDegradeRate_breach"])
    );
  });
});
