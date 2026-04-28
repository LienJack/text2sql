import { generateText, streamText } from "ai";
import { DomainError } from "../../src/common/domain-error";
import type { AppConfigService } from "../../src/modules/config/app-config.service";
import { LlmGatewayService } from "../../src/modules/llm/llm-gateway.service";
import { LlmModelFactory } from "../../src/modules/llm/llm-model-factory";

jest.mock("ai", () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
  tool: jest.fn((definition) => definition)
}));

const mockedGenerateText = generateText as jest.MockedFunction<typeof generateText>;
const mockedStreamText = streamText as jest.MockedFunction<typeof streamText>;

describe("LlmGatewayService", () => {
  const runtime = {
    provider: "openai",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    timeoutMs: 3000,
    streamTimeoutMs: 9000
  };

  afterEach(() => {
    mockedGenerateText.mockReset();
    mockedStreamText.mockReset();
    jest.restoreAllMocks();
  });

  it("should return mock response in llm mock mode", async () => {
    const service = new LlmGatewayService(
      {
        llmMockMode: true
      } as AppConfigService,
      new LlmModelFactory()
    );
    const output = await service.generate(
      {
        systemPrompt: "sys",
        userPrompt: "统计订单状态分布"
      },
      runtime
    );
    expect(output.rawText.toLowerCase()).toContain("select");
  });

  it("should return metadata sql in llm mock mode for metadata intent", async () => {
    const service = new LlmGatewayService(
      {
        llmMockMode: true
      } as AppConfigService,
      new LlmModelFactory()
    );
    const output = await service.generate(
      {
        systemPrompt: "sys",
        userPrompt: "数据库有哪些表"
      },
      runtime
    );
    expect(output.rawText.toLowerCase()).toContain("sqlite_master");
  });

  it("should map empty model output to LLM_EMPTY_RESPONSE", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "   "
    } as Awaited<ReturnType<typeof generateText>>);
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );
    await expect(
      service.generate(
        {
          systemPrompt: "sys",
          userPrompt: "统计订单状态分布"
        },
        runtime
      )
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "LLM_EMPTY_RESPONSE"
    });
  });

  it("should map sdk errors to LLM_REQUEST_FAILED", async () => {
    mockedGenerateText.mockRejectedValue(new Error("upstream 503"));
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );

    await expect(
      service.generate(
        {
          systemPrompt: "sys",
          userPrompt: "统计订单状态分布"
        },
        runtime
      )
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "LLM_REQUEST_FAILED"
    });
  });

  it("should stream text and tool events", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "SELECT " };
        yield {
          type: "tool-call",
          toolName: "runReadOnlySql",
          toolCallId: "tool-1",
          input: { sql: "SELECT 1" }
        };
        yield {
          type: "tool-result",
          toolName: "runReadOnlySql",
          toolCallId: "tool-1",
          output: { rowCount: 1 }
        };
      })(),
      text: Promise.resolve("SELECT 1")
    } as unknown as ReturnType<typeof streamText>);

    const events: string[] = [];
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );
    const output = await service.stream(
      {
        systemPrompt: "sys",
        userPrompt: "统计订单状态分布"
      },
      runtime,
      {
        onEvent: (event) => {
          events.push(event.type);
        }
      }
    );

    expect(output.rawText).toBe("SELECT 1");
    expect(events).toEqual(["text-delta", "tool-call", "tool-result"]);
  });

  it("should use stream timeout for stream requests", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "SELECT 1" };
      })(),
      text: Promise.resolve("SELECT 1")
    } as unknown as ReturnType<typeof streamText>);

    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );

    await service.stream(
      {
        systemPrompt: "sys",
        userPrompt: "统计订单状态分布"
      },
      runtime
    );

    expect(timeoutSpy).toHaveBeenCalledWith(9000);
  });

  it("should raise tool-call-only response when stream has no final text", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolName: "runReadOnlySql",
          toolCallId: "tool-2",
          input: { sql: "SELECT status FROM orders" }
        };
        yield {
          type: "tool-result",
          toolName: "runReadOnlySql",
          toolCallId: "tool-2",
          output: { rowCount: 3 }
        };
      })(),
      text: Promise.resolve("")
    } as unknown as ReturnType<typeof streamText>);

    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );
    await expect(
      service.stream(
        {
          systemPrompt: "sys",
          userPrompt: "统计订单状态分布"
        },
        runtime
      )
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "LLM_TOOL_CALL_ONLY_RESPONSE"
    });
  });

  it("should recover from stream timeout via non-stream retry", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        throw new Error("The operation was aborted due to timeout");
      })(),
      text: Promise.resolve("")
    } as unknown as ReturnType<typeof streamText>);

    mockedGenerateText.mockResolvedValue({
      text: "SELECT COUNT(*) FROM orders;"
    } as Awaited<ReturnType<typeof generateText>>);

    const events: string[] = [];
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );

    const output = await service.stream(
      {
        systemPrompt: "sys",
        userPrompt: "统计订单总数"
      },
      runtime,
      {
        onEvent: (event) => {
          events.push(event.type);
        }
      }
    );

    expect(output.rawText).toBe("SELECT COUNT(*) FROM orders;");
    expect(events).toEqual(["text-delta"]);
    expect(mockedGenerateText).toHaveBeenCalledTimes(1);
  });

  it("should recover with successful tool SQL when provider stream breaks after tool result", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolName: "runReadOnlySql",
          toolCallId: "tool-4",
          input: {
            sql: "SELECT method, COUNT(*) AS payment_count FROM payments GROUP BY method"
          }
        };
        yield {
          type: "tool-result",
          toolName: "runReadOnlySql",
          toolCallId: "tool-4",
          output: { rowCount: 3 }
        };
        throw new Error("Invalid JSON response");
      })(),
      text: Promise.resolve("")
    } as unknown as ReturnType<typeof streamText>);

    const events: string[] = [];
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );

    const output = await service.stream(
      {
        systemPrompt: "sys",
        userPrompt: "统计支付方式占比"
      },
      runtime,
      {
        onEvent: (event) => {
          events.push(event.type);
        }
      }
    );

    expect(output.rawText).toContain("SELECT method");
    expect(output.rawText).toContain("GROUP BY method");
    expect(events).toEqual(["tool-call", "tool-result", "text-delta"]);
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });

  it("should fail fast when tool execution returns error", async () => {
    mockedStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolName: "runReadOnlySql",
          toolCallId: "tool-3",
          input: { sql: "SELECT * FROM unknown_table" }
        };
        yield {
          type: "tool-error",
          toolName: "runReadOnlySql",
          toolCallId: "tool-3",
          error: new Error("当前工作空间无权访问表: unknown_table")
        };
      })(),
      text: Promise.resolve("")
    } as unknown as ReturnType<typeof streamText>);

    const events: string[] = [];
    const service = new LlmGatewayService(
      {
        llmMockMode: false
      } as AppConfigService,
      new LlmModelFactory()
    );

    await expect(
      service.stream(
        {
          systemPrompt: "sys",
          userPrompt: "统计支付方式占比"
        },
        runtime,
        {
          onEvent: (event) => {
            events.push(event.type);
          }
        }
      )
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "LLM_TOOL_CALL_EXECUTION_FAILED"
    });

    expect(events).toEqual(["tool-call", "tool-error"]);
    expect(mockedGenerateText).not.toHaveBeenCalled();
  });
});
