import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import { RagRerankService } from "../../src/modules/rag/rerank/rag-rerank.service";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag incremental refresh integration", () => {
  let moduleRef: TestingModule;
  let eventConsumer: RagEventConsumerService;
  let indexRepository: RagIndexRepository;
  let replayRepository: RagReplayRepository;
  let retrievalService: RagRetrievalService;
  let rerankService: RagRerankService;
  let semanticRegistryService: SemanticRegistryService;
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
    retrievalService = moduleRef.get(RagRetrievalService, {
      strict: false
    });
    rerankService = moduleRef.get(RagRerankService, {
      strict: false
    });
    semanticRegistryService = moduleRef.get(SemanticRegistryService, {
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

  it("promotes glossary semantic payload with winner selection and surfaces selected_context hit clues", async () => {
    const datasourceId = "ds-rag-semantic-promoted";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-semantic-promoted-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-semantic-promoted-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) AS gmv FROM orders"
      }
    ]);

    const consume = await eventConsumer.consumeEvent({
      eventId: "evt-semantic-promoted-1",
      datasourceId,
      sourceVersion: "glossary-v1",
      eventType: "semantic_promoted",
      runId: "run-semantic-promoted-1",
      requestId: "req-glossary-semantic-promoted-1",
      payload: {
        linkageStatus: "success",
        glossaryTerms: [
          {
            id: "gterm-global-1",
            term: "GMV",
            definition: "global gmv",
            scope: "global",
            priority: 60,
            updatedAt: "2026-04-18T02:00:00.000Z"
          },
          {
            id: "gterm-ds-winner",
            term: "GMV",
            definition: "datasource gmv winner",
            scope: "datasource",
            datasourceId,
            priority: 90,
            updatedAt: "2026-04-18T02:01:00.000Z"
          },
          {
            id: "gterm-ds-loser",
            term: "GMV",
            definition: "datasource gmv loser despite newer timestamp",
            scope: "datasource",
            datasourceId,
            priority: 80,
            updatedAt: "2026-04-18T02:02:00.000Z"
          }
        ]
      }
    });

    expect(consume.status).toBe("processed");
    expect(consume.indexVersionId).toBeTruthy();

    const activeVersion = await indexRepository.getActiveVersion(datasourceId);
    expect(activeVersion?.id).toBe(consume.indexVersionId);

    const entries = await indexRepository.listEntriesByVersion(consume.indexVersionId as string);
    const semanticEntries = entries.filter((item) => item.domain === "semantic_term");
    expect(semanticEntries.length).toBeGreaterThan(0);
    expect(
      semanticEntries.some((item) => item.lexicalContent.includes("datasource gmv winner"))
    ).toBe(true);
    expect(
      semanticEntries.some((item) =>
        item.lexicalContent.includes("datasource gmv loser despite newer timestamp")
      )
    ).toBe(false);

    const retrieval = await retrievalService.retrieve({
      query: "GMV",
      datasourceId,
      runId: "run-semantic-promoted-retrieval-1"
    });
    const reranked = await rerankService.rerank({
      retrievalBundle: retrieval.retrieval_bundle,
      secondaryEnabled: false
    });
    const semanticSelectedContext = reranked.retrieval_bundle.selected_context?.find(
      (item) => item.metadata.domain === "semantic_term"
    );

    expect(semanticSelectedContext).toBeDefined();
    expect(
      semanticSelectedContext?.metadata.sourceMetadata as {
        semanticHitClues?: string[];
      }
    ).toEqual(
      expect.objectContaining({
        semanticHitClues: expect.arrayContaining(["semantic_hit:glossary"])
      })
    );

    const semanticResolved = await semanticRegistryService.resolveTerm({
      domain: "semantic_term",
      datasourceId,
      term: "gmv"
    });
    expect(semanticResolved.status).toBe("ready");
    expect(semanticResolved.matched_scope).toBe("datasource");
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
    expect(first.failureReason).toBe("semantic_promoted_linkage_failed");
    expect(second.failureReason).toBe("semantic_promoted_linkage_failed");
    expect(third.failureReason).toBe("semantic_promoted_linkage_failed");

    const replayRows = await replayRepository.listByRunId(runId);
    expect(replayRows.filter((row) => row.stage === "incremental_event_failed")).toHaveLength(3);

    const activeVersion = await indexRepository.getActiveVersion("ds-rag-incremental-dlq");
    expect(activeVersion).toBeUndefined();
  });
});
