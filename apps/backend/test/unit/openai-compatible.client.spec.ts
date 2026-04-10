import { resolveChatCompletionsUrl } from "../../src/modules/llm/openai-compatible.client";

describe("resolveChatCompletionsUrl", () => {
  it("should append /v1/chat/completions when base url has no version", () => {
    expect(resolveChatCompletionsUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
  });

  it("should append /chat/completions when base url already ends with version path", () => {
    expect(resolveChatCompletionsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
  });

  it("should keep url when full chat completions path is provided", () => {
    expect(
      resolveChatCompletionsUrl("https://api.example.com/v1/chat/completions")
    ).toBe("https://api.example.com/v1/chat/completions");
  });
});
