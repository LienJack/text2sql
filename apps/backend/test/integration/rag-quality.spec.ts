import { resolve } from "node:path";
import type { Request } from "express";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { HealthController } from "../../src/modules/system/health.controller";

describe("rag quality gate integration", () => {
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

  it("marks gate pass when thresholds are met with sufficient sample", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const quality = moduleRef.get(RagQualityService);
    quality.reset();

    quality.recordEvaluation({
      runId: "run-rag-quality-pass-v1",
      datasourceId: "ds-rag-quality-pass",
      sampleSize: 48,
      recallAt20: 0.88,
      mrrAt10: 0.71,
      retrievalRerankP95Ms: 640,
      degradeRate: 0.03
    });

    const snapshot = quality.snapshot();
    expect(snapshot.sampleReady).toBe(true);
    expect(snapshot.gatePass).toBe(true);
    expect(snapshot.reasons).toEqual([]);
    expect(snapshot.priorSqlLane).toEqual({
      sampleSize: 0,
      priorSqlHitRate: 0,
      priorSqlMissCount: 0,
      priorSqlFilteredCount: 0,
      priorSqlStaleRate: 0,
      priorSqlAmbiguousCount: 0,
      priorSqlDuplicateCount: 0,
      priorSqlSafetyRejectedCount: 0,
      priorSqlFallbackToGenerationCount: 0
    });

    await moduleRef.close();
  });

  it("keeps gate closed when sample is not ready even if metrics look good", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const quality = moduleRef.get(RagQualityService);
    quality.reset();

    quality.recordEvaluation({
      runId: "run-rag-quality-sample-not-ready-v1",
      datasourceId: "ds-rag-quality-sample-not-ready",
      sampleSize: 12,
      recallAt20: 0.92,
      mrrAt10: 0.81,
      retrievalRerankP95Ms: 420,
      degradeRate: 0.01
    });

    const snapshot = quality.snapshot();
    expect(snapshot.sampleReady).toBe(false);
    expect(snapshot.gatePass).toBe(false);
    expect(snapshot.reasons).toEqual(expect.arrayContaining(["sample_not_ready"]));

    await moduleRef.close();
  });

  it("aggregates prior SQL lane metrics when data is present", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const quality = moduleRef.get(RagQualityService);
    quality.reset();

    quality.recordEvaluation({
      runId: "run-rag-quality-prior-sql-v1",
      datasourceId: "ds-rag-quality-prior-sql",
      sampleSize: 32,
      recallAt20: 0.84,
      mrrAt10: 0.7,
      retrievalRerankP95Ms: 620,
      degradeRate: 0.03,
      priorSqlLane: {
        totalCount: 20,
        hitCount: 15,
        missCount: 2,
        filteredCount: 2,
        staleCount: 1,
        ambiguousCount: 1,
        duplicateCount: 1,
        safetyRejectedCount: 1,
        fallbackToGenerationCount: 1
      }
    });
    quality.recordEvaluation({
      runId: "run-rag-quality-prior-sql-v2",
      datasourceId: "ds-rag-quality-prior-sql",
      sampleSize: 36,
      recallAt20: 0.86,
      mrrAt10: 0.72,
      retrievalRerankP95Ms: 600,
      degradeRate: 0.02,
      priorSqlLane: {
        totalCount: 10,
        hitCount: 5,
        missCount: 1,
        filteredCount: 1,
        staleCount: 2,
        ambiguousCount: 1,
        duplicateCount: 0,
        safetyRejectedCount: 1,
        fallbackToGenerationCount: 1
      }
    });

    const snapshot = quality.snapshot();
    expect(snapshot.priorSqlLane).toEqual({
      sampleSize: 30,
      priorSqlHitRate: 0.666667,
      priorSqlMissCount: 3,
      priorSqlFilteredCount: 3,
      priorSqlStaleRate: 0.1,
      priorSqlAmbiguousCount: 2,
      priorSqlDuplicateCount: 1,
      priorSqlSafetyRejectedCount: 2,
      priorSqlFallbackToGenerationCount: 2
    });
    expect(snapshot.gatePass).toBe(true);

    await moduleRef.close();
  });

  it("exposes rag quality gate summary on /health", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const quality = moduleRef.get(RagQualityService);
    const health = moduleRef.get(HealthController);
    quality.reset();
    quality.recordEvaluation({
      runId: "run-rag-quality-health-v1",
      datasourceId: "ds-rag-quality-health",
      sampleSize: 30,
      recallAt20: 0.81,
      mrrAt10: 0.66,
      retrievalRerankP95Ms: 700,
      degradeRate: 0.05
    });

    const response = await health.health({
      requestId: "req-rag-quality-health-v1"
    } as unknown as Request);
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("health endpoint returned unexpected error response");
    }
    const payload = response.data as {
      dependencies: {
        ragQuality: {
          gate: ReturnType<RagQualityService["snapshot"]>;
        };
        semanticSpineShadow: {
          gate: {
            sampleSize: number;
            sampleReady: boolean;
            gatePass: boolean;
          };
        };
      };
    };
    expect(payload.dependencies.ragQuality.gate.sampleReady).toBe(true);
    expect(payload.dependencies.ragQuality.gate.gatePass).toBe(true);
    expect(payload.dependencies.semanticSpineShadow.gate).toBeDefined();
    expect(typeof payload.dependencies.semanticSpineShadow.gate.sampleSize).toBe("number");

    await moduleRef.close();
  });
});
