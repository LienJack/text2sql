import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import {
  createSession,
  deleteSession,
  getMessages,
  listSessions,
  renameSession,
  setSessionDebugEnabled,
  sendMessage
} from "@/lib/api-client";
import { createMockMessages, createMockRun } from "../unit/fixtures";

vi.mock("@/lib/api-client", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  renameSession: vi.fn(),
  setSessionDebugEnabled: vi.fn(),
  deleteSession: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn()
}));

const mockCreateSession = vi.mocked(createSession);
const mockListSessions = vi.mocked(listSessions);
const mockRenameSession = vi.mocked(renameSession);
const mockSetSessionDebugEnabled = vi.mocked(setSessionDebugEnabled);
const mockDeleteSession = vi.mocked(deleteSession);
const mockSendMessage = vi.mocked(sendMessage);
const mockGetMessages = vi.mocked(getMessages);

describe("chat mobile smoke", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375
    });
    window.dispatchEvent(new Event("resize"));

    const session = {
      id: "session-1",
      datasource: "sqlite_main",
      title: "新会话",
      debugEnabled: false,
      syncStatus: "healthy" as const,
      createdAt: "2026-04-10T00:00:00.000Z"
    };
    mockCreateSession.mockResolvedValue(session);
    mockListSessions.mockResolvedValue([session]);
    mockRenameSession.mockResolvedValue(session);
    mockDeleteSession.mockResolvedValue({ deleted: true, sessionId: "session-1" });
    mockSetSessionDebugEnabled.mockResolvedValue({
      ...session,
      debugEnabled: true
    });
    mockSendMessage.mockResolvedValue({
      responseType: "answer",
      run: createMockRun()
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

  it("renders mobile-usable chat controls and sql preview", async () => {
    const { container } = render(<ChatPage />);
    await screen.findByText(/Session: session-1/i);

    expect(screen.getByLabelText("聊天输入")).toBeEnabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByText("SQL 解释与执行结果")).toBeInTheDocument();

    const gridContainer = container.querySelector(".lg\\:grid-cols-\\[1\\.2fr_1fr\\]");
    expect(gridContainer).toBeTruthy();
  });
});
