import { RagRerankService } from "../../src/modules/rag/rerank/rag-rerank.service";
import type { ModelRerankerAdapter } from "../../src/modules/rag/rerank/model-reranker.adapter";
import type { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import type { RagRetrievalBundle } from "../../src/modules/rag/retrieval/rag-retrieval.types";
import { RagBudgetPolicy } from "../../src/modules/rag/perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../../src/modules/rag/perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../../src/modules/rag/perf/rag-query-cache.service";
import type { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";

const createBundle = (): RagRetrievalBundle => ({
  query: "orders amount",
  run_id: "run-rerank-unit",
  datasource_id: "ds-rerank-unit",
  index_version_id: "idx-rerank-unit",
  status: "ready",
  degrade_reasons: [],
  lane_results: {
    lexical: {
      lane: "lexical",
      status: "ok",
      timeout_ms: 100,
      elapsed_ms: 10,
      hits: []
    },
    dense: {
      lane: "dense",
      status: "ok",
      timeout_ms: 100,
      elapsed_ms: 11,
      hits: []
    },
    graph: {
      lane: "graph",
      status: "ok",
      timeout_ms: 100,
      elapsed_ms: 12,
      hits: []
    }
  },
  candidates: [
    {
      chunk_id: "chunk-a",
      source_lane: "lexical",
      evidence: ["token:orders"],
      score: 0.7,
      lane_scores: { lexical: 0.7 },
      lane_ranks: { lexical: 1 },
      chunk: {
        chunk_id: "chunk-a",
        content: "table orders(id, amount)",
        metadata: {
          datasourceId: "ds-rerank-unit",
          indexVersionId: "idx-rerank-unit",
          chunkId: "chunk-a",
          domain: "schema",
          tableNames: ["orders"],
          columnNames: ["id", "amount"],
          sourceMetadata: {}
        }
      }
    },
    {
      chunk_id: "chunk-b",
      source_lane: "dense",
      evidence: ["cosine:0.8"],
      score: 0.6,
      lane_scores: { dense: 0.8 },
      lane_ranks: { dense: 1 },
      chunk: {
        chunk_id: "chunk-b",
        content: "GMV means gross merchandise volume",
        metadata: {
          datasourceId: "ds-rerank-unit",
          indexVersionId: "idx-rerank-unit",
          chunkId: "chunk-b",
          domain: "semantic_term",
          tableNames: ["orders"],
          columnNames: ["amount"],
          sourceMetadata: {}
        }
      }
    }
  ]
});

describe("rag rerank service", () => {
  function createService(
    adapter: Pick<ModelRerankerAdapter, "rerankWithMetadata">,
    replay: Pick<RagReplayRepository, "writeReplay">
  ): RagRerankService {
    return new RagRerankService(
      adapter as ModelRerankerAdapter,
      replay as RagReplayRepository,
      new RagBudgetPolicy(),
      new RagCacheKeyFactory(),
      new RagQueryCacheService(),
      ({
        recordCacheBudget: jest.fn()
      } as unknown) as RagQualityService
    );
  }

  it("skips secondary rerank when candidate count is below threshold", async () => {
    const adapter: Pick<ModelRerankerAdapter, "rerankWithMetadata"> = {
      rerankWithMetadata: jest.fn().mockResolvedValue({
        results: [],
        metadata: {
          mode: "mock",
          inputCount: 0,
          outputCount: 0
        }
      })
    };
    const replay: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(adapter, replay);
    const bundle = createBundle();

    const response = await service.rerank({
      retrievalBundle: bundle,
      secondaryMinCandidates: 10
    });

    expect(adapter.rerankWithMetadata).not.toHaveBeenCalled();
    expect(response.retrieval_bundle.reranked?.length).toBe(2);
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["secondary_rerank_skipped_low_candidates"])
    );
  });

  it("falls back to primary ranking when secondary rerank fails", async () => {
    const adapter: Pick<ModelRerankerAdapter, "rerankWithMetadata"> = {
      rerankWithMetadata: jest.fn().mockRejectedValue(new Error("secondary_model_unavailable"))
    };
    const replay: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(adapter, replay);
    const bundle = createBundle();

    const response = await service.rerank({
      retrievalBundle: bundle,
      secondaryMinCandidates: 2
    });

    expect(adapter.rerankWithMetadata).toHaveBeenCalledTimes(1);
    expect(response.retrieval_bundle.reranked?.every((item) => item.secondary_score === undefined)).toBe(
      true
    );
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["secondary_rerank_unavailable_secondary_model_unavailable"])
    );
    expect(response.retrieval_bundle.rerank_metadata?.secondary.unavailable_reason).toBe(
      "secondary_rerank_unavailable_secondary_model_unavailable"
    );
  });

  it("applies secondary scores when model rerank succeeds", async () => {
    const adapter: Pick<ModelRerankerAdapter, "rerankWithMetadata"> = {
      rerankWithMetadata: jest.fn().mockResolvedValue({
        results: [
          {
            candidateId: "chunk-a",
            score: 0.2,
            reason: "less relevant"
          },
          {
            candidateId: "chunk-b",
            score: 0.95,
            reason: "strong semantic match"
          }
        ],
        metadata: {
          mode: "provider",
          provider: "openai",
          model: "gpt-4.1-mini",
          inputCount: 2,
          outputCount: 2
        },
      })
    };
    const replay: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(adapter, replay);
    const bundle = createBundle();

    const response = await service.rerank({
      retrievalBundle: bundle,
      secondaryMinCandidates: 2
    });

    expect(adapter.rerankWithMetadata).toHaveBeenCalledTimes(1);
    expect(response.retrieval_bundle.reranked?.[0]?.chunk_id).toBe("chunk-b");
    expect(response.retrieval_bundle.reranked?.[0]?.secondary_score).toBeCloseTo(0.95);
    expect(response.retrieval_bundle.rerank_metadata?.secondary.provider).toBe("openai");
    expect(response.retrieval_bundle.rerank_metadata?.secondary.model).toBe("gpt-4.1-mini");
  });

  it("keeps retrieval column pruning evidence visible in rerank replay payload", async () => {
    const adapter: Pick<ModelRerankerAdapter, "rerankWithMetadata"> = {
      rerankWithMetadata: jest.fn().mockResolvedValue({
        results: [],
        metadata: {
          mode: "mock",
          inputCount: 0,
          outputCount: 0
        }
      })
    };
    const replay: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const service = createService(adapter, replay);
    const bundle = createBundle() as RagRetrievalBundle & {
      column_pruning?: Record<string, unknown>;
    };
    bundle.column_pruning = {
      strategy: "table_first_field_second_conservative",
      status: "applied",
      tables: [
        {
          table_name: "orders",
          mode: "conservative"
        }
      ]
    };

    await service.rerank({
      retrievalBundle: bundle,
      secondaryMinCandidates: 10
    });

    const finalReplayCall = (replay.writeReplay as jest.Mock).mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload.replayKey === "rerank:final") as
      | {
          payload?: {
            columnPruning?: {
              status?: string;
              tables?: Array<{ table_name?: string; mode?: string }>;
            };
          };
        }
      | undefined;
    expect(finalReplayCall).toBeDefined();
    expect(finalReplayCall?.payload?.columnPruning?.status).toBe("applied");
    expect(finalReplayCall?.payload?.columnPruning?.tables?.[0]?.table_name).toBe("orders");
    expect(finalReplayCall?.payload?.columnPruning?.tables?.[0]?.mode).toBe("conservative");
  });
});
