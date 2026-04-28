import { Test, type TestingModule } from "@nestjs/testing";
import type { SqlRun } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { RagAuditReplayService } from "../../src/modules/rag/audit/rag-audit-replay.service";
import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function createRun(runId: string): SqlRun {
  const stageOrder = [
    "intake",
    "retrieve",
    "assemble-context",
    "semantic-plan",
    "generate-sql",
    "validate",
    "correct",
    "execute",
    "answer"
  ] as const;
  return {
    runId,
    sessionId: "session-rag-audit-1",
    question: "按状态统计订单数量",
    status: "executionResult",
    provider: "volcengine",
    model: "mock-model",
    sql: "SELECT status, COUNT(*) AS total FROM orders GROUP BY status",
    answer: "按状态统计完成",
    rows: [{ status: "paid", total: 4 }],
    columns: ["status", "total"],
    trace: {
      runId,
      provider: "volcengine",
      retryCount: 0,
      steps: [],
      v2: {
        version: "v2",
        stageOrder: [...stageOrder],
        stages: stageOrder.map((stage) => ({
          stage,
          status:
            stage === "correct"
              ? ("skipped" as const)
              : ("success" as const)
        }))
      }
    },
    llmRaw: null,
    createdAt: "2026-04-18T03:00:00.000Z"
  };
}

