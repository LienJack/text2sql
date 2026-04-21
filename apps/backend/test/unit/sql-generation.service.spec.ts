import { DomainError } from "../../src/common/domain-error";
import { SqlGenerationService } from "../../src/modules/conversation/agent/sql/sql-generation.service";
import { SqlOutputExtractor } from "../../src/modules/conversation/agent/sql/sql-output-extractor";
import { SqlPromptBuilder } from "../../src/modules/conversation/agent/sql/sql-prompt.builder";
import type { ProviderRouterService } from "../../src/modules/llm/provider-router.service";
import type { PromptTemplateService } from "../../src/modules/governance/settings/prompt-template.service";

describe("SqlGenerationService semantic guardrails", () => {
  const promptTemplateService = {
    resolveSqlTemplateRuntime: jest.fn(async () => ({
      template: undefined,
      evidence: {
        scene: "sql"
      }
    }))
  };

  const createService = (providerRouter: {
    generate: jest.Mock;
    stream: jest.Mock;
  }) =>
    new SqlGenerationService(
      new SqlPromptBuilder(),
      new SqlOutputExtractor(),
      providerRouter as unknown as ProviderRouterService,
      promptTemplateService as unknown as PromptTemplateService
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enforces count-intent semantics and performs one repair retry", async () => {
    const providerRouter = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText: "```sql\nSELECT name FROM sqlite_master WHERE type = 'table';\n```"
        })
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText: "```sql\nSELECT COUNT(*) AS total FROM orders;\n```"
        }),
      stream: jest.fn()
    };
    const service = createService(providerRouter);

    const draft = await service.generate("统计订单总数");

    expect(draft.semanticIntent).toBe("count");
    expect(draft.retryCount).toBe(1);
    expect(draft.sql).toBe("SELECT COUNT(*) AS total FROM orders;");
    expect(providerRouter.generate).toHaveBeenCalledTimes(2);

    const firstPrompt = providerRouter.generate.mock.calls[0][0];
    const secondPrompt = providerRouter.generate.mock.calls[1][0];
    expect(firstPrompt.systemPrompt).toContain("business count-intent query");
    expect(secondPrompt.systemPrompt).toContain("single automatic retry");
    expect(secondPrompt.systemPrompt).toContain(
      "count-intent requires business counting SQL"
    );
  });

  it("enforces metadata-intent semantics without misclassifying as business count", async () => {
    const providerRouter = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText: "```sql\nSELECT COUNT(*) AS total FROM orders;\n```"
        })
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText:
            "```sql\nSELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;\n```"
        }),
      stream: jest.fn()
    };
    const service = createService(providerRouter);

    const draft = await service.generate("数据库有哪些表");

    expect(draft.semanticIntent).toBe("metadata");
    expect(draft.retryCount).toBe(1);
    expect(draft.sql).toContain("sqlite_master");
    expect(providerRouter.generate).toHaveBeenCalledTimes(2);

    const firstPrompt = providerRouter.generate.mock.calls[0][0];
    const secondPrompt = providerRouter.generate.mock.calls[1][0];
    expect(firstPrompt.systemPrompt).toContain("metadata-intent query");
    expect(secondPrompt.systemPrompt).toContain("single automatic retry");
    expect(secondPrompt.systemPrompt).toContain(
      "metadata-intent requires schema/table introspection SQL"
    );
  });

  it("retries at most once when semantic guardrail keeps failing", async () => {
    const providerRouter = {
      generate: jest
        .fn()
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText: "```sql\nSELECT id, order_no FROM orders;\n```"
        })
        .mockResolvedValueOnce({
          provider: "mock-provider",
          model: "mock-model",
          rawText: "```sql\nSELECT created_at FROM orders;\n```"
        }),
      stream: jest.fn()
    };
    const service = createService(providerRouter);

    await expect(service.generate("统计订单总数")).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "LLM_SQL_SEMANTIC_GUARDRAIL_FAILED"
    });
    expect(providerRouter.generate).toHaveBeenCalledTimes(2);
  });
});
