import { Test, type TestingModule } from "@nestjs/testing";
import type { SqlRun } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { RagAuditReplayService } from "../../src/modules/rag/audit/rag-audit-replay.service";
import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function createRun(runId: string): SqlRun {
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
      steps: [
        {
          node: "retrieve_context",
          status: "success",
          detail: "retrieval completed",
          at: "2026-04-18T03:00:00.000Z"
        }
      ]
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
});
