import type { ContextEnvelope } from "@text2sql/shared-types";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";

describe("ChatService", () => {
  it("forwards contextEnvelope to executeMessageUsecase", async () => {
    const executeMessage = jest.fn().mockResolvedValue({
      runId: "run-sync"
    });
    const streamMessage = jest.fn();
    const chatService = new ChatService(
      {} as never,
      { executeMessage } as never,
      { streamMessage } as never,
      {} as never,
      {} as never
    );
    const contextEnvelope: ContextEnvelope = {
      metricDefinition: "净销售额=订单金额-退款金额",
      timeRange: {
        from: "2026-01-01",
        to: "2026-03-31"
      }
    };

    await chatService.sendMessage(
      "session-1",
      "统计净销售额",
      "req-1",
      contextEnvelope
    );

    expect(executeMessage).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "统计净销售额",
      requestId: "req-1",
      contextEnvelope
    });
  });

  it("forwards contextEnvelope to streamMessageUsecase", async () => {
    const executeMessage = jest.fn();
    const streamMessage = jest.fn().mockResolvedValue({
      runId: "run-stream"
    });
    const chatService = new ChatService(
      {} as never,
      { executeMessage } as never,
      { streamMessage } as never,
      {} as never,
      {} as never
    );
    const contextEnvelope: ContextEnvelope = {
      entityMappings: [
        {
          entity: "华北大区",
          mappedTo: "region_north"
        }
      ]
    };
    const onEvent = jest.fn();

    await chatService.streamMessage(
      "session-1",
      "近30天支付方式分布",
      "req-2",
      onEvent,
      undefined,
      contextEnvelope
    );

    expect(streamMessage).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "近30天支付方式分布",
      requestId: "req-2",
      onEvent,
      contextEnvelope
    });
  });
});
