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

describe("chat to sql preview integration", () => {
  beforeEach(() => {
    mockCreateSession.mockResolvedValue({
      id: "session-1",
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:00.000Z"
    });
    mockSendMessage.mockResolvedValue({
      responseType: "answer",
      run: createMockRun({
        sql: "SELECT * FROM orders LIMIT 20",
        explanation: "返回最近 20 条订单。"
      })
    });
    mockGetMessages.mockResolvedValue(createMockMessages());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates sql preview after successful message submission", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await screen.findByText(/Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "给我最近订单");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith("session-1", "给我最近订单");
    });

    expect(await screen.findByText("返回最近 20 条订单。")).toBeInTheDocument();
    expect(screen.getByText("SELECT * FROM orders LIMIT 20")).toBeInTheDocument();
  });
});
