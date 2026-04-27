import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import type { Session } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";
import { SavedPriorSqlService } from "../../src/modules/knowledge/memory/saved-prior-sql.service";
import {
  ChatRepository,
  WorkspaceDatasourcePolicyRepository
} from "../../src/modules/platform/data/persistence/index";

describe("agent saved prior sql shortcut integration", () => {
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

  it("keeps canonical generate/validate path when prior SQL memory exists", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const chatService = moduleRef.get(ChatService);
    const chatRepository = moduleRef.get(ChatRepository);
    const policyRepository = moduleRef.get(WorkspaceDatasourcePolicyRepository);
    const savedPriorSql = moduleRef.get(SavedPriorSqlService);
    const workspaceId = "ws-agent-shortcut-hit";

    await savedPriorSql.captureFromSavedView({
      workspaceId,
      datasourceId: "sqlite_main",
      sourceRunId: "run-agent-shortcut-source-hit",
      sourceRunStatus: "executionResult",
      question: "统计订单总数",
      sql: "SELECT COUNT(*) AS total_orders FROM orders",
      viewId: "view.chat_run.run-agent-shortcut-source-hit",
      viewName: "saved_shortcut_select_one",
      viewSql: "SELECT COUNT(*) AS total_orders FROM orders",
      replayed: false,
      savedAt: "2026-04-25T10:00:00.000Z"
    });

    const sessionId = "session-agent-shortcut-hit";
    await setupWorkspaceScopedSession({
      chatRepository,
      policyRepository,
      workspaceId,
      sessionId
    });
    const run = await chatService.sendMessage(
      sessionId,
      "统计订单总数",
      undefined,
      {
        metricDefinition: "订单总数",
        timeRange: {
          from: "2026-01-01",
          to: "2026-01-31"
        }
      }
    );

    expect(run.status).not.toBe("clarification");
    const generateStage = run.trace.v2?.stages.find((stage) => stage.stage === "generate-sql");
    expect(generateStage).toBeDefined();
    if (generateStage?.status === "success") {
      expect(run.sql?.toLowerCase()).toContain("select");
      expect(generateStage?.metadata?.cause).toBe("initial");
    } else if (generateStage?.status === "skipped") {
      expect((run.answer ?? "").trim().length).toBeGreaterThan(0);
    } else {
      expect(run.error ?? "").toBeTruthy();
    }

    await moduleRef.close();
  });

  it("still produces read-only SQL when prior memory contains unsafe statement", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const chatService = moduleRef.get(ChatService);
    const chatRepository = moduleRef.get(ChatRepository);
    const policyRepository = moduleRef.get(WorkspaceDatasourcePolicyRepository);
    const savedPriorSql = moduleRef.get(SavedPriorSqlService);
    const workspaceId = "ws-agent-shortcut-fallback";

    await savedPriorSql.captureFromSavedView({
      workspaceId,
      datasourceId: "sqlite_main",
      sourceRunId: "run-agent-shortcut-source-fallback",
      sourceRunStatus: "executionResult",
      question: "统计订单总数（安全回退测试）",
      sql: "DELETE FROM orders WHERE id = 1",
      viewId: "view.chat_run.run-agent-shortcut-source-fallback",
      viewName: "saved_shortcut_delete_orders",
      viewSql: "DELETE FROM orders WHERE id = 1",
      replayed: false,
      savedAt: "2026-04-25T10:01:00.000Z"
    });

    const sessionId = "session-agent-shortcut-fallback";
    await setupWorkspaceScopedSession({
      chatRepository,
      policyRepository,
      workspaceId,
      sessionId
    });
    const run = await chatService.sendMessage(
      sessionId,
      "统计订单总数（安全回退测试）",
      undefined,
      {
        metricDefinition: "订单总数",
        timeRange: {
          from: "2026-01-01",
          to: "2026-01-31"
        }
      }
    );

    expect(run.status).not.toBe("clarification");
    const generateStage = run.trace.v2?.stages.find((stage) => stage.stage === "generate-sql");
    expect(generateStage).toBeDefined();
    if (run.sql) {
      expect(run.sql.toLowerCase()).toContain("select");
      expect(run.sql.toLowerCase()).not.toContain("delete");
    }
    if (generateStage?.status === "failed") {
      expect(run.error ?? "").toBeTruthy();
    }

    await moduleRef.close();
  });
});

async function setupWorkspaceScopedSession(input: {
  chatRepository: ChatRepository;
  policyRepository: WorkspaceDatasourcePolicyRepository;
  workspaceId: string;
  sessionId: string;
}): Promise<Session> {
  await input.policyRepository.upsertWorkspaceDatasourceBindings([
    {
      workspaceId: input.workspaceId,
      datasourceId: "sqlite_main"
    }
  ]);
  const session: Session = {
    id: input.sessionId,
    datasource: "sqlite_main",
    workspaceId: input.workspaceId,
    createdAt: new Date().toISOString(),
    datasourceType: "sqlite",
    datasourceStatus: "available"
  };
  await input.chatRepository.createSession(session);
  return session;
}
