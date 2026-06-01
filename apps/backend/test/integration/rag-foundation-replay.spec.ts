import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { AppModule } from "../../src/app.module";
import { BuildRagIndexJob } from "../../src/modules/rag/jobs/build-rag-index.job";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";

describe("rag foundation replay repository", () => {
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

  it("writes replay events and reconstructs run-level index/document/chunk lineage", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [RagReplayRepository]
    }).compile();
    const repository = moduleRef.get(RagReplayRepository);

    const runId = "run-rag-replay-1";
    const datasourceId = "ds-rag-replay";
    const indexVersionId = "idx-rag-v1";
    const documentId = "doc-orders-v1";
    const chunkId = "chunk-orders-v1-001";

    await repository.writeReplay({
      runId,
      replayKey: "index:build:completed",
      datasourceId,
      stage: "index_build_completed",
      indexVersionId,
      payload: {
        sourceVersion: "source-v1",
        chunkCount: 32
      },
      createdAt: "2026-04-17T00:00:01.000Z"
    });
    await repository.writeReplay({
      runId,
      replayKey: "document:indexed:orders",
      datasourceId,
      stage: "document_indexed",
      indexVersionId,
      documentId,
      payload: {
        domain: "schema",
        tableNames: ["orders"]
      },
      createdAt: "2026-04-17T00:00:02.000Z"
    });
    await repository.writeReplay({
      runId,
      replayKey: "chunk:indexed:orders:001",
      datasourceId,
      stage: "chunk_indexed",
      indexVersionId,
      documentId,
      chunkId,
      payload: {
        chunkOrder: 1,
        lexicalMode: "plain_text"
      },
      createdAt: "2026-04-17T00:00:03.000Z"
    });

    const replayEvents = await repository.listByRunId(runId);

    expect(replayEvents).toHaveLength(3);
    expect(replayEvents.map((item) => item.replayKey)).toEqual([
      "index:build:completed",
      "document:indexed:orders",
      "chunk:indexed:orders:001"
    ]);

    const eventByKey = new Map(replayEvents.map((item) => [item.replayKey, item]));
    expect(eventByKey.get("index:build:completed")?.indexVersionId).toBe(indexVersionId);
    expect(eventByKey.get("document:indexed:orders")?.documentId).toBe(documentId);
    expect(eventByKey.get("chunk:indexed:orders:001")?.chunkId).toBe(chunkId);

    const chunkPayload = JSON.parse(
      eventByKey.get("chunk:indexed:orders:001")?.payload ?? "{}"
    ) as Record<string, unknown>;
    expect(chunkPayload.chunkOrder).toBe(1);
    expect(chunkPayload.lexicalMode).toBe("plain_text");

    await moduleRef.close();
  });

  it("upserts same replay key and keeps latest payload for the run", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [RagReplayRepository]
    }).compile();
    const repository = moduleRef.get(RagReplayRepository);

    await repository.writeReplay({
      runId: "run-rag-replay-upsert",
      replayKey: "index:build:completed",
      datasourceId: "ds-rag-replay",
      stage: "index_build_completed",
      indexVersionId: "idx-rag-v1",
      payload: {
        chunkCount: 10,
        attempt: 1
      },
      createdAt: "2026-04-17T00:10:00.000Z"
    });
    await repository.writeReplay({
      runId: "run-rag-replay-upsert",
      replayKey: "index:build:completed",
      datasourceId: "ds-rag-replay",
      stage: "index_build_completed",
      indexVersionId: "idx-rag-v2",
      payload: {
        chunkCount: 12,
        attempt: 2
      },
      createdAt: "2026-04-17T00:10:01.000Z"
    });

    const replayEvents = await repository.listByRunId("run-rag-replay-upsert");

    expect(replayEvents).toHaveLength(1);
    expect(replayEvents[0]?.indexVersionId).toBe("idx-rag-v2");
    expect(JSON.parse(replayEvents[0]?.payload ?? "{}")).toMatchObject({
      chunkCount: 12,
      attempt: 2
    });

    const single = await repository.getReplay(
      "run-rag-replay-upsert",
      "index:build:completed"
    );
    expect(single?.indexVersionId).toBe("idx-rag-v2");

    await moduleRef.close();
  });

  it("writes build + chunk replay events from the real index build job", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const indexRepository = moduleRef.get(RagIndexRepository);
    const buildJob = moduleRef.get(BuildRagIndexJob);
    const replayRepository = moduleRef.get(RagReplayRepository);

    indexRepository.seedChunksForDatasource("ds-rag-replay-job", [
      {
        id: "chunk-replay-job-1",
        datasourceId: "ds-rag-replay-job",
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-replay-job-2",
        datasourceId: "ds-rag-replay-job",
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'"
      }
    ]);

    const result = await buildJob.run({
      datasourceId: "ds-rag-replay-job",
      sourceVersion: "source-replay-job-v1",
      runId: "run-rag-replay-job",
      manifest: {
        fingerprint: "semantic-assets-replay-v1",
        summary: {
          entryCount: 1,
          preparedEntryCount: 1,
          familyCounts: {
            table_description: 1
          },
          reasonCodes: ["prepared"]
        },
        entries: [
          {
            id: "manifest-entry-replay-orders",
            family: "table_description",
            status: "prepared",
            sourceRef: { type: "datasource_schema", ref: "orders.description" },
            sourceVersion: "schema-v1",
            reasonCodes: ["prepared"]
          }
        ]
      }
    });

    const replayEvents = await replayRepository.listByRunId("run-rag-replay-job");
    expect(result.status).toBe("active");
    expect(replayEvents.some((item) => item.stage === "manifest_prepared")).toBe(true);
    expect(replayEvents.some((item) => item.stage === "index_build_started")).toBe(true);
    expect(replayEvents.some((item) => item.stage === "index_build_completed")).toBe(true);
    expect(replayEvents.some((item) => item.stage === "index_activation_completed")).toBe(true);
    expect(replayEvents.filter((item) => item.stage === "chunk_indexed").length).toBe(2);
    const completedPayload = JSON.parse(
      replayEvents.find((item) => item.stage === "index_build_completed")?.payload ?? "{}"
    );
    expect(completedPayload.manifestFingerprint).toBe("semantic-assets-replay-v1");
    expect(
      replayEvents.some((item) => item.replayKey === "chunk:indexed:chunk-replay-job-1")
    ).toBe(true);
    expect(
      replayEvents.some((item) => item.replayKey === "chunk:indexed:chunk-replay-job-2")
    ).toBe(true);

    await moduleRef.close();
  });
});
