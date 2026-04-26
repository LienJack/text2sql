import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";

describe("agent main flow", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.AGENT_RAG_RETRIEVAL_ENABLED = "true";
  });

  it("should return execution result for clear question", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);
    const session = await chatService.createSession("sqlite_main");
    const run = await chatService.sendMessage(session.id, "统计商家交易额");

    expect(["executionResult", "failed"]).toContain(run.status);
    expect(run.trace.steps.length).toBeGreaterThan(0);
    if (run.llmRaw) {
      expect(run.llmRaw.rawText).toBeTruthy();
    }
    const firstStep = run.trace.steps[0];
    if (firstStep?.durationMs !== undefined) {
      expect(firstStep.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(firstStep?.sequence).toBe(1);
    expect(firstStep?.stepId).toContain(`${run.runId}:`);
    expect(firstStep?.lifecycle).toBeTruthy();
    expect(run.trace.clarificationDecision).toBeDefined();
    expect(["continue", "clarify"]).toContain(run.trace.clarificationDecision?.decision);
    if (run.status === "executionResult") {
      expect(typeof run.answer).toBe("string");
      expect(run.answer?.trim().length).toBeGreaterThan(0);
      expect(run.answer).toContain("已完成分析");
      expect(run.answer).not.toContain("样例结果");
      expect(run.answer).not.toContain("{\"");
    }
    await moduleRef.close();
  });

  it("should reject non-readonly sql intent", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);
    const session = await chatService.createSession("sqlite_main");
    const run = await chatService.sendMessage(session.id, "DELETE orders where id = 1");

    expect(["rejected", "failed"]).toContain(run.status);
    expect(run.trace.clarificationDecision?.decisionSource).toBe("sql-write-intent");
    expect(run.trace.clarificationDecision?.bypassed).toBe(true);
    await moduleRef.close();
  });
});
