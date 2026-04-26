import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/knowledge/rag/observability/rag-replay.repository";
import { RagRetrievalService } from "../../src/modules/knowledge/rag/retrieval/rag-retrieval.service";
import { ModelRerankerAdapter } from "../../src/modules/rag/rerank/model-reranker.adapter";
import { RagRerankService } from "../../src/modules/knowledge/rag/rerank/rag-rerank.service";

describe("rag rerank integration", () => {
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

  it("generates reranked output and writes primary/secondary/final replay records", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const rerankService = moduleRef.get(RagRerankService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-rerank-int";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-rerank-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-rerank-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-rerank-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV maps to SUM(order amount).",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-rerank-v1",
      createdByRunId: "run-rag-rerank-build-v1",
      activatedByRunId: "run-rag-rerank-build-v1"
    });

    const retrieval = await retrievalService.retrieve({
      query: "GMV amount orders",
      datasourceId,
      runId: "run-rag-rerank-v1"
    });
    const reranked = await rerankService.rerank({
      retrievalBundle: retrieval.retrieval_bundle
    });

    expect(reranked.retrieval_bundle.reranked?.length).toBeGreaterThan(0);
    expect(reranked.retrieval_bundle.selected_context?.length).toBeGreaterThan(0);
    expect(reranked.retrieval_bundle.risk_tags).toBeDefined();
    expect(reranked.retrieval_bundle.context_pack).toBeDefined();
    expect(reranked.retrieval_bundle.context_pack?.selected_context_summary.count).toBe(
      reranked.retrieval_bundle.selected_context?.length ?? 0
    );

    const replayEvents = await replayRepository.listByRunId("run-rag-rerank-v1");
    expect(replayEvents.some((item) => item.replayKey === "rerank:primary")).toBe(true);
    expect(replayEvents.some((item) => item.replayKey === "rerank:secondary")).toBe(true);
    expect(replayEvents.some((item) => item.replayKey === "rerank:final")).toBe(true);
    const secondaryReplay = replayEvents.find(
      (item) => item.replayKey === "rerank:secondary"
    );
    const secondaryPayload = JSON.parse(secondaryReplay?.payload ?? "{}") as {
      metadata?: {
        mode?: string;
        fallback_reason?: string;
      };
    };
    expect(secondaryPayload.metadata?.mode).toBe("mock");
    expect(secondaryPayload.metadata?.fallback_reason).toBe("llm_mock_mode");
    expect(reranked.retrieval_bundle.rerank_metadata?.secondary.mode).toBe("mock");

    await moduleRef.close();
  });

  it("falls back to primary ranking when secondary rerank exceeds timeout budget", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const rerankService = moduleRef.get(RagRerankService);
    const modelAdapter = moduleRef.get(ModelRerankerAdapter);

    jest.spyOn(modelAdapter, "rerankWithMetadata").mockImplementation(
      async () =>
        new Promise((resolvePromise) => {
          setTimeout(() => {
            resolvePromise({
              results: [
                {
                  candidateId: "chunk-timeout-schema",
                  score: 0.9,
                  reason: "late result"
                }
              ],
              metadata: {
                mode: "provider",
                provider: "openai",
                model: "gpt-4.1-mini",
                inputCount: 3,
                outputCount: 1
              }
            });
          }, 30);
        })
    );

    const datasourceId = "ds-rag-rerank-timeout";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-timeout-schema",
        datasourceId,
        domain: "schema",
        content: "table users(id, email)"
      },
      {
        id: "chunk-timeout-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "email identity mapping"
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
      sourceVersion: "source-rag-rerank-timeout-v1",
      createdByRunId: "run-rag-rerank-timeout-build-v1",
      activatedByRunId: "run-rag-rerank-timeout-build-v1"
    });

    const retrieval = await retrievalService.retrieve({
      query: "users email",
      datasourceId,
      runId: "run-rag-rerank-timeout-v1"
    });
    const reranked = await rerankService.rerank({
      retrievalBundle: retrieval.retrieval_bundle,
      secondaryTimeoutMs: 1
    });

    expect(reranked.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["secondary_rerank_timeout"])
    );
    expect(reranked.retrieval_bundle.context_pack?.status).toBe("degraded");
    expect(
      reranked.retrieval_bundle.rerank_metadata?.secondary.unavailable_reason
    ).toBe("secondary_rerank_timeout");
    expect(reranked.retrieval_bundle.reranked?.every((item) => item.secondary_score === undefined)).toBe(
      true
    );

    await moduleRef.close();
  });
});
