import { DomainError } from "../../src/common/domain-error";
import { RerankRouterService } from "../../src/modules/llm/rerank-router.service";

describe("RerankRouterService", () => {
  const createService = (overrides?: {
    rerankMockMode?: boolean;
    generateRawText?: string;
  }): RerankRouterService => {
    const config = {
      rerankMockMode: overrides?.rerankMockMode ?? false,
      llmMockMode: false,
      nodeEnv: "development",
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
      resolveRerankRuntime: jest.fn().mockResolvedValue({
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

  it("uses deterministic mock rerank in explicit rerank mock mode", async () => {
    const service = createService({ rerankMockMode: true });

    const response = await service.rerankCandidatesWithMetadata(rerankInput);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.reason).toContain("mock rerank");
    expect(response.metadata.mode).toBe("mock");
    expect(response.metadata.fallbackReason).toBe("rerank_mock_mode");
  });
});
