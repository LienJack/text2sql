import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/chat-panel";
import { createSession, getMessages, sendMessage } from "@/lib/api-client";
import { createMockMessages, createMockRun } from "./fixtures";

vi.mock("@/lib/api-client", () => ({
  createSession: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn()
}));

const mockCreateSession = vi.mocked(createSession);
const mockSendMessage = vi.mocked(sendMessage);
const mockGetMessages = vi.mocked(getMessages);

describe("ChatPanel", () => {
  beforeEach(() => {
    mockCreateSession.mockResolvedValue({
      id: "session-1",
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:00.000Z"
    });
    mockSendMessage.mockResolvedValue({
      responseType: "answer",
      run: createMockRun()
    });
    mockGetMessages.mockResolvedValue(createMockMessages());
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
      expect(mockSendMessage).toHaveBeenCalledWith("session-1", "近30天支付方式分布");
      expect(mockGetMessages).toHaveBeenCalledWith("session-1");
    });

    expect(await screen.findByText("发送成功，已收到后端响应。")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
  });

  it("shows initialization failure when session creation fails", async () => {
    mockCreateSession.mockRejectedValueOnce(new Error("初始化失败"));

    render(<ChatPanel />);

    expect(await screen.findByText("初始化失败")).toBeInTheDocument();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
