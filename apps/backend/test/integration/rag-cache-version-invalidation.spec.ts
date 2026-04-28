import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagCacheKeyFactory } from "../../src/modules/rag/perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../../src/modules/rag/perf/rag-query-cache.service";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag cache version invalidation integration", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cacheKeyFactory: RagCacheKeyFactory;
  let queryCache: RagQueryCacheService;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-cache-invalidation");
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
    indexBuilder = moduleRef.get(RagIndexBuilderService, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
    cacheKeyFactory = moduleRef.get(RagCacheKeyFactory, {
      strict: false
    });
    queryCache = moduleRef.get(RagQueryCacheService, {
      strict: false
    });
    queryCache.reset();
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("does not serve stale retrieval bundle across index version switch", async () => {
    const datasourceId = "ds-rag-cache-version";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-v1-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      }
    ]);
    const v1 = await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-v1",
      createdByRunId: "run-cache-v1-build",
      activatedByRunId: "run-cache-v1-build"
    });

    const first = await retrievalService.retrieve({
      query: "orders amount",
      datasourceId,
      runId: "run-cache-v1-query"
    });
    expect(first.retrieval_bundle.index_version_id).toBe(v1.indexVersionId);
    const statsAfterFirst = queryCache.snapshotStats();
    expect(statsAfterFirst.misses).toBeGreaterThanOrEqual(1);

    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-v2-payments",
        datasourceId,
        domain: "schema",
        content: "table payments(id, channel, settled_at)"
      }
    ]);
    const v2 = await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-v2",
      createdByRunId: "run-cache-v2-build",
      activatedByRunId: "run-cache-v2-build"
    });

    const second = await retrievalService.retrieve({
      query: "orders amount",
      datasourceId,
      runId: "run-cache-v2-query"
    });

    expect(v2.indexVersionId).not.toBe(v1.indexVersionId);
    expect(second.retrieval_bundle.index_version_id).toBe(v2.indexVersionId);
    const candidateIds = second.retrieval_bundle.candidates.map((item) => item.chunk_id);
    expect(candidateIds).not.toContain("chunk-v1-orders");
    expect(candidateIds).toContain("chunk-v2-payments");

    const statsAfterSecond = queryCache.snapshotStats();
    expect(statsAfterSecond.evictions).toBeGreaterThanOrEqual(1);

    const v1Key = cacheKeyFactory.build({
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId: v1.indexVersionId,
      query: "orders amount"
    });
    const v2Key = cacheKeyFactory.build({
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId: v2.indexVersionId,
      query: "orders amount"
    });
    expect(v1Key).toContain("ds=ds-rag-cache-version");
    expect(v1Key).toMatch(/\|q=[a-f0-9]{24}/);
    expect(v2Key).not.toBe(v1Key);
  });

  it("promotes L2 entry after L1 expires without stale read", async () => {
    const datasourceId = "ds-rag-cache-layer";
    const indexVersionId = "idx-layer-v1";
    const key = cacheKeyFactory.build({
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId,
      query: "orders amount"
    });
    queryCache.set({
      key,
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId,
      value: {
        marker: "l2-fallback-hit"
      },
      l1TtlMs: 5,
      // Keep L2 window generous to avoid scheduler jitter under full-suite parallel load.
      l2TtlMs: 3000
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    const read = queryCache.get<{ marker: string }>(key);
    expect(read.hit).toBe(true);
    expect(read.value?.marker).toBe("l2-fallback-hit");

    const stats = queryCache.snapshotStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.misses).toBe(0);
  });
});
