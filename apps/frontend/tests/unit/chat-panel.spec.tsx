import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/chat-panel";
import {
  createSession,
  deleteSession,
  getMessages,
  listEnabledModels,
  listSessions,
  renameSession,
  setSessionModel,
  setSessionDebugEnabled,
  sendMessageStream
} from "@/lib/api-client";
import { createMockMessages, createMockRun } from "./fixtures";

vi.mock("@/lib/api-client", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  listEnabledModels: vi.fn(),
  renameSession: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionDebugEnabled: vi.fn(),
  deleteSession: vi.fn(),
  sendMessageStream: vi.fn(),
  getMessages: vi.fn()
}));

const mockCreateSession = vi.mocked(createSession);
const mockListSessions = vi.mocked(listSessions);
const mockListEnabledModels = vi.mocked(listEnabledModels);
const mockRenameSession = vi.mocked(renameSession);
const mockSetSessionModel = vi.mocked(setSessionModel);
const mockSetSessionDebugEnabled = vi.mocked(setSessionDebugEnabled);
const mockDeleteSession = vi.mocked(deleteSession);
const mockSendMessageStream = vi.mocked(sendMessageStream);
const mockGetMessages = vi.mocked(getMessages);

describe("ChatPanel", () => {
  beforeEach(() => {
    const session = {
      id: "session-1",
      datasource: "sqlite_main",
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
    mockSetSessionModel.mockResolvedValue(session);
    mockDeleteSession.mockResolvedValue({ deleted: true, sessionId: "session-1" });
    mockSetSessionDebugEnabled.mockResolvedValue({
      ...session,
      debugEnabled: true
    });
    mockSendMessageStream.mockImplementation(async (_sessionId, _message, handlers) => {
      handlers?.onEvent?.({
        type: "text-delta",
        runId: "run-1",
        sessionId: "session-1",
        at: "2026-04-10T00:00:00.000Z",
        data: {
          text: "SELECT payment_method"
        }
      });
    });
    mockGetMessages.mockResolvedValue({
      session,
      messages: createMockMessages(),
      latestRun: createMockRun()
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders disabled submit button when input is empty", async () => {
    render(<ChatPanel />);
    await screen.findByText(/Session: session-1/i);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("sends message and updates success state with sql preview", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "近30天支付方式分布");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalled();
      expect(mockGetMessages).toHaveBeenCalledWith("session-1");
    });

    expect(await screen.findByText("发送成功，已收到后端响应。")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
  });

  it("persists debug switch at session level", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Session: session-1/i);
    await user.click(screen.getByLabelText("调试详情开关"));

    await waitFor(() => {
      expect(mockSetSessionDebugEnabled).toHaveBeenCalledWith("session-1", true);
    });
  });

  it("shows initialization failure when session creation fails", async () => {
    mockListSessions.mockRejectedValueOnce(new Error("初始化失败"));

    render(<ChatPanel />);

    expect(await screen.findByText("初始化失败")).toBeInTheDocument();
    expect(mockSendMessageStream).not.toHaveBeenCalled();
  });
});
