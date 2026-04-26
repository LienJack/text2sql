import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";

describe("agent rag degrade flow integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.AGENT_PLANNING_SCAFFOLD_ENABLED = "true";
  });

  it("keeps main flow available when retrieval degrades due to missing active index", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);
    const session = await chatService.createSession("sqlite_main");
    const run = await chatService.sendMessage(session.id, "按状态统计订单数量");

    const retrieveStep = run.trace.steps.find((step) => step.node === "retrieve-knowledge");
    expect(retrieveStep).toBeDefined();
    expect(retrieveStep?.outputSummary ?? "").toMatch(/degrad|降级|retrievalStatus/i);

    const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
    expect(generateStep?.inputSummary).toContain("retrievalStatus");
    expect(generateStep?.inputSummary).toContain("selectedContextCount");

    expect(["executionResult", "failed", "rejected"]).toContain(run.status);

    await moduleRef.close();
  });
});
