import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag cache budget load", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let qualityService: RagQualityService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-cache-budget-load");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

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
  });

  it("keeps cache hit rate above 0.5 under repeated hot-query load", async () => {
    const datasourceId = "ds-rag-cache-load";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-load-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status, paid_at)"
      },
      {
        id: "chunk-load-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT status, SUM(amount) FROM orders GROUP BY status"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-cache-load-v1",
      createdByRunId: "run-cache-load-build-v1",
      activatedByRunId: "run-cache-load-build-v1"
    });

    for (let index = 0; index < 12; index += 1) {
      await retrievalService.retrieve({
        query: "orders amount by status",
        datasourceId,
        runId: `run-cache-load-query-${index}`
      });
    }
    for (let index = 0; index < 4; index += 1) {
      await retrievalService.retrieve({
        query: "orders amount by status",
        datasourceId,
        runId: `run-cache-load-budget-query-${index}`,
        budgetSignal: {
          costPressure: 0.98,
          latencyPressure: 0.96,
          tokenPressure: 0.97
        }
      });
    }

    const snapshot = qualityService.snapshot();
    expect(snapshot.cacheBudget.sampleSize1h).toBeGreaterThanOrEqual(10);
    expect(snapshot.cacheBudget.cacheEligibleHitRate).toBeGreaterThanOrEqual(0.5);
    expect(snapshot.cacheBudget.budgetDegradeRate).toBeGreaterThan(0);
  });
});
