import { render, screen, waitFor } from "@testing-library/react";
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

describe("chat mobile smoke", () => {
  const run = createMockRun({
    delivery: {
      answer: {
        text: "已为你生成 SQL，并展示结果。",
        status: "executionResult",
        provider: "mock-provider"
      },
      evidence: {
        runId: "run-1",
        retrievalStatus: "ready",
        selectedContext: {
          count: 1,
          snippets: ["schema.orders"]
        }
      },
      artifact: {
        sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
        rowCount: 1,
        hasError: false,
        summary: {
          text: "移动端默认展示 Summary，支持快速切换到 SQL。"
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
  });

  beforeEach(() => {
    window.sessionStorage.setItem("text2sql.activeDatasourceId", "sqlite_main");
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375
    });
    window.dispatchEvent(new Event("resize"));

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
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT 1"
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
      latestRun: run
    });
    mockGetRun.mockResolvedValue(run);
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("renders mobile-usable chat controls and progressive delivery toggles", async () => {
    const user = userEvent.setup();
    render(<ChatPage />);
    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);

    expect(screen.getByLabelText("聊天输入")).toBeEnabled();
    expect(screen.getByRole("button", { name: "结果详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "会话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结果详情" }));
    const answerTrigger = await screen.findByRole("button", {
      name: "切换 Answer 区块"
    });
    const evidenceTrigger = screen.getByRole("button", {
      name: "切换 Evidence 区块"
    });
    expect(answerTrigger).toBeInTheDocument();
    expect(evidenceTrigger).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换 Artifact 区块" })).toBeInTheDocument();

    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "false");
    evidenceTrigger.focus();
    await user.keyboard("{Enter}");
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "true");
    evidenceTrigger.focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(evidenceTrigger).toHaveAttribute("aria-expanded", "false");
    });

    await user.type(screen.getByLabelText("聊天输入"), "移动端发送链路回归");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });

    const summaryTab = screen.getByRole("tab", { name: /summary/i });
    const chartTab = screen.getByRole("tab", { name: /chart/i });
    const sqlTab = screen.getByRole("tab", { name: /SQL 分区/i });
    expect(summaryTab).toHaveAttribute("aria-selected", "true");
    expect(chartTab).toHaveAttribute("aria-controls");
    expect(sqlTab).toHaveAttribute("aria-controls");

    chartTab.focus();
    await user.keyboard("{Enter}");
    expect(chartTab).toHaveAttribute("aria-selected", "true");

    sqlTab.focus();
    await user.keyboard("[Space]");
    expect(sqlTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "打开运行详情" })).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "设置 / RAG 运行与记忆治理" })
    ).toHaveAttribute("href", "/settings?tab=rag&runId=run-1");
  });
});
