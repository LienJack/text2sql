import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";

describe("session repository", () => {
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

  it("should keep lifecycle defaults and sort by latest activity", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const repository = moduleRef.get(ChatRepository);

    const firstId = "repo-session-1";
    const secondId = "repo-session-2";
    await repository.createSession({
      id: firstId,
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:00.000Z"
    });
    await repository.createSession({
      id: secondId,
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:01.000Z"
    });

    await repository.markSessionMessageActivity(firstId, "2026-04-10T00:00:10.000Z");
    await repository.renameSession(firstId, "仓库测试会话");

    const list = await repository.listSessions();
    const first = list.find((item) => item.id === firstId);
    expect(first?.title).toBe("仓库测试会话");
    expect(first?.syncStatus).toBe("healthy");
    expect(first?.debugEnabled).toBe(false);
    expect(list[0]?.id).toBe(firstId);
  });

  it("should persist llm raw payload and read latest run by session", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const repository = moduleRef.get(ChatRepository);

    const sessionId = "repo-session-run";
    await repository.createSession({
      id: sessionId,
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:00.000Z"
    });

    await repository.persistRun({
      runId: "run-1",
      sessionId,
      status: "executionResult",
      provider: "mock",
      question: "统计订单",
      sql: "SELECT 1",
      explanation: "ok",
      trace: {
        runId: "run-1",
        provider: "mock",
        retryCount: 0,
        steps: []
      },
      llmRaw: {
        provider: "mock",
        model: "mock-model",
        rawText: "SELECT 1",
        createdAt: "2026-04-10T00:00:00.000Z"
      },
      createdAt: "2026-04-10T00:00:00.000Z"
    });

    const latest = await repository.getLatestRunBySessionId(sessionId);
    expect(latest?.runId).toBe("run-1");
    expect(latest?.llmRaw?.model).toBe("mock-model");
  });
});
