import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag incremental refresh integration", () => {
  let moduleRef: TestingModule;
  let eventConsumer: RagEventConsumerService;
  let indexRepository: RagIndexRepository;
  let replayRepository: RagReplayRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-incremental-refresh");
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
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
    replayRepository = moduleRef.get(RagReplayRepository, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("builds and activates a new index version from an incremental event", async () => {
    indexRepository.seedChunksForDatasource("ds-rag-incremental", [
      {
        id: "chunk-incremental-1",
        datasourceId: "ds-rag-incremental",
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-incremental-2",
        datasourceId: "ds-rag-incremental",
        domain: "semantic_term",
        content: "GMV means gross merchandise volume"
      }
    ]);

    const result = await eventConsumer.consumeEvent({
      eventId: "evt-incremental-1",
      datasourceId: "ds-rag-incremental",
      sourceVersion: "schema-v1",
      eventType: "ddl_changed",
      runId: "run-rag-incremental-1",
      sessionId: "session-rag-incremental-1",
      occurredAt: "2026-04-18T02:00:00.000Z"
    });

    expect(result.status).toBe("processed");
    expect(result.indexVersionId).toBeTruthy();

    const activeVersion = await indexRepository.getActiveVersion("ds-rag-incremental");
    expect(activeVersion?.id).toBe(result.indexVersionId);

    const replayRows = await replayRepository.listByRunId("run-rag-incremental-1");
    expect(replayRows.some((row) => row.stage === "incremental_event_received")).toBe(true);
    expect(replayRows.some((row) => row.stage === "incremental_event_processed")).toBe(true);
    expect(replayRows.some((row) => row.stage === "index_build_completed")).toBe(true);
    expect(replayRows.filter((row) => row.stage === "chunk_indexed")).toHaveLength(2);

    const duplicate = await eventConsumer.consumeEvent({
      eventId: "evt-incremental-1",
      datasourceId: "ds-rag-incremental",
      sourceVersion: "schema-v1",
      eventType: "ddl_changed",
      runId: "run-rag-incremental-1"
    });
    expect(duplicate.status).toBe("duplicate");

    const replayAfterDuplicate = await replayRepository.listByRunId("run-rag-incremental-1");
    expect(
      replayAfterDuplicate.filter((row) =>
        row.replayKey.startsWith("incremental:event:received:evt-incremental-1")
      )
    ).toHaveLength(1);
  });

  it("retries failed incremental refresh and sends event to DLQ after max attempts", async () => {
    const runId = "run-rag-incremental-dlq";

    const first = await eventConsumer.consumeEvent({
      eventId: "evt-incremental-dlq-1",
      datasourceId: "ds-rag-incremental-dlq",
      sourceVersion: "schema-v2",
      eventType: "semantic_promoted",
      runId
    });
    const second = await eventConsumer.consumeEvent({
      eventId: "evt-incremental-dlq-1",
      datasourceId: "ds-rag-incremental-dlq",
      sourceVersion: "schema-v2",
      eventType: "semantic_promoted",
      runId
    });
    const third = await eventConsumer.consumeEvent({
      eventId: "evt-incremental-dlq-1",
      datasourceId: "ds-rag-incremental-dlq",
      sourceVersion: "schema-v2",
      eventType: "semantic_promoted",
      runId
    });

    expect(first.status).toBe("retry_scheduled");
    expect(second.status).toBe("retry_scheduled");
    expect(third.status).toBe("dlq");

    const replayRows = await replayRepository.listByRunId(runId);
    expect(replayRows.filter((row) => row.stage === "incremental_event_failed")).toHaveLength(3);

    const activeVersion = await indexRepository.getActiveVersion("ds-rag-incremental-dlq");
    expect(activeVersion).toBeUndefined();
  });
});
