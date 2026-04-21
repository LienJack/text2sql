import { SqlPromptBuilder } from "../../src/modules/conversation/agent/sql/sql-prompt.builder";

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

  it("adds explicit count-intent guardrail instructions", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单总数", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "count"
      }
    });

    expect(prompt.systemPrompt).toContain("business count-intent query");
    expect(prompt.systemPrompt).toContain("must contain COUNT(...) aggregation");
    expect(prompt.systemPrompt).toContain("Do not return schema/metadata introspection SQL.");
  });

  it("adds explicit metadata-intent guardrail instructions", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("数据库有哪些表", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "metadata"
      }
    });

    expect(prompt.systemPrompt).toContain("metadata-intent query");
    expect(prompt.systemPrompt).toContain("sqlite_master");
    expect(prompt.systemPrompt).toContain("Do not return business row counting SQL.");
  });

  it("adds single-retry repair hint when retry reason is present", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单总数", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "count",
        retryReason: "count-intent requires COUNT(...) aggregation"
      }
    });

    expect(prompt.systemPrompt).toContain("single automatic retry");
    expect(prompt.systemPrompt).toContain("count-intent requires COUNT(...) aggregation");
  });
});
