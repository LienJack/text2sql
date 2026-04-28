import { Test, type TestingModule } from "@nestjs/testing";
import type { SqlRun } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { MemoryPromotionService } from "../../src/modules/memory/memory-promotion.service";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function createRun(runId: string): SqlRun {
  return {
    runId,
    sessionId: "session-memory-audit-int",
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
    createdAt: "2026-04-18T00:00:00.000Z"
  };
}

function parsePayload(payload: string): Record<string, unknown> {
  return JSON.parse(payload) as Record<string, unknown>;
}

describe("memory promotion audit integration", () => {
  let moduleRef: TestingModule;
  let promotionService: MemoryPromotionService;
  let auditRepository: AuditLogRepository;
  let ragReplayRepository: RagReplayRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("memory-promotion-audit");
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
    auditRepository = moduleRef.get(AuditLogRepository, {
      strict: false
    });
    ragReplayRepository = moduleRef.get(RagReplayRepository, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("writes auditable promotion transition and replay linkage", async () => {
    const run = createRun("run-memory-audit-success-1");
    const result = await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main",
      requestId: "req-memory-audit-success"
    });

    expect(result.state).toBe("promoted");
    const events = await auditRepository.listEvents({
      runId: run.runId,
      eventType: "memory.promotion.transition.applied",
      limit: 20
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata?.candidateId).toBe(result.candidateId);
    expect(events[0]?.metadata?.idempotencyKey).toBe(result.idempotencyKey);
    expect(events[0]?.metadata?.beforeStatus).toBe("candidate");
    expect(events[0]?.metadata?.afterStatus).toBe("verified");
    expect(events[0]?.metadata?.replayKey).toBe(
      `memory:promotion:${result.candidateId}:v1`
    );

    const replay = await ragReplayRepository.listByRunId(run.runId);
    const promotionReplay = replay.find((item) => item.stage === "memory_promotion");
    expect(promotionReplay).toBeDefined();
    expect(promotionReplay?.replayKey).toContain(`memory:promotion:${result.candidateId}`);
    const payload = parsePayload(promotionReplay?.payload ?? "{}");
    expect(payload.auditEventId).toBe(events[0]?.id);
    expect(payload.replayKey).toBe(promotionReplay?.replayKey);
  });

  it("rolls back state on write failure and emits compensating audit signal", async () => {
    const run = createRun("run-memory-audit-rollback-1");
    const candidateId = promotionService.buildCandidateIdForRun({
      run,
      datasourceId: "sqlite_main"
    });
    const writeReplaySpy = jest
      .spyOn(ragReplayRepository, "writeReplay")
      .mockRejectedValue(new Error("forced replay failure"));

    const result = await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main",
      requestId: "req-memory-audit-rollback"
    });

    expect(result.state).toBe("rolled_back");
    expect(result.afterStatus).toBe("candidate");
    expect(result.rejectionReasons).toEqual(["promotion_write_failed"]);

    const record = promotionService.getRecord(candidateId);
    expect(record?.status).toBe("candidate");
    expect(record?.version).toBe(0);

    const compensationEvents = await auditRepository.listEvents({
      runId: run.runId,
      eventType: "memory.promotion.compensated",
      limit: 20
    });
    expect(compensationEvents.length).toBeGreaterThan(0);
    expect(compensationEvents[0]?.metadata?.rollbackTo).toBe("candidate");

    const compensations = promotionService.listCompensations();
    expect(compensations.length).toBeGreaterThan(0);
    expect(compensations[0]?.state).toBe("pending_retry");
    expect(compensations[0]?.attempts).toBe(1);

    writeReplaySpy.mockRestore();
  });

  it("escalates compensation to manual review after repeated write failures", async () => {
    const run = createRun("run-memory-audit-compensation-manual-review");
    const writeReplaySpy = jest
      .spyOn(ragReplayRepository, "writeReplay")
      .mockRejectedValue(new Error("forced replay failure"));

    await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main",
      requestId: "req-memory-audit-compensation-1"
    });
    await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main",
      requestId: "req-memory-audit-compensation-2"
    });
    const thirdAttempt = await promotionService.promoteFromRun({
      run,
      datasourceId: "sqlite_main",
      requestId: "req-memory-audit-compensation-3"
    });

    expect(thirdAttempt.state).toBe("rolled_back");
    expect(thirdAttempt.compensation?.state).toBe("manual_review");
    expect(thirdAttempt.compensation?.attempts).toBe(3);

    const compensations = promotionService.listCompensations();
    expect(compensations).toHaveLength(1);
    expect(compensations[0]?.state).toBe("manual_review");
    expect(compensations[0]?.attempts).toBe(3);

    const compensationEvents = await auditRepository.listEvents({
      runId: run.runId,
      eventType: "memory.promotion.compensated",
      limit: 20
    });
    expect(
      compensationEvents.some(
        (event) =>
          event.eventCode === "PROMOTION_COMPENSATED_MANUAL_REVIEW" &&
          event.metadata?.compensationState === "manual_review"
      )
    ).toBe(true);
    expect(
      compensationEvents.some(
        (event) => event.eventCode === "PROMOTION_COMPENSATED"
      )
    ).toBe(true);
    expect(compensationEvents.length).toBeGreaterThanOrEqual(3);

    writeReplaySpy.mockRestore();
  });
});
