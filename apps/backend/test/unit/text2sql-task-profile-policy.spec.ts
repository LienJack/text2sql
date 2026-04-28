import { ProviderRouterService } from "../../src/modules/llm/provider-router.service";

describe("text2sql task-profile policy matrix", () => {
  const createService = (): ProviderRouterService => {
    const config = {
      llmMockMode: false,
      llmProvider: "openai",
      llmModel: "gpt-4.1-mini",
      llmBaseUrl: "https://api.openai.com/v1",
      llmApiKey: "test-key",
      llmTimeoutMs: 5_000,
      llmStreamTimeoutMs: 10_000
    };
    const providerCatalog = {
      resolveRuntimeByModelId: jest.fn(),
      resolveDefaultModel: jest.fn(),
      resolveRuntimeConfig: jest.fn()
    };
    const llmGateway = {
      generate: jest.fn(),
      stream: jest.fn()
    };
    return new ProviderRouterService(config as never, providerCatalog as never, llmGateway as never);
  };

  it("uses low reasoning for intake/retrieve and high reasoning for semantic-plan/generate-sql", () => {
    const service = createService();

    const intakePolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "intake"
    });
    const retrievePolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "retrieve"
    });
    const planPolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "semantic-plan"
    });
    const generatePolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "generate-sql"
    });

    expect(intakePolicy.reasoningTier).toBe("low");
    expect(intakePolicy.taskProfile).toBe("intake-fast");
    expect(retrievePolicy.reasoningTier).toBe("low");
    expect(retrievePolicy.taskProfile).toBe("retrieval-support");
    expect(planPolicy.reasoningTier).toBe("high");
    expect(planPolicy.taskProfile).toBe("semantic-planning");
    expect(generatePolicy.reasoningTier).toBe("high");
    expect(generatePolicy.taskProfile).toBe("sql-generation");
  });

  it("records escalation reason and upgrades reasoning tier when correction retry is requested", () => {
    const service = createService();

    const baselineCorrectionPolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "correct"
    });
    const escalatedCorrectionPolicy = service.resolveText2SqlStageTaskProfilePolicy({
      stage: "correct",
      escalationReason: "execution_error_correction_retry",
      modelCatalogId: "model-catalog-1"
    });

    expect(baselineCorrectionPolicy.reasoningTier).toBe("medium");
    expect(escalatedCorrectionPolicy.reasoningTier).toBe("high");
    expect(escalatedCorrectionPolicy.escalationReason).toBe(
      "execution_error_correction_retry"
    );
    expect(escalatedCorrectionPolicy.policySource).toBe(
      "session_model_catalog_binding"
    );
  });
});

