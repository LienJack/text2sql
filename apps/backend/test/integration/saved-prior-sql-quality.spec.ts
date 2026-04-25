import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";

describe("saved prior sql quality diagnostics integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("aggregates saved prior shortcut diagnostic counters", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const quality = moduleRef.get(RagQualityService);
    quality.reset();

    quality.recordEvaluation({
      runId: "run-saved-prior-quality-v1",
      datasourceId: "ds-saved-prior-quality",
      sampleSize: 48,
      recallAt20: 0.88,
      mrrAt10: 0.72,
      retrievalRerankP95Ms: 640,
      degradeRate: 0.03,
      priorSqlLane: {
        totalCount: 20,
        hitCount: 12,
        missCount: 3,
        filteredCount: 2,
        staleCount: 1,
        ambiguousCount: 1,
        duplicateCount: 1,
        safetyRejectedCount: 2,
        fallbackToGenerationCount: 2
      }
    });

    const snapshot = quality.snapshot();
    expect(snapshot.priorSqlLane.sampleSize).toBe(20);
    expect(snapshot.priorSqlLane.priorSqlHitRate).toBe(0.6);
    expect(snapshot.priorSqlLane.priorSqlMissCount).toBe(3);
    expect(snapshot.priorSqlLane.priorSqlFilteredCount).toBe(2);
    expect(snapshot.priorSqlLane.priorSqlStaleRate).toBe(0.05);
    expect(snapshot.priorSqlLane.priorSqlAmbiguousCount).toBe(1);
    expect(snapshot.priorSqlLane.priorSqlDuplicateCount).toBe(1);
    expect(snapshot.priorSqlLane.priorSqlSafetyRejectedCount).toBe(2);
    expect(snapshot.priorSqlLane.priorSqlFallbackToGenerationCount).toBe(2);

    await moduleRef.close();
  });
});