describe("rag audit replay integration", () => {
  let moduleRef: TestingModule;
  let eventConsumer: RagEventConsumerService;
  let auditReplayService: RagAuditReplayService;
  let indexRepository: RagIndexRepository;
  let replayRepository: RagReplayRepository;
  let auditLogRepository: AuditLogRepository;
  let chatRepository: ChatRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-audit-replay");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    eventConsumer = moduleRef.get(RagEventConsumerService, {
      strict: false
    });
    auditReplayService = moduleRef.get(RagAuditReplayService, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
    replayRepository = moduleRef.get(RagReplayRepository, {
      strict: false
    });
    auditLogRepository = moduleRef.get(AuditLogRepository, {
      strict: false
    });
    chatRepository = moduleRef.get(ChatRepository, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("returns event -> index_version -> run trace chain for processed incremental event", async () => {
    const runId = "run-rag-audit-chain-1";
    await chatRepository.persistRun(createRun(runId));

    indexRepository.seedChunksForDatasource("ds-rag-audit", [
      {
        id: "chunk-rag-audit-1",
        datasourceId: "ds-rag-audit",
        domain: "schema",
        content: "table orders(id, status, amount)"
      }
    ]);

    const consumeResult = await eventConsumer.consumeEvent({
      eventId: "evt-rag-audit-1",
      datasourceId: "ds-rag-audit",
      sourceVersion: "schema-v3",
      eventType: "sql_feedback_positive",
      runId,
      sessionId: "session-rag-audit-1",
      occurredAt: "2026-04-18T03:01:00.000Z"
    });

    expect(consumeResult.status).toBe("processed");

    const chain = await auditReplayService.queryChain({ runId });
    expect(chain.runId).toBe(runId);
    expect(chain.runTrace?.runId).toBe(runId);
    expect(chain.events).toHaveLength(1);

    const event = chain.events[0];
    expect(event?.eventId).toBe("evt-rag-audit-1");
    expect(event?.status).toBe("processed");
    expect(event?.indexVersion?.id).toBe(consumeResult.indexVersionId);
    expect(event?.replayToken).toMatch(/^replay-/);
    expect(event?.audits.some((item) => item.eventType === "rag.incremental-refresh.processed")).toBe(
      true
    );
    expect(event?.replay.some((item) => item.stage === "incremental_event_processed")).toBe(
      true
    );
  });

  it("keeps correction grounding visible in replay runTrace.v2", async () => {
    const runId = "run-rag-audit-correction-grounding";
    await chatRepository.persistRun({
      ...createRun(runId),
      trace: {
        ...createRun(runId).trace,
        v2: {
          ...(createRun(runId).trace.v2 as NonNullable<SqlRun["trace"]["v2"]>),
          sqlGeneration: {
            sql: "SELECT orders.id FROM orders",
            usedTables: ["orders"],
            usedColumns: ["orders.id"],
            evidenceRefs: ["chunk-orders-1"],
            correctionGrounding: {
              failedSqlRef: "sql.sha256.abc123abc123abcd",
              retryReason: "missing column orders.missing_city",
              attemptCount: 1,
              maxAttempts: 2,
              evidenceRefs: ["chunk-orders-1"]
            }
          }
        }
      }
    });

    const chain = await auditReplayService.queryChain({ runId });
    expect(chain.runTrace?.v2?.sqlGeneration?.correctionGrounding).toMatchObject({
      failedSqlRef: "sql.sha256.abc123abc123abcd",
      retryReason: "missing column orders.missing_city",
      attemptCount: 1,
      maxAttempts: 2
    });
  });

  it("returns dlq status and failure reason for unrecoverable event", async () => {
    const runId = "run-rag-audit-chain-dlq";
    await chatRepository.persistRun(createRun(runId));

    await eventConsumer.consumeEvent({
      eventId: "evt-rag-audit-dlq-1",
      datasourceId: "ds-rag-audit-dlq",
      sourceVersion: "schema-v4",
      eventType: "semantic_promoted",
      runId
    });
    await eventConsumer.consumeEvent({
      eventId: "evt-rag-audit-dlq-1",
      datasourceId: "ds-rag-audit-dlq",
      sourceVersion: "schema-v4",
      eventType: "semantic_promoted",
      runId
    });
    await eventConsumer.consumeEvent({
      eventId: "evt-rag-audit-dlq-1",
      datasourceId: "ds-rag-audit-dlq",
      sourceVersion: "schema-v4",
      eventType: "semantic_promoted",
      runId
    });

    const chain = await auditReplayService.queryChain({ runId });
    expect(chain.events).toHaveLength(1);
    const event = chain.events[0];
    expect(event?.status).toBe("dlq");
    expect(event?.failureReason).toEqual(
      expect.stringMatching(/索引构建输入为空|semantic_promoted_linkage_failed/)
    );
    expect(event?.indexVersion).toBeUndefined();

    const windowed = await auditReplayService.queryChain({
      runId,
      fromAt: "2100-01-01T00:00:00.000Z"
    });
    expect(windowed.events).toHaveLength(0);
  });

  it("fails with deterministic hard-cut semantics for legacy run replay reads", async () => {
    const runId = "run-rag-audit-legacy";
    await chatRepository.persistRun({
      ...createRun(runId),
      trace: {
        runId,
        provider: "volcengine",
        retryCount: 0,
        steps: []
      }
    });

    await expect(auditReplayService.queryChain({ runId })).rejects.toMatchObject({
      code: "LEGACY_RUN_UNSUPPORTED",
      statusCode: 410,
      details: expect.objectContaining({
        runId,
        expectedContract: "text2sql-v2-read-model",
        requiredMarkers: {
          version: "run.trace.v2.version === 'v2'",
          stageOrder: "run.trace.v2.stageOrder.length > 0",
          stageArtifacts: "run.trace.v2.stages.length > 0"
        },
        migrationRunbook:
          "docs/runbooks/text2sql-v2-hardcut-read-model-migration.md"
      })
    });
  });

  it("keeps requestId-only replay lookups non-leaky for legacy run traces", async () => {
    const runId = "run-rag-audit-legacy-request-only";
    const requestId = "req-rag-audit-legacy-request-only";
    const eventId = "evt-rag-audit-request-only-1";
    await chatRepository.persistRun({
      ...createRun(runId),
      trace: {
        runId,
        provider: "volcengine",
        retryCount: 0,
        steps: []
      }
    });

    await replayRepository.writeReplay({
      runId,
      replayKey: "incremental:event:received:evt-rag-audit-request-only-1",
      datasourceId: "ds-rag-audit-request-only",
      stage: "incremental_event_received",
      payload: {
        eventId,
        eventType: "sql_feedback_positive",
        datasourceId: "ds-rag-audit-request-only",
        sourceVersion: "schema-v5",
        idempotencyKey: "idem-rag-audit-request-only-1",
        replayToken: "replay-rag-audit-request-only-1",
        requestId,
        occurredAt: "2026-04-18T03:21:00.000Z",
        attempt: 1
      },
      createdAt: "2026-04-18T03:21:00.000Z"
    });
    await auditLogRepository.appendEvent({
      runId,
      requestId,
      phase: "rag_incremental_refresh",
      severity: "info",
      eventType: "rag.incremental-refresh.processed",
      eventCode: "EVENT_PROCESSED",
      message: `incremental refresh event ${eventId} applied`,
      metadata: {
        eventId
      },
      createdAt: "2026-04-18T03:21:01.000Z"
    });

    const chain = await auditReplayService.queryChain({ requestId });
    expect(chain.runId).toBe(runId);
    expect(chain.runTrace).toBeUndefined();
    expect(chain.events).toHaveLength(1);
    expect(chain.events[0]?.requestId).toBe(requestId);
  });

  it("keeps missing-run requests non-leaky and deterministic", async () => {
    const chain = await auditReplayService.queryChain({
      runId: "run-rag-audit-missing"
    });

    expect(chain.runId).toBe("run-rag-audit-missing");
    expect(chain.events).toEqual([]);
    expect(chain.runTrace).toBeUndefined();
  });
});
