import { Test, type TestingModule } from "@nestjs/testing";
import type { SqlRun } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { MemoryPromotionService } from "../../src/modules/memory/memory-promotion.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function createRun(runId: string, override: Partial<SqlRun> = {}): SqlRun {
  return {
    runId,
    sessionId: "session-memory-promotion-int",
    question: "统计订单状态分布",
    status: "executionResult",
    provider: "volcengine",
    model: "mock-model",
    sql: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
    answer: "已统计订单状态分布",
    rows: [{ status: "paid", count: 4 }],
    columns: ["status", "count"],
    trace: {
      runId,
      provider: "volcengine",
      retryCount: 0,
      steps: []
    },
    llmRaw: null,
    createdAt: "2026-04-18T00:00:00.000Z",
    ...override
  };
}

describe("memory promotion integration", () => {
  let moduleRef: TestingModule;
  let promotionService: MemoryPromotionService;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("memory-promotion");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    promotionService = moduleRef.get(MemoryPromotionService, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("promotes candidate -> verified -> production and ignores duplicate trigger", async () => {
    const run1 = createRun("run-memory-integration-1");
    const result1 = await promotionService.promoteFromRun({
      run: run1,
      datasourceId: "sqlite_main"
    });

    expect(result1.state).toBe("promoted");
    expect(result1.beforeStatus).toBe("candidate");
    expect(result1.afterStatus).toBe("verified");
    expect(result1.transitionKey).toBeDefined();

    const duplicate = await promotionService.promoteFromRun({
      run: run1,
      datasourceId: "sqlite_main"
    });
    expect(duplicate.state).toBe("duplicate");
    expect(duplicate.rejectionReasons).toEqual(["duplicate_trigger_ignored"]);

    const run2 = createRun("run-memory-integration-2");
    const result2 = await promotionService.promoteFromRun({
      run: run2,
      datasourceId: "sqlite_main"
    });
    expect(result2.state).toBe("held");
    expect(result2.beforeStatus).toBe("verified");
    expect(result2.afterStatus).toBe("verified");
    expect(result2.rejectionReasons).toEqual(
      expect.arrayContaining(["insufficient_samples_for_production"])
    );

    const run3 = createRun("run-memory-integration-3");
    const result3 = await promotionService.promoteFromRun({
      run: run3,
      datasourceId: "sqlite_main"
    });
    expect(result3.state).toBe("promoted");
    expect(result3.beforeStatus).toBe("verified");
    expect(result3.afterStatus).toBe("production");

    const candidateId = promotionService.buildCandidateIdForRun({
      run: run1,
      datasourceId: "sqlite_main"
    });
    const record = promotionService.getRecord(candidateId);
    expect(record?.status).toBe("production");
    expect(record?.evidence.sampleCount).toBe(3);
    expect(record?.evidence.successCount).toBe(3);
    expect(record?.lastTransitionKey).toBe(
      `${candidateId}:verified->production`
    );
  });

  it("holds candidate when risk tags breach threshold and keeps structured rejection reasons", async () => {
    const run = createRun("run-memory-integration-risk-1", {
      delivery: {
        answer: {
          text: "已统计订单状态分布",
          status: "executionResult",
          provider: "volcengine"
        },
        evidence: {
          runId: "run-memory-integration-risk-1",
          riskTags: ["sandbox_denied"]
        }
      }
    });

    const result = await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main"
    });

    expect(result.state).toBe("held");
    expect(result.beforeStatus).toBe("candidate");
    expect(result.afterStatus).toBe("candidate");
    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining(["risk_threshold_exceeded_for_verified"])
    );

    const candidateId = promotionService.buildCandidateIdForRun({
      run,
      datasourceId: "sqlite_main"
    });
    const record = promotionService.getRecord(candidateId);
    expect(record?.status).toBe("candidate");
    expect(record?.evidence.riskFlagCount).toBe(1);
  });
});
