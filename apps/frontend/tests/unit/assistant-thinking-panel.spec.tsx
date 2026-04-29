import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantThinkingPanel } from "@/components/chat/assistant-thinking-panel";
import { createMockRun } from "./fixtures";

describe("AssistantThinkingPanel", () => {
  it("shows active step and progress in an expanded timeline during in-progress run", () => {
    render(
      <AssistantThinkingPanel
        run={null}
        streamSteps={[
          {
            node: "clarify",
            status: "success",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "completed",
            stage: "analysis",
            at: "2026-04-10T00:00:00.000Z"
          },
          {
            node: "generate-sql",
            status: "success",
            stepId: "step-2",
            sequence: 2,
            lifecycle: "running",
            stage: "generation",
            at: "2026-04-10T00:00:01.000Z"
          }
        ]}
        inProgress
      />
    );

    expect(screen.getByRole("button", { name: "收起处理过程" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("< | 大模型 | 生成 SQL（进行中）")).toBeInTheDocument();
    expect(screen.getByText("< | 大模型 | 理解问题（完成）")).toBeInTheDocument();
  });

  it("supports keyboard toggle with synced aria-expanded state", async () => {
    const user = userEvent.setup();
    render(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "completed",
            stage: "generation",
            at: "2026-04-10T00:00:00.000Z"
          }
        ]}
        inProgress={false}
      />
    );

    const trigger = screen.getByRole("button", { name: "展开处理过程" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText(/生成 SQL/).length).toBeGreaterThan(0);

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("requests run details when opened with run reference and no loaded trace", async () => {
    const onRequestRun = vi.fn();
    const user = userEvent.setup();
    render(
      <AssistantThinkingPanel
        run={null}
        streamSteps={[]}
        inProgress={false}
        hasRunReference
        onRequestRun={onRequestRun}
      />
    );

    await user.click(screen.getByRole("button", { name: "展开处理过程" }));
    await waitFor(() => {
      expect(onRequestRun).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps panel expanded when stream returns to in-progress for runtime visibility", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "completed",
            at: "2026-04-10T00:00:00.000Z"
          }
        ]}
        inProgress={false}
      />
    );

    const trigger = screen.getByRole("button", { name: "展开处理过程" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    rerender(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "running",
            at: "2026-04-10T00:00:01.000Z"
          }
        ]}
        inProgress
      />
    );

    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  });

  it("shows failed steps in expanded list for post-run review", async () => {
    const user = userEvent.setup();
    render(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "safety-check",
            status: "failed",
            stepId: "step-failed",
            sequence: 2,
            lifecycle: "failed",
            errorSummary: "sql contains forbidden keyword",
            at: "2026-04-10T00:00:02.000Z"
          }
        ]}
        inProgress={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "展开处理过程" }));
    expect(screen.getByText("< | 大模型 | 安全校验（失败）")).toBeInTheDocument();
    expect(screen.getByText("sql contains forbidden keyword")).toBeInTheDocument();
  });

  it("keeps completed steps visible after finish and does not regress to loading placeholder", async () => {
    const user = userEvent.setup();
    const completedStep = {
      node: "generate-sql",
      status: "success" as const,
      stepId: "step-terminal",
      sequence: 1,
      lifecycle: "completed" as const,
      title: "生成 SQL",
      at: "2026-04-10T00:00:02.000Z"
    };
    const { rerender } = render(
      <AssistantThinkingPanel
        run={null}
        streamSteps={[completedStep]}
        inProgress={false}
        runLoading={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "展开处理过程" }));
    expect(screen.getByText(/生成 SQL/)).toBeInTheDocument();

    rerender(
      <AssistantThinkingPanel
        run={null}
        streamSteps={[completedStep]}
        inProgress={false}
        runLoading
      />
    );

    expect(screen.getByText(/生成 SQL/)).toBeInTheDocument();
    expect(screen.queryByText("正在加载该轮处理轨迹...")).not.toBeInTheDocument();
  });
});
