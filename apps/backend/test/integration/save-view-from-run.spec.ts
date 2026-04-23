import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { SaveViewFromRunUsecase } from "../../src/modules/conversation/chat/application/save-view-from-run.usecase";
import { ModelingGraphRepository } from "../../src/modules/platform/data/persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "../../src/modules/platform/data/persistence/modeling-graph.validator";

const buildUsecase = () => {
  const chatRepository = new ChatRepository({
    databaseUrl: ""
  } as never);
  const modelingGraphRepository = new ModelingGraphRepository({
    databaseUrl: ""
  } as never);
  const modelingGraphValidator = new ModelingGraphValidator();
  const usecase = new SaveViewFromRunUsecase(
    chatRepository,
    modelingGraphRepository,
    modelingGraphValidator
  );
  return {
    usecase,
    chatRepository,
    modelingGraphRepository
  };
};

describe("save view from run integration", () => {
  it("saves sql run as modeling view and appends draft revision", async () => {
    const { usecase, chatRepository, modelingGraphRepository } = buildUsecase();

    await chatRepository.createSession({
      id: "session-1",
      datasource: "ds-1",
      workspaceId: "ws-1",
      title: "test",
      createdAt: "2026-04-23T00:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-1",
      sessionId: "session-1",
      question: "recent orders",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM orders LIMIT 10",
      trace: {
        runId: "run-1",
        provider: "openai",
        retryCount: 0,
        steps: []
      },
      createdAt: "2026-04-23T01:00:00.000Z"
    });

    const result = await usecase.execute({
      runId: "run-1",
      name: "orders_recent_10",
      actorId: "user-admin"
    });

    expect(result.replayed).toBe(false);
    expect(result.workspaceId).toBe("ws-1");
    expect(result.datasourceId).toBe("ds-1");
    expect(result.view.id).toBe("view.chat_run.run-1");
    expect(result.view.sql).toBe("SELECT * FROM orders LIMIT 10");

    const snapshot = await modelingGraphRepository.getLatestScopeState({
      workspaceId: "ws-1",
      datasourceId: "ds-1"
    });
    expect(snapshot.draft?.graphPayload.views).toEqual([
      expect.objectContaining({
        id: "view.chat_run.run-1",
        name: "orders_recent_10"
      })
    ]);
  });

  it("returns replayed response when same run has already been saved", async () => {
    const { usecase, chatRepository } = buildUsecase();
    await chatRepository.createSession({
      id: "session-1",
      datasource: "ds-1",
      workspaceId: "ws-1",
      title: "test",
      createdAt: "2026-04-23T00:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-1",
      sessionId: "session-1",
      question: "recent orders",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM orders LIMIT 10",
      trace: {
        runId: "run-1",
        provider: "openai",
        retryCount: 0,
        steps: []
      },
      createdAt: "2026-04-23T01:00:00.000Z"
    });

    const first = await usecase.execute({
      runId: "run-1",
      name: "orders_recent_10",
      actorId: "user-admin"
    });
    const second = await usecase.execute({
      runId: "run-1",
      name: "orders_recent_10",
      actorId: "user-admin"
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.view.id).toBe("view.chat_run.run-1");
  });

  it("rejects duplicate view name and invalid run id", async () => {
    const { usecase, chatRepository } = buildUsecase();
    await chatRepository.createSession({
      id: "session-1",
      datasource: "ds-1",
      workspaceId: "ws-1",
      title: "test",
      createdAt: "2026-04-23T00:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-1",
      sessionId: "session-1",
      question: "recent orders",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM orders LIMIT 10",
      trace: {
        runId: "run-1",
        provider: "openai",
        retryCount: 0,
        steps: []
      },
      createdAt: "2026-04-23T01:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-2",
      sessionId: "session-1",
      question: "recent customers",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM customers LIMIT 10",
      trace: {
        runId: "run-2",
        provider: "openai",
        retryCount: 0,
        steps: []
      },
      createdAt: "2026-04-23T01:10:00.000Z"
    });

    await usecase.execute({
      runId: "run-1",
      name: "recent_data",
      actorId: "user-admin"
    });

    await expect(
      usecase.execute({
        runId: "run-2",
        name: "recent_data",
        actorId: "user-admin"
      })
    ).rejects.toMatchObject({
      code: "MODELING_VIEW_NAME_CONFLICT"
    });

    await expect(
      usecase.execute({
        runId: "run-missing",
        name: "anything",
        actorId: "user-admin"
      })
    ).rejects.toMatchObject({
      code: "RUN_NOT_FOUND"
    });
  });
});
