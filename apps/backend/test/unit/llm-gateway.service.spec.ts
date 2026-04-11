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
    timeoutMs: 3000
  };

  afterEach(() => {
    mockedGenerateText.mockReset();
    mockedStreamText.mockReset();
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

  it("should fallback to tool sql when stream has no text deltas", async () => {
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
    const output = await service.stream(
      {
        systemPrompt: "sys",
        userPrompt: "统计订单状态分布"
      },
      runtime
    );

    expect(output.rawText).toContain("```sql");
    expect(output.rawText).toContain("SELECT status FROM orders");
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
});
