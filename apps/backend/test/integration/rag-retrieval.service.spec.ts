import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/knowledge/rag/observability/rag-replay.repository";
import { RagRetrievalService } from "../../src/modules/knowledge/rag/retrieval/rag-retrieval.service";
import { ModelingGraphRepository } from "../../src/modules/platform/data/persistence/modeling-graph.repository";

describe("rag retrieval service integration", () => {
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

  it("returns reproducible candidates and keeps domain coverage across schema/sql_example/semantic_term", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-retrieval-coverage";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status, created_at)",
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status", "created_at"]
        })
      },
      {
        id: "chunk-sql-orders",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          chunkProfile: "sql_example",
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-semantic-gmv",
        datasourceId,
        domain: "semantic_term",
        content: "GMV means gross merchandise volume and maps to order amount.",
        metadata: JSON.stringify({
          chunkProfile: "semantic_term",
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-v1",
      createdByRunId: "run-rag-retrieval-build-v1",
      activatedByRunId: "run-rag-retrieval-build-v1"
    });

    const first = await retrievalService.retrieve({
      query: "orders amount GMV",
      datasourceId,
      runId: "run-rag-retrieval-v1",
      perLaneLimit: 10,
      finalCandidateLimit: 10
    });
    const second = await retrievalService.retrieve({
      query: "orders amount GMV",
      datasourceId,
      runId: "run-rag-retrieval-v2",
      perLaneLimit: 10,
      finalCandidateLimit: 10
    });

    const firstIds = first.retrieval_bundle.candidates.map((item) => item.chunk_id);
    const secondIds = second.retrieval_bundle.candidates.map((item) => item.chunk_id);
    const coveredDomains = new Set(
      first.retrieval_bundle.candidates.map((item) => item.chunk.metadata.domain)
    );

    expect(first.retrieval_bundle.index_version_id).toBeTruthy();
    expect(first.retrieval_bundle.lane_results.lexical.status).toBe("ok");
    expect(first.retrieval_bundle.lane_results.dense.status).toBe("ok");
    expect(first.retrieval_bundle.lane_results.graph.status).toBe("ok");
    expect(first.retrieval_bundle.context_pack).toBeDefined();
    expect(first.retrieval_bundle.context_pack?.status).toBe(first.retrieval_bundle.status);
    expect(first.retrieval_bundle.context_pack?.semantic_lock_status).toBe(
      first.retrieval_bundle.status === "ready" ? "locked" : "degraded"
    );
    expect(firstIds.length).toBeGreaterThan(0);
    expect(firstIds).toEqual(secondIds);
    expect(coveredDomains.has("schema")).toBe(true);
    expect(coveredDomains.has("sql_example")).toBe(true);
    expect(coveredDomains.has("semantic_term")).toBe(true);

    const replayEvents = await replayRepository.listByRunId("run-rag-retrieval-v1");
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:lexical")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:dense")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:graph")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:fused")).toBe(true);

    await moduleRef.close();
  });

  it("degrades a timed-out lane but still returns candidates from healthy lanes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-timeout";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-timeout-schema",
        datasourceId,
        domain: "schema",
        content: "table users(id, email, created_at)"
      },
      {
        id: "chunk-timeout-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT COUNT(*) FROM users"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-timeout-v1",
      createdByRunId: "run-rag-retrieval-timeout-build-v1",
      activatedByRunId: "run-rag-retrieval-timeout-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "users count",
      datasourceId,
      runId: "run-rag-retrieval-timeout-v1",
      laneTimeoutMs: {
        dense: 1
      },
      laneArtificialDelayMs: {
        dense: 20
      }
    });

    expect(response.retrieval_bundle.lane_results.dense.status).toBe("degraded");
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["dense_timeout"])
    );
    expect(response.retrieval_bundle.context_pack?.status).toBe("degraded");
    expect(response.retrieval_bundle.context_pack?.degrade_reasons).toEqual(
      expect.arrayContaining(["dense_timeout"])
    );
    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);

    await moduleRef.close();
  });

  it("returns degraded bundle when datasource has no active index", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const retrievalService = moduleRef.get(RagRetrievalService);

    const response = await retrievalService.retrieve({
      query: "orders",
      datasourceId: "ds-rag-retrieval-no-active-index",
      runId: "run-rag-retrieval-no-active-index"
    });

    expect(response.retrieval_bundle.status).toBe("degraded");
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["no_active_index"])
    );
    expect(response.retrieval_bundle.context_pack?.status).toBe("degraded");
    expect(response.retrieval_bundle.candidates).toHaveLength(0);

    await moduleRef.close();
  });

  it("injects active modeling revision into context pack when workspace scope exists", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const modelingGraphRepository = moduleRef.get(ModelingGraphRepository);

    const datasourceId = "ds-rag-retrieval-modeling-revision";
    const workspaceId = "ws-rag-retrieval-modeling-revision";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-schema-revision",
        datasourceId,
        domain: "schema",
        content: "table payments(id, amount)",
        metadata: JSON.stringify({
          tableNames: ["payments"],
          columnNames: ["id", "amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-modeling-revision-v1",
      createdByRunId: "run-rag-retrieval-modeling-revision-build-v1",
      activatedByRunId: "run-rag-retrieval-modeling-revision-build-v1"
    });

    const revision = await modelingGraphRepository.appendDraftRevision({
      workspaceId,
      datasourceId,
      graphHash: "graph-hash-modeling-revision-v1",
      graphPayload: {
        models: [],
        relationships: [],
        calculatedFields: [],
        views: [],
        schemaChanges: []
      },
      actorId: "system"
    });
    await modelingGraphRepository.markActiveRevision({
      workspaceId,
      datasourceId,
      revision: revision.revision,
      actorId: "system"
    });

    const response = await retrievalService.retrieve({
      query: "payments amount",
      datasourceId,
      workspaceId,
      runId: "run-rag-retrieval-modeling-revision-v1"
    });

    expect(response.retrieval_bundle.context_pack?.modeling_revision).toBe(revision.revision);
    await moduleRef.close();
  });
});
