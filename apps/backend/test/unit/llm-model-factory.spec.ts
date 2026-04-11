import { DomainError } from "../../src/common/domain-error";
import { LlmModelFactory } from "../../src/modules/llm/llm-model-factory";

describe("LlmModelFactory", () => {
  const factory = new LlmModelFactory();

  it("should throw LLM_CONFIG_MISSING when base url is empty", () => {
    expect(() =>
      factory.createChatModel({
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "",
        apiKey: "sk-test",
        timeoutMs: 3000
      })
    ).toThrow(
      expect.objectContaining<Partial<DomainError>>({
        code: "LLM_CONFIG_MISSING"
      })
    );
  });

  it("should create model instance when runtime config is complete", () => {
    const model = factory.createChatModel({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      timeoutMs: 3000
    });
    expect(model).toBeTruthy();
  });
});
