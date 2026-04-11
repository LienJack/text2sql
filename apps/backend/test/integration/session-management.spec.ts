import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/chat/chat.service";

describe("session management", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("should create, rename and soft-delete session via service", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);

    const created = await chatService.createSession();
    expect(created.id).toBeTruthy();
    expect(created.syncStatus).toBe("healthy");
    expect(created.debugEnabled).toBe(false);

    const renamed = await chatService.renameSession(created.id, "集成测试会话");
    expect(renamed.title).toBe("集成测试会话");

    const debugEnabled = await chatService.updateSession(created.id, {
      debugEnabled: true
    });
    expect(debugEnabled.debugEnabled).toBe(true);

    const sessionsBeforeDelete = await chatService.listSessions();
    expect(sessionsBeforeDelete.some((item) => item.id === created.id)).toBe(true);

    await chatService.deleteSession(created.id);

    const sessionsAfterDelete = await chatService.listSessions();
    expect(sessionsAfterDelete.some((item) => item.id === created.id)).toBe(false);
  });
});
