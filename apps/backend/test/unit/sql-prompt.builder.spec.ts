import { SqlPromptBuilder } from "../../src/modules/agent/sql/sql-prompt.builder";

describe("SqlPromptBuilder", () => {
  it("should build sql-specific prompt payload", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布");

    expect(prompt.systemPrompt).toContain("read-only SQL");
    expect(prompt.userPrompt).toContain("Question: 统计订单状态分布");
  });

  it("injects runtime template overlay when provided", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布", "sqlite", undefined, {
      templateOverlay: "Always join users table with explicit alias."
    });

    expect(prompt.systemPrompt).toContain("Runtime template overlay");
    expect(prompt.systemPrompt).toContain("Always join users table with explicit alias.");
  });
});
