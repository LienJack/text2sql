import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("graph acceleration fallback integration", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("graph-acceleration-fallback");
    cleanupFixture = fixture.cleanup;

    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    process.env.GRAPH_ACCELERATION_ENABLED = "true";
    process.env.GRAPH_ACCELERATION_FORCE_FAILURE = "error";
    process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD = "8";
    process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS = "5000";
    process.env.GRAPH_ACCELERATION_FORCE_POSTGRES_ONLY = "false";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    retrievalService = moduleRef.get(RagRetrievalService, {
      strict: false
    });
    indexBuilder = moduleRef.get(RagIndexBuilderService, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
    delete process.env.GRAPH_ACCELERATION_ENABLED;
    delete process.env.GRAPH_ACCELERATION_FORCE_FAILURE;
    delete process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD;
    delete process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS;
    delete process.env.GRAPH_ACCELERATION_FORCE_POSTGRES_ONLY;
  });

  it("falls back to heuristic graph lane when acceleration adapter errors", async () => {
    const datasourceId = "ds-graph-acceleration-fallback";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-fallback-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, user_id, amount)",
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["orders"],
          columnNames: ["id", "user_id", "amount"]
        })
      },
      {
        id: "chunk-fallback-schema-users",
        datasourceId,
        domain: "schema",
        content: "table users(id, email)",
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["users"],
          columnNames: ["id", "email"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-graph-fallback-v1",
      createdByRunId: "run-graph-fallback-build-v1",
      activatedByRunId: "run-graph-fallback-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders users relationship foreign key",
      datasourceId,
      runId: "run-graph-fallback-v1"
    });

    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);
    expect(response.retrieval_bundle.lane_results.graph.status).toBe("degraded");
    expect(response.retrieval_bundle.lane_results.graph.degrade_reason).toBe(
      "graph_acceleration_error_fallback"
    );
    expect(response.retrieval_bundle.lane_results.graph.hits.length).toBeGreaterThan(0);
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["graph_acceleration_error_fallback"])
    );
  });

  it("keeps postgres/mainline graph heuristic behavior when acceleration is disabled by default", async () => {
    process.env.GRAPH_ACCELERATION_ENABLED = "false";
    process.env.GRAPH_ACCELERATION_FORCE_FAILURE = "timeout";

    const datasourceId = "ds-graph-acceleration-default-disabled";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-default-disabled-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, user_id, amount)",
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["orders"],
          columnNames: ["id", "user_id", "amount"]
        })
      },
      {
        id: "chunk-default-disabled-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV references order amount",
        metadata: JSON.stringify({
          chunkProfile: "semantic_term",
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-graph-default-disabled-v1",
      createdByRunId: "run-graph-default-disabled-build-v1",
      activatedByRunId: "run-graph-default-disabled-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders amount relationship",
      datasourceId,
      runId: "run-graph-default-disabled-v1"
    });

    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);
    expect(response.retrieval_bundle.lane_results.graph.status).toBe("ok");
    expect(response.retrieval_bundle.lane_results.graph.degrade_reason).toBeUndefined();
    expect(response.retrieval_bundle.degrade_reasons).not.toEqual(
      expect.arrayContaining([
        "graph_acceleration_error_fallback",
        "graph_acceleration_timeout_fallback"
      ])
    );
  });
});
