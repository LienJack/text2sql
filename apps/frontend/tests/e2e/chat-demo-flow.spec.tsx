import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import { createSession, getMessages, sendMessage } from "@/lib/api-client";
import { createMockMessages, createMockRun } from "../unit/fixtures";

vi.mock("@/lib/api-client", () => ({
  createSession: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn()
}));

const mockCreateSession = vi.mocked(createSession);
const mockSendMessage = vi.mocked(sendMessage);
const mockGetMessages = vi.mocked(getMessages);

describe("chat demo flow", () => {
  beforeEach(() => {
    mockCreateSession.mockResolvedValue({
      id: "session-1",
      datasource: "sqlite_main",
      createdAt: "2026-04-10T00:00:00.000Z"
    });
    mockSendMessage.mockResolvedValue({
      responseType: "answer",
      run: createMockRun({
        sql: "SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method",
        explanation: "统计订单支付方式分布。"
      })
    });
    mockGetMessages.mockResolvedValue(createMockMessages());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("completes send and preview flow", async () => {
    const user = userEvent.setup();
    render(<ChatPage />);

    await screen.findByText(/Session: session-1/i);
    await user.type(screen.getByLabelText("聊天输入"), "统计订单支付方式");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith("session-1", "统计订单支付方式");
    });

    expect(await screen.findByText("统计订单支付方式分布。")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "payment_method" })).toBeInTheDocument();
  });
});
