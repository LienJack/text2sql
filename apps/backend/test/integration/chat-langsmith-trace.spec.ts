import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";
import { LangsmithTraceService } from "../../src/modules/observability/langsmith-trace.service";

describe("chat langsmith trace", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGSMITH_API_KEY = "";
  });

  it("should pass chat context into langsmith tracing hooks", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const chatService = moduleRef.get(ChatService);
    const langsmith = moduleRef.get(LangsmithTraceService);

    const startSpy = jest.spyOn(langsmith, "startRoot");
    const spanSpy = jest.spyOn(langsmith, "recordSpan");
    const endSpy = jest.spyOn(langsmith, "endRoot");

    const session = await chatService.createSession("sqlite_main");
    await chatService.sendMessage(session.id, "统计订单状态分布", "req-chat-1");

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "chat",
        route: "/api/v1/sessions/:sessionId/messages",
        requestId: "req-chat-1",
        sessionId: session.id
      })
    );
    expect(spanSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: expect.any(String)
      })
    );
  });
});
