import { DomainError } from "../../src/common/domain-error";
import { Text2SQLWorkflowRunner } from "../../src/modules/conversation/text2sql/text2sql-workflow-runner.service";

describe("Text2SQLWorkflowRunner", () => {
  const createPrepared = () => ({
    runId: "run-1",
    session: {
      id: "session-1",
      datasource: "sqlite_main",
      modelProvider: "volcengine",
      modelName: "mock-model"
    },
    datasource: {
      id: "sqlite_main",
      type: "sqlite"
    },
    sqlAccessContext: undefined,
    question: "统计订单总数",
    requestId: "req-1",
    contextEnvelope: undefined,
    userPersistResult: {
      primaryPersisted: true
    }
  });

  const createRun = (patch?: Partial<any>) => ({
    runId: "run-1",
    sessionId: "session-1",
    question: "统计订单总数",
    status: "executionResult",
    provider: "volcengine",
    model: "mock-model",
    trace: {
      runId: "run-1",
      provider: "volcengine",
      retryCount: 0,
      steps: []
    },
    llmRaw: null,
    createdAt: "2026-04-26T00:00:00.000Z",
    ...patch
  });

  it("routes sync flow through prepare -> graph -> enrich -> persist -> hooks", async () => {
    const datasourceRegistry = {
      shouldFallbackOnReject: jest.fn().mockReturnValue(false)
    };
    const prepareRunStage = {
      run: jest.fn().mockResolvedValue(createPrepared())
    };
    const runAgentGraphStage = {
      runSync: jest.fn().mockResolvedValue(createRun()),
      runStream: jest.fn()
    };
    const enrichDeliveryStage = {
      run: jest.fn(async (run) => ({
        ...run,
        delivery: {
          answer: {
            text: "已完成分析",
            status: run.status,
            provider: run.provider
          }
        }
      }))
    };
    const persistRunStage = {
      run: jest.fn().mockResolvedValue(undefined)
    };
    const postRunHooksStage = {
      run: jest.fn().mockResolvedValue(undefined)
    };
    const streamEventMapper = {
      createEnvelope: jest.fn(),
      mapLlmEvent: jest.fn(),
      mapStepEvent: jest.fn()
    };

    const runner = new Text2SQLWorkflowRunner(
      datasourceRegistry as never,
      prepareRunStage as never,
      runAgentGraphStage as never,
      enrichDeliveryStage as never,
      persistRunStage as never,
      postRunHooksStage as never,
      streamEventMapper as never
    );

    const result = await runner.runSync({
      sessionId: "session-1",
      message: "统计订单总数"
    });

    expect(prepareRunStage.run).toHaveBeenCalledTimes(1);
    expect(runAgentGraphStage.runSync).toHaveBeenCalledWith(
      createPrepared(),
      "/api/v1/sessions/:sessionId/messages"
    );
    expect(enrichDeliveryStage.run).toHaveBeenCalledTimes(1);
    expect(persistRunStage.run).toHaveBeenCalledWith({
      sessionId: "session-1",
      run: result,
      userPrimaryPersisted: true
    });
    expect(postRunHooksStage.run).toHaveBeenCalledWith({
      session: createPrepared().session,
      run: result,
      requestId: "req-1"
    });
  });

  it("adds readonly fallback answer for rejected runs when datasource allows fallback", async () => {
    const datasourceRegistry = {
      shouldFallbackOnReject: jest.fn().mockReturnValue(true)
    };
    const prepareRunStage = {
      run: jest.fn().mockResolvedValue(createPrepared())
    };
    const runAgentGraphStage = {
      runSync: jest.fn().mockResolvedValue(
        createRun({
          status: "rejected",
          answer: undefined
        })
      ),
      runStream: jest.fn()
    };
    const enrichDeliveryStage = {
      run: jest.fn(async (run) => run)
    };

    const runner = new Text2SQLWorkflowRunner(
      datasourceRegistry as never,
      prepareRunStage as never,
      runAgentGraphStage as never,
      enrichDeliveryStage as never,
      { run: jest.fn().mockResolvedValue(undefined) } as never,
      { run: jest.fn().mockResolvedValue(undefined) } as never,
      {
        createEnvelope: jest.fn(),
        mapLlmEvent: jest.fn(),
        mapStepEvent: jest.fn()
      } as never
    );

    const result = await runner.runSync({
      sessionId: "session-1",
      message: "DELETE orders where id = 1"
    });

    expect(result.status).toBe("rejected");
    expect(result.answer).toContain("只读安全策略");
  });

  it("keeps stream run id consistent across start and finish envelopes", async () => {
    const prepared = createPrepared();
    const datasourceRegistry = {
      shouldFallbackOnReject: jest.fn().mockReturnValue(false)
    };
    const prepareRunStage = {
      run: jest.fn().mockResolvedValue(prepared)
    };
    const runAgentGraphStage = {
      runSync: jest.fn(),
      runStream: jest.fn(async (_input, _route, options) => {
        await options?.onLlmEvent?.({ type: "text-delta", text: "delta" });
        await options?.onStep?.({
          step: {
            node: "clarify",
            status: "success",
            at: "2026-04-26T00:00:01.000Z"
          }
        });
        return createRun();
      })
    };

    const streamEventMapper = {
      createEnvelope: jest.fn(({ type, data, runId, sessionId }) => ({
        type,
        data,
        runId,
        sessionId,
        at: "2026-04-26T00:00:02.000Z"
      })),
      mapLlmEvent: jest.fn(() => ({
        type: "text-delta",
        data: {
          text: "delta"
        }
      })),
      mapStepEvent: jest.fn(() => ({
        data: {
          node: "clarify",
          status: "success",
          detail: "",
          stage: "analysis",
          title: "理解问题"
        },
        nextSequence: 1
      }))
    };

    const persistRunStage = {
      run: jest.fn().mockResolvedValue(undefined)
    };

    const runner = new Text2SQLWorkflowRunner(
      datasourceRegistry as never,
      prepareRunStage as never,
      runAgentGraphStage as never,
      { run: jest.fn(async (run) => run) } as never,
      persistRunStage as never,
      { run: jest.fn().mockResolvedValue(undefined) } as never,
      streamEventMapper as never
    );

    const events: Array<{ type: string; runId: string }> = [];
    await runner.runStream({
      sessionId: "session-1",
      message: "统计订单总数",
      onEvent: (event) => {
        events.push({
          type: event.type,
          runId: event.runId
        });
      }
    });

    expect(events.map((item) => item.type)).toEqual([
      "start",
      "text-delta",
      "state",
      "finish"
    ]);
    expect(new Set(events.map((item) => item.runId))).toEqual(new Set(["run-1"]));
    expect(persistRunStage.run).toHaveBeenCalledTimes(1);
  });

  it("emits stream error event and persists failed run on graph failure", async () => {
    const prepared = createPrepared();
    const runner = new Text2SQLWorkflowRunner(
      {
        shouldFallbackOnReject: jest.fn().mockReturnValue(false)
      } as never,
      {
        run: jest.fn().mockResolvedValue(prepared)
      } as never,
      {
        runSync: jest.fn(),
        runStream: jest
          .fn()
          .mockRejectedValue(new DomainError("GRAPH_FAILED", "图执行失败", 500))
      } as never,
      {
        run: jest.fn(async (run) => run)
      } as never,
      {
        run: jest.fn().mockResolvedValue(undefined)
      } as never,
      {
        run: jest.fn().mockResolvedValue(undefined)
      } as never,
      {
        createEnvelope: jest.fn(({ type, data, runId, sessionId }) => ({
          type,
          data,
          runId,
          sessionId,
          at: "2026-04-26T00:00:02.000Z"
        })),
        mapLlmEvent: jest.fn(),
        mapStepEvent: jest.fn()
      } as never
    );

    const events: Array<{ type: string; code?: string }> = [];
    const run = await runner.runStream({
      sessionId: "session-1",
      message: "统计订单总数",
      onEvent: (event) => {
        events.push({
          type: event.type,
          code: (event.data as { code?: string }).code
        });
      }
    });

    expect(run.status).toBe("failed");
    expect(events.map((item) => item.type)).toEqual(["start", "error"]);
    expect(events[1]?.code).toBe("GRAPH_FAILED");
  });
});
