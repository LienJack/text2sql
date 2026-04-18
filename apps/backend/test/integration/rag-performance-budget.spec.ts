import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { RagRerankService } from "../../src/modules/rag/rerank/rag-rerank.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag performance budget integration", () => {
  let moduleRef: TestingModule;
  let retrievalService: RagRetrievalService;
  let rerankService: RagRerankService;
  let indexBuilder: RagIndexBuilderService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-performance-budget");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    retrievalService = moduleRef.get(RagRetrievalService, {
      strict: false
    });
    rerankService = moduleRef.get(RagRerankService, {
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
  });

  it("applies budget degrade ladder on retrieval and rerank under pressure", async () => {
    const datasourceId = "ds-rag-budget";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-budget-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status, paid_at)"
      },
      {
        id: "chunk-budget-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'"
      },
      {
        id: "chunk-budget-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV maps to sum(order amount)"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-budget-v1",
      createdByRunId: "run-budget-build-v1",
      activatedByRunId: "run-budget-build-v1"
    });

    const retrieval = await retrievalService.retrieve({
      query: "orders GMV amount",
      datasourceId,
      runId: "run-budget-retrieval-v1",
      perLaneLimit: 20,
      finalCandidateLimit: 20,
      budgetSignal: {
        costPressure: 0.97,
        latencyPressure: 0.97,
        tokenPressure: 0.99
      }
    });

    expect(retrieval.retrieval_bundle.decision_reasons).toEqual(
      expect.arrayContaining([
        "budget_degrade_cost_extreme",
        "budget_degrade_latency_extreme",
        "budget_degrade_token_extreme",
        "budget_lane_single_lexical",
        "degrade_level=maximum"
      ])
    );
    expect(retrieval.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining([
        "budget_degrade_cost_extreme",
        "budget_degrade_latency_extreme",
        "budget_degrade_token_extreme",
        "budget_lane_disabled_dense",
        "budget_lane_disabled_graph",
        "degrade_level=maximum"
      ])
    );
    expect(retrieval.retrieval_bundle.lane_results.lexical.status).toBe("ok");
    expect(retrieval.retrieval_bundle.lane_results.dense.degrade_reason).toBe(
      "budget_lane_disabled_dense"
    );
    expect(retrieval.retrieval_bundle.lane_results.graph.degrade_reason).toBe(
      "budget_lane_disabled_graph"
    );
    expect(retrieval.retrieval_bundle.candidates.length).toBeLessThanOrEqual(4);

    const reranked = await rerankService.rerank({
      retrievalBundle: retrieval.retrieval_bundle,
      budgetSignal: {
        costPressure: 0.98
      }
    });

    expect(reranked.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["secondary_rerank_disabled_by_budget"])
    );
    expect(reranked.retrieval_bundle.decision_reasons).toEqual(
      expect.arrayContaining([
        "budget_secondary_rerank_disabled_cost_extreme",
        "degrade_level=maximum"
      ])
    );
    expect(
      reranked.retrieval_bundle.reranked?.every((item) => item.secondary_score === undefined)
    ).toBe(true);
  });
});
