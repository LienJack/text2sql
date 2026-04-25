import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@text2sql/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/chat-panel";
import {
  createSession,
  deleteSession,
  getMessages,
  getRun,
  listEnabledModels,
  listSessions,
  probeModelConnectivity,
  renameSession,
  setSessionModel,
  setSessionDebugEnabled,
  streamMessageEvents
} from "@/lib/api-client";
import { createMockMessages, createMockRun } from "./fixtures";

vi.mock("@/lib/api-client", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  listEnabledModels: vi.fn(),
  renameSession: vi.fn(),
  probeModelConnectivity: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionDebugEnabled: vi.fn(),
  deleteSession: vi.fn(),
  sendMessageStream: vi.fn(),
  streamMessageEvents: vi.fn(),
  getMessages: vi.fn(),
  getRun: vi.fn()
}));

const mockCreateSession = vi.mocked(createSession);
const mockListSessions = vi.mocked(listSessions);
const mockListEnabledModels = vi.mocked(listEnabledModels);
const mockRenameSession = vi.mocked(renameSession);
const mockProbeModelConnectivity = vi.mocked(probeModelConnectivity);
const mockSetSessionModel = vi.mocked(setSessionModel);
const mockSetSessionDebugEnabled = vi.mocked(setSessionDebugEnabled);
const mockDeleteSession = vi.mocked(deleteSession);
const mockStreamMessageEvents = vi.mocked(streamMessageEvents);
const mockGetMessages = vi.mocked(getMessages);
const mockGetRun = vi.mocked(getRun);

