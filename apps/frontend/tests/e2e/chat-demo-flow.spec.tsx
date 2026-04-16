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
    render(<ChatPage />);

    await screen.findByText(/Datasource: sqlite_main · Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "统计订单支付方式");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockStreamMessageEvents).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "展开 SQL 详情" }));
    expect(screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "payment_method" })).toBeInTheDocument();
  });
});
