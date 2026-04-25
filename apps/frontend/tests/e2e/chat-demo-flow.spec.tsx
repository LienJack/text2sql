import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@text2sql/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
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
import { createMockMessages, createMockRun } from "../unit/fixtures";

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

describe("chat demo flow", () => {
  beforeEach(() => {
    window.sessionStorage.setItem("text2sql.activeDatasourceId", "sqlite_main");
    const session: Session = {
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
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method"
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
      latestRun: createMockRun({
        sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
        explanation: "统计订单支付方式分布。"
      })
    });
    mockGetRun.mockResolvedValue(createMockRun());
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("completes send and preview flow", async () => {
    const user = userEvent.setup();
    const emittedEventTypes: string[] = [];
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
            count: 2,
            snippets: ["用户显式：时间范围: 近30天", "系统推断：schema.orders"]
          },
          riskTags: [
            "semantic_registry_degraded",
            "context:user-explicit",
            "context:system-inferred"
          ]
        },
        artifact: {
          sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
          rowCount: 1,
          hasError: false,
          summary: {
            headline: "支付方式分布",
            text: "近 30 天订单主要由 card 支付。"
          },
          table: {
            columns: ["payment_method", "cnt"],
            rowCount: 1,
            rowsPreview: [{ payment_method: "card", cnt: 12 }],
            previewRowCount: 1
          },
          chart: {
            type: "bar",
            mappings: {
              x: "payment_method",
              y: "cnt"
            },
            meta: {
              title: "支付方式分布"
            }
          },
          display: "bar",
          validation: {
            status: "valid"
          }
        }
      }
    });
    mockGetMessages.mockResolvedValue({
      session: {
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
      },
      messages: createMockMessages(),
      latestRun: phaseBRun
    });
    mockGetRun.mockResolvedValue(phaseBRun);

    let releaseFirstEvent: (() => void) | undefined;
    const firstEventGate = new Promise<void>((resolve) => {
      releaseFirstEvent = resolve;
    });
    mockStreamMessageEvents.mockImplementationOnce(async function* () {
      await firstEventGate;
      emittedEventTypes.push("start");
      yield {
        type: "start",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          requestId: null
        }
      };
      emittedEventTypes.push("state");
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          node: "retrieve_knowledge",
          status: "success",
          detail: "检索知识",
          stepId: "run-1:retrieve_knowledge:1",
          sequence: 1,
          lifecycle: "completed",
          stage: "analysis"
        }
      };
      emittedEventTypes.push("state");
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          node: "build_intent_plan",
          status: "success",
          detail: "构建意图计划",
          stepId: "run-1:build_intent_plan:2",
          sequence: 2,
          lifecycle: "completed",
          stage: "analysis"
        }
      };
      emittedEventTypes.push("state");
      yield {
        type: "state",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          node: "build_semantic_query",
          status: "success",
          detail: "构建语义检索",
          stepId: "run-1:build_semantic_query:3",
          sequence: 3,
          lifecycle: "completed",
          stage: "analysis"
        }
      };
      emittedEventTypes.push("text-delta");
      yield {
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method"
        }
      };
      emittedEventTypes.push("finish");
      yield {
        type: "finish",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
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
                count: 2,
                snippets: ["用户显式：时间范围: 近30天", "系统推断：schema.orders"]
              },
              riskTags: [
                "semantic_registry_degraded",
                "context:user-explicit",
                "context:system-inferred"
              ]
            },
            artifact: {
              sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
              rowCount: 1,
              hasError: false,
              summary: {
                text: "近 30 天订单主要由 card 支付。"
              },
              table: {
                columns: ["payment_method", "cnt"],
                rowCount: 1,
                rowsPreview: [{ payment_method: "card", cnt: 12 }],
                previewRowCount: 1
              },
              chart: {
                type: "bar",
                mappings: {
                  x: "payment_method",
                  y: "cnt"
                }
              },
              display: "bar",
              validation: {
                status: "valid"
              }
            }
          }
        }
      };
    });

    const { unmount } = render(<ChatPage />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    const initialGetMessagesCalls = mockGetMessages.mock.calls.length;
    await user.type(screen.getByLabelText("聊天输入"), "统计订单支付方式");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/思考中/)).toBeInTheDocument();
    releaseFirstEvent?.();

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/思考中/)).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockGetMessages.mock.calls.length).toBeGreaterThan(
        initialGetMessagesCalls
      );
    });
    expect(emittedEventTypes).toEqual([
      "start",
      "state",
      "state",
      "state",
      "text-delta",
      "finish"
    ]);

    await user.click(screen.getByRole("button", { name: "展开思考过程" }));
    expect(screen.getByText("知识检索")).toBeInTheDocument();
    expect(screen.getByText("意图规划")).toBeInTheDocument();
    expect(screen.getByText("语义检索构建")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-result-shell")).toHaveAttribute("data-run-id", "run-1");

    const resultPanel = await screen.findByTestId("chatbi-result-panel");
    const resultQueries = within(resultPanel);
    const answerTab = resultQueries.getByRole("tab", { name: /answer/i });
    expect(answerTab).toHaveAttribute("aria-selected", "true");
    expect(resultQueries.getByText("近 30 天订单主要由 card 支付。")).toBeInTheDocument();
    expect(resultQueries.getByRole("columnheader", { name: "payment_method" })).toBeInTheDocument();

    await user.click(resultQueries.getByRole("tab", { name: /chart/i }));
    expect(resultQueries.getByTestId("chatbi-bar-chart")).toBeInTheDocument();

    await user.click(resultQueries.getByRole("tab", { name: /view sql/i }));
    await user.click(resultQueries.getByRole("button", { name: "打开运行详情" }));
    expect(screen.getByText("运行详情")).toBeInTheDocument();
    expect(screen.getByText("运行 ID：run-1")).toBeInTheDocument();
    expect(screen.getByText("degrade_reason：retrieval_timeout")).toBeInTheDocument();
    expect(screen.getByText("semantic_registry_degraded")).toBeInTheDocument();
    expect(screen.getByText("context:user-explicit")).toBeInTheDocument();
    expect(screen.getByText("context:system-inferred")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "设置 / RAG 运行与记忆治理" })
    ).toHaveAttribute("href", "/settings?tab=rag&runId=run-1");
    expect(
      screen.getAllByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method").length
    ).toBeGreaterThan(0);

    unmount();
    render(<ChatPage />);
    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    const replayShell = await screen.findByTestId("assistant-result-shell");
    expect(replayShell).toHaveAttribute("data-run-id", "run-1");
    expect(screen.getByRole("tab", { name: /answer/i })).toHaveAttribute("aria-selected", "true");
  });
});
