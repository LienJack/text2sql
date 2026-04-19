import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { SessionLifecycleUsecase } from "../../src/modules/conversation/chat/application/session-lifecycle.usecase";
import { ExecuteMessageUsecase } from "../../src/modules/conversation/chat/application/execute-message.usecase";
import { StreamMessageUsecase } from "../../src/modules/conversation/chat/application/stream-message.usecase";
import { RunViewUsecase } from "../../src/modules/conversation/chat/application/run-view.usecase";
import { ChatPostRunHooksService } from "../../src/modules/conversation/chat/application/shared/chat-post-run-hooks.service";
import { ChatPolicyGuardService } from "../../src/modules/conversation/chat/application/shared/chat-policy-guard.service";
import { ChatRunPersistenceService } from "../../src/modules/conversation/chat/application/shared/chat-run-persistence.service";
import { ChatDeliveryEnrichmentService } from "../../src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";
import { GovernanceChatAccessFacade } from "../../src/modules/governance/governance-chat-access.facade";
import { KnowledgeChatSupportFacade } from "../../src/modules/knowledge/knowledge-chat-support.facade";
import { PlatformChatRuntimeFacade } from "../../src/modules/platform/platform-chat-runtime.facade";

describe("data flow", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
  });

  it("should persist session and messages through repository flow", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);

    const session = await chatService.createSession("sqlite_main");
    await chatService.sendMessage(session.id, "请统计订单状态分布");

    const messages = await chatService.listMessages(session.id);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("should resolve Unit 1 chat usecase providers and cross-domain facades", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    expect(moduleRef.get(ChatService)).toBeDefined();
    expect(moduleRef.get(SessionLifecycleUsecase, { strict: false })).toBeDefined();
    expect(moduleRef.get(ExecuteMessageUsecase, { strict: false })).toBeDefined();
    expect(moduleRef.get(StreamMessageUsecase, { strict: false })).toBeDefined();
    expect(moduleRef.get(RunViewUsecase, { strict: false })).toBeDefined();
    expect(moduleRef.get(ChatPostRunHooksService, { strict: false })).toBeDefined();
    expect(moduleRef.get(ChatPolicyGuardService, { strict: false })).toBeDefined();
    expect(moduleRef.get(ChatRunPersistenceService, { strict: false })).toBeDefined();
    expect(moduleRef.get(ChatDeliveryEnrichmentService, { strict: false })).toBeDefined();
    expect(moduleRef.get(GovernanceChatAccessFacade, { strict: false })).toBeDefined();
    expect(moduleRef.get(KnowledgeChatSupportFacade, { strict: false })).toBeDefined();
    expect(moduleRef.get(PlatformChatRuntimeFacade, { strict: false })).toBeDefined();
  });

  it("should fail fast when ChatService is wired without required dependencies", async () => {
    await expect(
      Test.createTestingModule({
        providers: [ChatService]
      }).compile()
    ).rejects.toThrow(/can't resolve dependencies of the ChatService/i);
  });
});
