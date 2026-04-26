import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { SaveViewFromRunUsecase } from "../../src/modules/conversation/chat/application/save-view-from-run.usecase";
import type { KnowledgeMemoryContract } from "../../src/modules/knowledge/contracts/knowledge-memory.contract";
import { ModelingGraphRepository } from "../../src/modules/platform/data/persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "../../src/modules/platform/data/persistence/modeling-graph.validator";

const V2_STAGE_ORDER = [
  "intake",
  "retrieve",
  "assemble-context",
  "semantic-plan",
  "generate-sql",
  "validate",
  "correct",
  "execute",
  "answer"
] as const;

const createV2Trace = (runId: string, provider = "openai") => ({
  runId,
  provider,
  retryCount: 0,
  steps: [],
  v2: {
    version: "v2" as const,
    stageOrder: [...V2_STAGE_ORDER],
    stages: V2_STAGE_ORDER.map((stage) => ({
      stage,
      status:
        stage === "correct"
          ? ("skipped" as const)
          : ("success" as const)
    }))
  }
});

const buildUsecase = (knowledgeMemoryContract?: KnowledgeMemoryContract) => {
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
    modelingGraphValidator,
    knowledgeMemoryContract
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
      trace: createV2Trace("run-1"),
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
      trace: createV2Trace("run-1"),
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

  it("keeps replay idempotency for an already-saved run before name conflict checks", async () => {
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
      trace: createV2Trace("run-1"),
      createdAt: "2026-04-23T01:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-2",
      sessionId: "session-1",
      question: "recent customers",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM customers LIMIT 10",
      trace: createV2Trace("run-2"),
      createdAt: "2026-04-23T01:10:00.000Z"
    });

    await usecase.execute({
      runId: "run-1",
      name: "orders_recent_10",
      actorId: "user-admin"
    });
    await usecase.execute({
      runId: "run-2",
      name: "customers_recent_10",
      actorId: "user-admin"
    });

    const replayed = await usecase.execute({
      runId: "run-1",
      name: "customers_recent_10",
      actorId: "user-admin"
    });

    expect(replayed.replayed).toBe(true);
    expect(replayed.view.id).toBe("view.chat_run.run-1");
    expect(replayed.view.name).toBe("orders_recent_10");
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
      trace: createV2Trace("run-1"),
      createdAt: "2026-04-23T01:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-2",
      sessionId: "session-1",
      question: "recent customers",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT * FROM customers LIMIT 10",
      trace: createV2Trace("run-2"),
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

  it("keeps save-as-view successful when saved prior sql capture throws", async () => {
    const captureFromSavedView = jest
      .fn()
      .mockRejectedValue(new Error("replay write failed"));
    const { usecase, chatRepository, modelingGraphRepository } = buildUsecase({
      promotion: {
        promoteFromRun: jest.fn(),
        getRecord: jest.fn(),
        listCompensations: jest.fn(),
        buildCandidateIdForRun: jest.fn(),
        applyFeedback: jest.fn()
      } as never,
      savedPriorSql: {
        captureFromSavedView,
        getRecord: jest.fn(),
        listRecords: jest.fn(),
        buildPriorId: jest
          .fn()
          .mockReturnValue("saved_prior_sql.test-prior-id")
      }
    } as KnowledgeMemoryContract);

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
      trace: createV2Trace("run-1"),
      createdAt: "2026-04-23T01:00:00.000Z"
    });

    const result = await usecase.execute({
      runId: "run-1",
      name: "orders_recent_10",
      actorId: "user-admin"
    });

    expect(result.replayed).toBe(false);
    expect(result.savedPriorSql).toEqual(
      expect.objectContaining({
        outcome: "capture_failed",
        priorId: "saved_prior_sql.test-prior-id",
        reason: "saved_prior_sql_capture_exception"
      })
    );
    expect(captureFromSavedView).toHaveBeenCalledTimes(1);

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

  it("rejects unsupported historical run shape with deterministic hard-cut error", async () => {
    const { usecase, chatRepository } = buildUsecase();
    await chatRepository.createSession({
      id: "session-legacy",
      datasource: "ds-1",
      workspaceId: "ws-1",
      title: "legacy",
      createdAt: "2026-04-23T00:00:00.000Z"
    });
    await chatRepository.persistRun({
      runId: "run-legacy",
      sessionId: "session-legacy",
      question: "legacy",
      status: "executionResult",
      provider: "openai",
      sql: "SELECT 1",
      trace: {
        runId: "run-legacy",
        provider: "openai",
        retryCount: 0,
        steps: []
      },
      createdAt: "2026-04-23T01:00:00.000Z"
    });

    await expect(
      usecase.execute({
        runId: "run-legacy",
        name: "legacy_saved_view",
        actorId: "user-admin"
      })
    ).rejects.toMatchObject({
      code: "LEGACY_RUN_UNSUPPORTED",
      statusCode: 410
    });
  });
});
