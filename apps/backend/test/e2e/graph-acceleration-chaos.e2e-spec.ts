import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("graph acceleration chaos e2e", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("graph-acceleration-chaos");
    cleanupFixture = fixture.cleanup;

    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    process.env.GRAPH_ACCELERATION_ENABLED = "true";
    process.env.GRAPH_ACCELERATION_FORCE_FAILURE = "timeout";
    process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD = "1";
    process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS = "80";
    process.env.GRAPH_ACCELERATION_FORCE_POSTGRES_ONLY = "false";
    process.env.GRAPH_ACCELERATION_LATENCY_DEGRADE_THRESHOLD_MS = "5000";
    process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_THRESHOLD = "1";
    process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_MIN_SAMPLES = "100";

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
    delete process.env.GRAPH_ACCELERATION_LATENCY_DEGRADE_THRESHOLD_MS;
    delete process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_THRESHOLD;
    delete process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_MIN_SAMPLES;
  });

  it("falls back during chaos, then auto-recovers after breaker cooldown", async () => {
    const datasourceId = "ds-graph-chaos";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-chaos-orders",
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
        id: "chunk-chaos-semantic",
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
      sourceVersion: "source-graph-chaos-v1",
      createdByRunId: "run-graph-chaos-build-v1",
      activatedByRunId: "run-graph-chaos-build-v1"
    });

    const first = await retrievalService.retrieve({
      query: "orders relationship chaos first",
      datasourceId,
      runId: "run-graph-chaos-v1"
    });
    expect(first.retrieval_bundle.lane_results.graph.status).toBe("degraded");
    expect(first.retrieval_bundle.lane_results.graph.degrade_reason).toContain(
      "graph_acceleration_breaker_open_consecutive_failures"
    );

    delete process.env.GRAPH_ACCELERATION_FORCE_FAILURE;

    const second = await retrievalService.retrieve({
      query: "orders relationship chaos second",
      datasourceId,
      runId: "run-graph-chaos-v2"
    });
    expect(second.retrieval_bundle.lane_results.graph.status).toBe("degraded");
    expect(second.retrieval_bundle.lane_results.graph.degrade_reason).toContain(
      "graph_acceleration_breaker_open_consecutive_failures"
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const third = await retrievalService.retrieve({
      query: "orders relationship chaos third",
      datasourceId,
      runId: "run-graph-chaos-v3"
    });
    expect(third.retrieval_bundle.lane_results.graph.status).toBe("ok");
    expect(third.retrieval_bundle.lane_results.graph.hits.length).toBeGreaterThan(0);
    expect(third.retrieval_bundle.lane_results.graph.hits[0]?.evidence).toContain(
      "graph:accelerated"
    );
  });
});
