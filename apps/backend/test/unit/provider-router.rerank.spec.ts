import { DomainError } from "../../src/common/domain-error";
import { ProviderRouterService } from "../../src/modules/llm/provider-router.service";

describe("ProviderRouterService rerank", () => {
  const createService = (overrides?: {
    llmMockMode?: boolean;
    generateRawText?: string;
  }): ProviderRouterService => {
    const llmMockMode = overrides?.llmMockMode ?? false;
    const config = {
      llmMockMode,
      llmProvider: "openai",
      llmModel: "gpt-4.1-mini",
      llmBaseUrl: "https://api.openai.com/v1",
      llmApiKey: "test-key",
      llmTimeoutMs: 5_000,
      llmStreamTimeoutMs: 10_000
    };
    const providerCatalog = {
      resolveRuntimeByModelId: jest.fn(),
      resolveDefaultModel: jest.fn().mockRejectedValue(new Error("missing-catalog")),
      resolveRuntimeConfig: jest.fn()
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
      }),
      stream: jest.fn()
    };

    return new ProviderRouterService(config as never, providerCatalog as never, llmGateway as never);
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

  it("returns provider metadata on successful non-mock rerank", async () => {
    const service = createService({ llmMockMode: false });

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.metadata.mode).toBe("provider");
    expect(response.metadata.provider).toBe("openai");
    expect(response.metadata.model).toBe("gpt-4.1-mini");
    expect(response.metadata.inputCount).toBe(1);
    expect(response.metadata.outputCount).toBe(1);
  });

  it("does not silently fallback to mock mode when provider payload is invalid", async () => {
    const service = createService({
      llmMockMode: false,
      generateRawText: "rerank response unavailable"
    });

    await expect(service.rerankCandidatesWithMetadata(rerankInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "RERANK_PROVIDER_INVALID_PAYLOAD"
    });
    await expect(service.rerankCandidates(rerankInput)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "RERANK_PROVIDER_INVALID_PAYLOAD"
    });
  });

  it("uses deterministic mock rerank only in explicit llm mock mode", async () => {
    const service = createService({ llmMockMode: true });

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.reason).toContain("mock rerank");
    expect(response.metadata.mode).toBe("mock");
    expect(response.metadata.fallbackReason).toBe("llm_mock_mode");
  });
});
