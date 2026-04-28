import { DomainError } from "../../src/common/domain-error";
import { RerankRouterService } from "../../src/modules/llm/rerank-router.service";

describe("RerankRouterService", () => {
  const createService = (overrides?: {
    rerankMockMode?: boolean;
    llmMockMode?: boolean;
    nodeEnv?: string;
    generateRawText?: string;
    runtimeError?: unknown;
  }): RerankRouterService => {
    const config = {
      rerankMockMode: overrides?.rerankMockMode ?? false,
      llmMockMode: overrides?.llmMockMode ?? false,
      nodeEnv: overrides?.nodeEnv ?? "development",
      rerankProvider: "openai",
      rerankModel: "gpt-4.1-mini"
    };
    const llmGateway = {
      generate: jest.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4.1-mini",
        rawText:
          overrides?.generateRawText ??
          JSON.stringify({
            reranked: [
              {
                candidateId: "chunk-1",
                score: 0.91,
                reason: "high semantic match"
              }
            ]
          })
      })
    };
    const ragTaskConfigService = {
      resolveRerankRuntime: overrides?.runtimeError
        ? jest.fn().mockRejectedValue(overrides.runtimeError)
        : jest.fn().mockResolvedValue({
            taskType: "rerank",
            provider: "openai",
            model: "gpt-4.1-mini",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "test-key",
            timeoutMs: 5000,
            configSource: "settings",
            configId: "rag-rerank-1"
          })
    };

    return new RerankRouterService(
      config as never,
      llmGateway as never,
      ragTaskConfigService as never
    );
  };

  const rerankInput = {
    query: "orders amount",
    candidates: [
      {
        candidateId: "chunk-1",
        content: "table orders(id, amount)",
        domain: "schema",
        sourceLane: "lexical",
        evidence: ["token:orders"],
        baseScore: 0.7
      }
    ]
  };

  it("returns task-specific rerank metadata with config source", async () => {
    const service = createService();

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.metadata.mode).toBe("provider");
    expect(response.metadata.provider).toBe("openai");
    expect(response.metadata.model).toBe("gpt-4.1-mini");
    expect(response.metadata.configSource).toBe("settings");
    expect(response.metadata.configId).toBe("rag-rerank-1");
  });

  it("throws explicit invalid payload error when response is not parseable", async () => {
    const service = createService({ generateRawText: "rerank response unavailable" });

    await expect(service.rerankCandidatesWithMetadata(rerankInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "RERANK_PROVIDER_INVALID_PAYLOAD"
    });
  });

  it("throws output count mismatch when provider returns fewer candidates", async () => {
    const service = createService({
      generateRawText: JSON.stringify({
        reranked: [
          {
            candidateId: "chunk-1",
            score: 0.88,
            reason: "partial result"
          }
        ]
      })
    });
    const twoCandidatesInput = {
      query: "orders amount",
      candidates: [
        ...rerankInput.candidates,
        {
          candidateId: "chunk-2",
          content: "table customers(id, city)",
          domain: "schema",
          sourceLane: "dense",
          evidence: ["token:customers"],
          baseScore: 0.6
        }
      ]
    };

    await expect(service.rerankCandidatesWithMetadata(twoCandidatesInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "RERANK_PROVIDER_OUTPUT_COUNT_MISMATCH"
    });
  });

  it("throws invalid payload when provider returns unknown candidate ids", async () => {
    const service = createService({
      generateRawText: JSON.stringify({
        reranked: [
          {
            candidateId: "chunk-unknown",
            score: 0.91,
            reason: "unknown"
          }
        ]
      })
    });

    await expect(service.rerankCandidatesWithMetadata(rerankInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "RERANK_PROVIDER_INVALID_PAYLOAD"
    });
  });

  it("surfaces provider missing errors instead of silently falling back", async () => {
    const service = createService({
      llmMockMode: true,
      nodeEnv: "development",
      runtimeError: new DomainError("LLM_CONFIG_MISSING", "rerank config missing", 503)
    });

    await expect(service.rerankCandidatesWithMetadata(rerankInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "LLM_CONFIG_MISSING"
    });
  });

  it("uses deterministic mock rerank in explicit rerank mock mode", async () => {
    const service = createService({ rerankMockMode: true });

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.reason).toContain("mock rerank");
    expect(response.metadata.mode).toBe("mock");
    expect(response.metadata.fallbackReason).toBe("rerank_mock_mode");
  });

  it("allows llm mock mode only inside NODE_ENV=test", async () => {
    const service = createService({
      llmMockMode: true,
      nodeEnv: "test"
    });

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.metadata.mode).toBe("mock");
    expect(response.metadata.fallbackReason).toBe("llm_mock_mode");
  });

  it("returns empty metadata for empty candidate input", async () => {
    const service = createService();

    await expect(
      service.rerankCandidatesWithMetadata({
        query: "orders",
        candidates: []
      })
    ).resolves.toMatchObject({
      results: [],
      metadata: {
        mode: "provider",
        inputCount: 0,
        outputCount: 0
      }
    });
  });
});