describe("ChatPanel", () => {
  let session: Session;

  beforeEach(() => {
    window.sessionStorage.setItem("text2sql.activeDatasourceId", "sqlite_main");
    session = {
      id: "session-1",
      datasource: "sqlite_main",
      datasourceName: "SQLite 主数据源",
      datasourceType: "sqlite",
      datasourceStatus: "available",
      title: "新会话",
      modelCatalogId: "model-1",
      modelProvider: "openai",
      modelName: "gpt-4o-mini",
      debugEnabled: false,
      syncStatus: "healthy" as const,
      createdAt: "2026-04-10T00:00:00.000Z"
    };
    mockListEnabledModels.mockResolvedValue([
      {
        id: "model-1",
        providerConfigId: "provider-openai",
        provider: "openai",
        model: "gpt-4o-mini",
        displayName: "GPT-4o mini",
        capabilities: ["chat"],
        contextWindow: 128000,
        enabled: true,
        healthStatus: "healthy",
        lastHealthCheckAt: "2026-04-10T00:00:00.000Z",
        lastSyncedAt: "2026-04-10T00:00:00.000Z",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      }
    ]);
    mockCreateSession.mockResolvedValue(session);
    mockListSessions.mockResolvedValue([session]);
    mockRenameSession.mockResolvedValue(session);
    mockProbeModelConnectivity.mockResolvedValue({
      ok: true,
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 120
    });
    mockSetSessionModel.mockResolvedValue(session);
    mockDeleteSession.mockResolvedValue({ deleted: true, sessionId: "session-1" });
    mockSetSessionDebugEnabled.mockResolvedValue({
      ...session,
      debugEnabled: true
    });
    mockStreamMessageEvents.mockImplementation(async function* () {
      yield {
        type: "start",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          requestId: null
        }
      };
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          node: "generate-sql",
          status: "success",
          stepId: "run-1:generate-sql:1",
          sequence: 1,
          lifecycle: "completed",
          detail: "volcengine",
          stage: "generation",
          title: "生成 SQL",
          durationMs: 18
        }
      };
      yield {
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT payment_method"
        }
      };
      yield {
        type: "finish",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          status: "executionResult",
          rowCount: 1
        }
      };
    });
    mockGetMessages.mockResolvedValue({
      session,
      messages: createMockMessages(),
      latestRun: createMockRun()
    });
    mockGetRun.mockResolvedValue(createMockRun());
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("renders disabled submit button when input is empty", async () => {
    render(<ChatPanel />);
    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("keeps advanced context panel collapsed by default", async () => {
    render(<ChatPanel />);
    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);

    const advancedContextButton = screen.getByRole("button", {
      name: "展开高级上下文"
    });
    expect(advancedContextButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("指标口径")).not.toBeInTheDocument();
  });

  it("sends message and keeps sql preview available in chat flow", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
      expect(mockGetMessages).toHaveBeenCalledWith("session-1");
    });

    expect(screen.queryByText("发送成功，已收到后端响应。")).not.toBeInTheDocument();
    expect(screen.getByText("AI 思考过程")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-result-shell")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-result-shell-steps")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-result-shell-answer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开思考过程" }));
    expect(screen.getByText("生成 SQL")).toBeInTheDocument();
    expect(screen.getByText("已为你生成 SQL，并展示结果。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 SQL 详情" }));
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "设置 / RAG 运行与记忆治理" })
    ).toHaveAttribute("href", "/settings?tab=rag&runId=run-1");
  });

  it("submits by pressing Enter in chat input", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    expect(mockStreamMessageEvents).not.toHaveBeenCalled();
    const input = screen.getByLabelText("聊天输入");
    await user.type(input, "有多少订单");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalledTimes(1);
    });
  });

  it("submits immediately after IME composition confirms with Enter", async () => {
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    expect(mockStreamMessageEvents).not.toHaveBeenCalled();
    const input = screen.getByLabelText("聊天输入");

    fireEvent.change(input, { target: { value: "有多少订单" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalledTimes(1);
    });
  });

  it("submits after IME confirm emits Process key before composition end", async () => {
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    expect(mockStreamMessageEvents).not.toHaveBeenCalled();
    const input = screen.getByLabelText("聊天输入");

    fireEvent.change(input, { target: { value: "有多少订单" } });
    fireEvent.keyDown(input, {
      key: "Process",
      code: "Enter",
      isComposing: true
    });
    fireEvent.compositionEnd(input);

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalledTimes(1);
    });
  });

  it("does not render debug switch control", async () => {
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    expect(screen.queryByLabelText("调试详情开关")).not.toBeInTheDocument();
    expect(mockSetSessionDebugEnabled).not.toHaveBeenCalled();
  });

  it("lazy loads run details for historical assistant messages", async () => {
    const user = userEvent.setup();
    mockGetMessages.mockResolvedValueOnce({
      session,
      messages: createMockMessages(),
      latestRun: undefined
    });

    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await screen.findByText("已为你生成 SQL，并展示结果。");
    expect(screen.getByTestId("assistant-result-shell")).toHaveAttribute("data-run-id", "run-1");
    await user.click(await screen.findByRole("button", { name: "展开思考过程" }));

    await waitFor(() => {
      expect(mockGetRun).toHaveBeenCalledWith("run-1");
    });
  });

  it("keeps unified assistant result shell readable when historical run load fails", async () => {
    const user = userEvent.setup();
    mockGetMessages.mockResolvedValueOnce({
      session,
      messages: createMockMessages(),
      latestRun: undefined
    });
    mockGetRun.mockRejectedValueOnce(new Error("run not found"));

    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await screen.findByText("已为你生成 SQL，并展示结果。");
    const resultShell = screen.getByTestId("assistant-result-shell");
    expect(resultShell).toHaveAttribute("data-run-id", "run-1");

    await user.click(screen.getByRole("button", { name: "展开思考过程" }));
    await waitFor(() => {
      expect(mockGetRun).toHaveBeenCalledWith("run-1");
    });

    expect(screen.getByText("已为你生成 SQL，并展示结果。")).toBeInTheDocument();
    expect(screen.getByText("暂未加载到该轮思考轨迹。")).toBeInTheDocument();
  });

  it("keeps run link bindings isolated per assistant message", async () => {
    const run2 = createMockRun({
      runId: "run-2",
      question: "近7天支付方式分布",
      sql: "SELECT payment_method, COUNT(*) AS cnt FROM recent_orders GROUP BY payment_method"
    });
    mockGetMessages.mockResolvedValueOnce({
      session,
      messages: [
        {
          id: "msg-1",
          sessionId: "session-1",
          role: "user",
          content: "近30天支付方式分布",
          createdAt: "2026-04-10T00:00:00.000Z"
        },
        {
          id: "msg-2",
          sessionId: "session-1",
          role: "assistant",
          content: "第一轮回答",
          metadata: {
            runId: "run-1",
            status: "executionResult"
          },
          createdAt: "2026-04-10T00:00:01.000Z"
        },
        {
          id: "msg-3",
          sessionId: "session-1",
          role: "user",
          content: "近7天支付方式分布",
          createdAt: "2026-04-10T00:01:00.000Z"
        },
        {
          id: "msg-4",
          sessionId: "session-1",
          role: "assistant",
          content: "第二轮回答",
          metadata: {
            runId: "run-2",
            status: "executionResult"
          },
          createdAt: "2026-04-10T00:01:01.000Z"
        }
      ],
      latestRun: run2
    });

    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await screen.findByText("第一轮回答");
    await screen.findByText("第二轮回答");

    const runLinks = screen.getAllByRole("link", {
      name: "设置 / RAG 运行与记忆治理"
    });
    expect(runLinks).toHaveLength(2);
    expect(runLinks[0]).toHaveAttribute("href", "/settings?tab=rag&runId=run-1");
    expect(runLinks[1]).toHaveAttribute("href", "/settings?tab=rag&runId=run-2");

    const resultShells = screen.getAllByTestId("assistant-result-shell");
    expect(resultShells).toHaveLength(2);
    expect(resultShells[0]).toHaveAttribute("data-run-id", "run-1");
    expect(resultShells[1]).toHaveAttribute("data-run-id", "run-2");
  });

  it("shows initialization failure when session creation fails", async () => {
    mockListSessions.mockRejectedValueOnce(new Error("初始化失败"));

    render(<ChatPanel />);

    expect(await screen.findByText("初始化失败")).toBeInTheDocument();
    expect(mockStreamMessageEvents).not.toHaveBeenCalled();
  });

  it("shows thinking indicator immediately before first stream event arrives", async () => {
    const user = userEvent.setup();
    let releaseFirstEvent: (() => void) | undefined;
    const firstEventGate = new Promise<void>((resolve) => {
      releaseFirstEvent = resolve;
    });
    mockStreamMessageEvents.mockImplementationOnce(async function* () {
      await firstEventGate;
      yield {
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT payment_method"
        }
      };
      yield {
        type: "finish",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          status: "executionResult",
          rowCount: 1
        }
      };
    });

    render(<ChatPanel />);
    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);

    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/思考中/)).toBeInTheDocument();
    if (releaseFirstEvent) {
      releaseFirstEvent();
    }
  });

  it("handles stream error events without unhandled promise rejection", async () => {
    const user = userEvent.setup();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    try {
      mockStreamMessageEvents.mockImplementationOnce(async function* () {
        yield {
          type: "start",
          runId: "run-1",
          sessionId: "session-1",
          at: "2026-04-10T00:00:00.000Z",
          data: {
            requestId: null
          }
        };
        yield {
          type: "error",
          runId: "run-1",
          sessionId: "session-1",
          at: "2026-04-10T00:00:00.100Z",
          data: {
            message: "LLM 输出中未提取到可执行 SQL。"
          }
        };
      });

      render(<ChatPanel />);
      await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
      const getMessagesCallsBeforeSend = mockGetMessages.mock.calls.length;

      await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
      await user.click(screen.getByRole("button", { name: "发送" }));

      await waitFor(() => {
        expect(mockGetMessages.mock.calls.length).toBeGreaterThan(
          getMessagesCallsBeforeSend
        );
      });
      expect(
        await screen.findByText("LLM 输出中未提取到可执行 SQL。")
      ).toBeInTheDocument();
      expect(unhandledRejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
  });

  it("keeps stream request payload unchanged when advanced context is not provided", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });

    const latestCall = mockStreamMessageEvents.mock.calls.at(-1);
    expect(latestCall?.[0]).toBe("session-1");
    expect(latestCall?.[1]).toBe("近30天支付方式分布");
    expect(latestCall?.[3]).toBeUndefined();
  });

  it("injects advanced context envelope into stream request and clears it after send by default", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);

    await user.click(
      screen.getByRole("button", {
        name: "展开高级上下文"
      })
    );

    await user.type(
      screen.getByLabelText("指标口径"),
      "按支付成功口径统计订单"
    );
    await user.type(screen.getByLabelText("开始日期"), "2026-03-01");
    await user.type(screen.getByLabelText("结束日期"), "2026-03-31");
    await user.type(
      screen.getByLabelText("实体映射"),
      "华北大区=region_north"
    );

    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });

    const latestCall = mockStreamMessageEvents.mock.calls.at(-1);
    expect(latestCall?.[3]).toEqual({
      metricDefinition: "按支付成功口径统计订单",
      timeRange: {
        from: "2026-03-01",
        to: "2026-03-31"
      },
      entityMappings: [
        {
          entity: "华北大区",
          mappedTo: "region_north"
        }
      ]
    });

    await user.click(
      screen.getByRole("button", {
        name: "展开高级上下文"
      })
    );
    expect(screen.getByLabelText("指标口径")).toHaveValue("");
  });

  it("keeps run detail entry visible while run backfill is still loading", async () => {
    const user = userEvent.setup();
    let resolveRun: (() => void) | undefined;
    const runBackfillGate = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    mockGetMessages
      .mockResolvedValueOnce({
        session,
        messages: createMockMessages(),
        latestRun: undefined
      })
      .mockResolvedValueOnce({
        session,
        messages: createMockMessages(),
        latestRun: undefined
      });
    mockGetRun.mockImplementationOnce(async () => {
      await runBackfillGate;
      return createMockRun();
    });

    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("已为你生成 SQL，并展示结果。");
    await user.click(screen.getByRole("button", { name: "展开 SQL 详情" }));
    expect(screen.getByText("运行详情回填中，请稍候...")).toBeInTheDocument();

    if (resolveRun) {
      resolveRun();
    }
  }, 15000);

  it("shows phase-b retrieval stages and run detail summary signals for the same run", async () => {
    const user = userEvent.setup();
    const phaseBRun = createMockRun({
      trace: {
        runId: "run-1",
        provider: "mock",
        retryCount: 0,
        steps: [
          {
            node: "retrieve_knowledge",
            status: "success",
            stepId: "run-1:retrieve_knowledge:1",
            sequence: 1,
            lifecycle: "completed",
            at: "2026-04-10T00:00:00.000Z"
          },
          {
            node: "build_intent_plan",
            status: "success",
            stepId: "run-1:build_intent_plan:2",
            sequence: 2,
            lifecycle: "completed",
            at: "2026-04-10T00:00:01.000Z"
          },
          {
            node: "build_semantic_query",
            status: "success",
            stepId: "run-1:build_semantic_query:3",
            sequence: 3,
            lifecycle: "completed",
            at: "2026-04-10T00:00:02.000Z"
          }
        ]
      },
      delivery: {
        answer: {
          text: "已为你生成 SQL，并展示结果。",
          status: "executionResult",
          provider: "mock"
        },
        evidence: {
          runId: "run-1",
          retrievalStatus: "degraded",
          degradeReasons: ["retrieval_timeout"],
          selectedContext: {
            count: 0
          },
          riskTags: ["semantic_registry_degraded"]
        }
      }
    });

    mockGetMessages.mockResolvedValue({
      session,
      messages: createMockMessages(),
      latestRun: phaseBRun
    });
    mockGetRun.mockResolvedValue(phaseBRun);
    mockStreamMessageEvents.mockImplementationOnce(async function* () {
      yield {
        type: "start",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: { requestId: null }
      };
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          node: "retrieve_knowledge",
          status: "success",
          stepId: "run-1:retrieve_knowledge:1",
          sequence: 1,
          lifecycle: "completed",
          detail: "hit=2"
        }
      };
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:01.000Z",
        data: {
          node: "build_intent_plan",
          status: "success",
          stepId: "run-1:build_intent_plan:2",
          sequence: 2,
          lifecycle: "completed",
          detail: "intent=payment_distribution"
        }
      };
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:02.000Z",
        data: {
          node: "build_semantic_query",
          status: "success",
          stepId: "run-1:build_semantic_query:3",
          sequence: 3,
          lifecycle: "completed",
          detail: "semantic=orders.payment_method"
        }
      };
      yield {
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:03.000Z",
        data: {
          text: "SELECT payment_method"
        }
      };
      yield {
        type: "finish",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:04.000Z",
        data: {
          status: "executionResult",
          rowCount: 1,
          delivery: {
            answer: {
              text: "已为你生成 SQL，并展示结果。",
              status: "executionResult",
              provider: "mock"
            },
            evidence: {
              runId: "run-1",
              retrievalStatus: "degraded",
              degradeReasons: ["retrieval_timeout"],
              selectedContext: {
                count: 0
              },
              riskTags: ["semantic_registry_degraded"]
            }
          }
        }
      };
    });

    render(<ChatPanel />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "展开思考过程" }));
    expect(screen.getByText("知识检索")).toBeInTheDocument();
    expect(screen.getByText("意图规划")).toBeInTheDocument();
    expect(screen.getByText("语义检索构建")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 SQL 详情" }));
    expect(screen.getByText("运行详情")).toBeInTheDocument();
    expect(screen.getByText("degrade_reason：retrieval_timeout")).toBeInTheDocument();
    expect(screen.getByText("semantic_registry_degraded")).toBeInTheDocument();
    expect(screen.getByText("运行 ID：run-1")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "设置 / RAG 运行与记忆治理" })
    ).toHaveAttribute("href", "/settings?tab=rag&runId=run-1");
  });
});
