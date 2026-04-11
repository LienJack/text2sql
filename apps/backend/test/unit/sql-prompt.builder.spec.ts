import { SqlPromptBuilder } from "../../src/modules/agent/sql/sql-prompt.builder";

describe("SqlPromptBuilder", () => {
  it("should build sql-specific prompt payload", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布");

    expect(prompt.systemPrompt).toContain("read-only SQL");
    expect(prompt.userPrompt).toContain("Question: 统计订单状态分布");
  });
});
