import { resolveProviderBaseUrl } from "../../src/modules/llm/llm-model-factory";

describe("resolveProviderBaseUrl", () => {
  it("should keep base url when no path suffix is provided", () => {
    expect(resolveProviderBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com"
    );
  });

  it("should keep versioned base url", () => {
    expect(resolveProviderBaseUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1"
    );
  });

  it("should trim chat completion suffix", () => {
    expect(resolveProviderBaseUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1"
    );
  });
});
